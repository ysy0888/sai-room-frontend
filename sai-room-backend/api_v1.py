"""Authenticated API used by the production frontend. No fixture data."""
import base64
import hashlib
import io
import json
import re
import sqlite3
import time
from datetime import date, datetime
from zoneinfo import ZoneInfo
from uuid import uuid4
from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from PIL import Image, UnidentifiedImageError
from database import get_connection
from auth import hash_password, verify_password, token_hash
from security import (COOKIE, DUMMY_HASH, audit, csrf_check, current_user, fail,
                      issue_session, normalize_email, rate_limit, session)

router = APIRouter(prefix='/api/v1')
STAFF = ('operator','admin')
now_ms = lambda: int(time.time()*1000)

class Input(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=False)
class Signup(Input):
    displayName: str = Field(min_length=1,max_length=40)
    studentId: str = Field(min_length=4,max_length=20)
    email: str = Field(max_length=254)
    password: str = Field(min_length=8,max_length=128)
    operatorCode: str = Field(default='',max_length=128)
class Login(Input):
    email: str = Field(min_length=1,max_length=254)
    password: str = Field(min_length=1,max_length=128)
class Decision(Input):
    membershipStatus: str
class RotateCode(Input):
    newCode: str = Field(min_length=12,max_length=128)
    currentPassword: str = Field(min_length=8,max_length=128)
    version: int = Field(ge=1)
class Booking(Input):
    roomId: str = 'sai-room'
    date: date
    start: int = Field(ge=540,le=1350)
    end: int = Field(ge=570,le=1380)
    purpose: str = Field(min_length=1,max_length=60)
    name: str = Field(min_length=1,max_length=40)
    people: int = Field(ge=1,le=15)
class Post(Input):
    roomId: str = 'sai-room'
    kind: str
    category: str
    title: str = Field(min_length=1,max_length=60)
    body: str = Field(min_length=1,max_length=2000)
class Comment(Input):
    body: str = Field(min_length=1,max_length=500)
class Preferences(Input):
    theme: str
    gauge: str
class Ball(Input):
    anonymous: bool
    color: str
    imageId: str | None = None
class Upload(Input):
    imageData: str = Field(max_length=1500000)


def room_check(value):
    if value != 'sai-room': fail(404,'ROOM_NOT_FOUND')

def auth_write(request, roles=None):
    csrf_check(request)
    return current_user(request,roles=roles)

def mutation(request, user, payload, action):
    key = request.headers.get('idempotency-key')
    if not key or not re.fullmatch(r'[A-Za-z0-9_-]{8,100}',key): fail(400,'IDEMPOTENCY_REQUIRED')
    fingerprint = token_hash(request.method+request.url.path+json.dumps(payload,sort_keys=True,default=str))
    with get_connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        conn.execute('DELETE FROM request_keys WHERE expires_at<?',(int(time.time()),))
        previous=conn.execute('SELECT * FROM request_keys WHERE user_id=? AND key=?',(user['id'],key)).fetchone()
        if previous:
            if previous['fingerprint'] != fingerprint: fail(409,'IDEMPOTENCY_CONFLICT')
            return json.loads(previous['response'])
        result=action(conn)
        conn.execute('INSERT INTO request_keys VALUES (?,?,?,?,?)',(user['id'],key,fingerprint,json.dumps(result),int(time.time())+86400))
        return result

def public_user(row):
    return {'id':row['id'],'displayName':row['name'],'role':row['role'],'membershipStatus':row['status']}

def ball_style(row):
    image_id=row['ball_image_id']
    return {'anonymous':bool(row['ball_anonymous']),'color':row['ball_color'],'imageId':image_id,'imageUrl':f'/media/balls/{image_id}.png' if image_id else None}

def booking_json(row,user):
    return {**{k:row[k] for k in ('id','date','start','end','purpose','name','people')},'owner':'me' if row['owner']==user['id'] else 'other'}

def comment_json(row,user):
    return {'id':row['id'],'body':row['body'],'createdAt':row['created_at'],'owner':'admin' if row['is_staff'] else 'me' if row['author_id']==user['id'] else 'other'}

def allowed_post(conn,post_id,user):
    row=conn.execute('SELECT * FROM posts WHERE id=?',(post_id,)).fetchone()
    if not row or (row['kind']=='inquiry' and row['author_id']!=user['id'] and user['role'] not in STAFF): fail(404,'NOT_FOUND')
    return row

def post_json(conn,row,user):
    comments=conn.execute('SELECT * FROM comments WHERE post_id=? ORDER BY created_at,rowid',(row['id'],)).fetchall()
    result={**{k:row[k] for k in ('id','kind','category','title','body','status')},'owner':'me' if row['author_id']==user['id'] else 'other','createdAt':row['created_at'],'comments':[comment_json(c,user) for c in comments]}
    if row['kind']=='inquiry':
        author=conn.execute('SELECT name FROM users WHERE id=?',(row['author_id'],)).fetchone()
        result['authorName']=author['name'] if author else '회원'
    return result

def code_meta(conn):
    row=conn.execute('SELECT c.version,c.updated_at,u.name FROM operator_code c LEFT JOIN users u ON u.id=c.updated_by WHERE c.id=1').fetchone()
    return {'version':row['version'],'updatedAt':row['updated_at'],'updatedBy':row['name'],'configured':True}

@router.get('/auth/csrf')
def csrf(request:Request,response:Response):
    try: token=session(request)['csrf']
    except Exception as error:
        if getattr(error,'status_code',None)!=401: raise
        rate_limit('preauth',request.client.host,100)
        token=issue_session(request,response)
    return {'csrfToken':token}

@router.post('/auth/signup',status_code=204)
def signup(data:Signup,request:Request):
    csrf_check(request)
    rate_limit('signup',request.client.host,10)
    email=normalize_email(data.email);name=data.displayName.strip();student=data.studentId.strip()
    if not name or not re.fullmatch(r'[A-Za-z0-9-]{4,20}',student): fail(422,'INVALID_PROFILE')
    password_hash=hash_password(data.password);code=data.operatorCode.strip()
    with get_connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        role='member'
        if code:
            setting=conn.execute('SELECT code_hash FROM operator_code WHERE id=1').fetchone()
            if not setting or not verify_password(code,setting['code_hash']): fail(422,'INVALID_OPERATOR_CODE')
            role='operator'
        try:
            conn.execute('INSERT INTO users (id,name,student_id,username,email,password_hash,role,status,created_at) VALUES (?,?,?,?,?,?,?,\'pending\',?)',(str(uuid4()),name,student,email,email,password_hash,role,int(time.time())))
        except sqlite3.IntegrityError: fail(409,'ACCOUNT_UNAVAILABLE')

@router.post('/auth/login',status_code=204)
def login(data:Login,request:Request,response:Response):
    csrf_check(request)
    identifier=data.email.strip().lower()
    rate_limit('login-ip',request.client.host,40)
    rate_limit('login-account',identifier,12)
    with get_connection() as conn:
        row=conn.execute('SELECT * FROM users WHERE email=? OR username=?',(identifier,identifier)).fetchone()
    valid=verify_password(data.password,row['password_hash'] if row else DUMMY_HASH)
    if not row or not valid: fail(401,'INVALID_CREDENTIALS')
    issue_session(request,response,row['id'])

@router.post('/auth/logout',status_code=204)
def logout(request:Request,response:Response):
    row=csrf_check(request)
    with get_connection() as conn:
        conn.execute('DELETE FROM web_sessions WHERE token_hash=?',(row['token_hash'],))
        # Logging out must not leave the member counted by the beacon until the grace window ends.
        if row['user_id'] and conn.execute('DELETE FROM beacon_presence WHERE user_id=?',(row['user_id'],)).rowcount:
            conn.execute('UPDATE room_state SET sequence=sequence+1 WHERE id=1')
    response.delete_cookie(COOKIE,path='/',httponly=True,samesite='strict')

@router.get('/bootstrap')
def bootstrap(request:Request,roomId:str='sai-room'):
    room_check(roomId);user=current_user(request,approved=False);approved=user['status']=='approved'
    with get_connection() as conn:
        bookings=conn.execute('SELECT * FROM reservations ORDER BY date,start').fetchall() if approved else []
        posts=conn.execute("SELECT * FROM posts WHERE kind='public' OR author_id=? OR ? IN ('operator','admin') ORDER BY created_at DESC,rowid DESC",(user['id'],user['role'])).fetchall() if approved else []
        present=approved and bool(conn.execute('SELECT 1 FROM presence WHERE user_id=? AND expires_at>?',(user['id'],int(time.time()))).fetchone())
        return {'user':public_user(user),'csrfToken':session(request)['csrf'],'bookings':[booking_json(b,user) for b in bookings],'posts':[post_json(conn,p,user) for p in posts],'preferences':{'theme':user['theme'],'gauge':user['gauge']},'ball':ball_style(user),'checkedIn':present}

@router.get('/admin/membership-applications')
def applications(request:Request):
    current_user(request,roles=('admin',))
    with get_connection() as conn:
        rows=conn.execute("SELECT * FROM users WHERE role IN ('member','operator') ORDER BY created_at DESC").fetchall()
        return [{'id':r['id'],'displayName':r['name'],'email':r['email'] or r['username'],'studentId':r['student_id'],'role':r['role'],'membershipStatus':r['status'],'createdAt':r['created_at']*1000} for r in rows]

@router.patch('/admin/membership-applications/{user_id}',status_code=204)
def decide(user_id:str,data:Decision,request:Request):
    user=auth_write(request,('admin',))
    if data.membershipStatus not in ('approved','rejected'): fail(422,'INVALID_STATUS')
    def action(conn):
        result=conn.execute("UPDATE users SET status=? WHERE id=? AND status='pending' AND role IN ('member','operator')",(data.membershipStatus,user_id))
        if result.rowcount!=1: fail(409,'APPLICATION_CHANGED')
        audit(conn,user['id'],'membership.'+data.membershipStatus,user_id)
    mutation(request,user,data.model_dump(),action)

@router.get('/staff/operator-code')
def operator_code(request:Request):
    current_user(request,roles=STAFF)
    with get_connection() as conn: return code_meta(conn)

@router.put('/staff/operator-code')
def rotate_code(data:RotateCode,request:Request):
    user=auth_write(request,STAFF)
    rate_limit('code-rotation',user['id'],5)
    if not verify_password(data.currentPassword,user['password_hash']): fail(422,'PASSWORD_MISMATCH')
    new_code=data.newCode.strip()
    if len(new_code)<12 or new_code=='SAI-STAFF-DEMO': fail(422,'WEAK_OPERATOR_CODE')
    new_hash=hash_password(new_code)
    with get_connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        row=conn.execute('SELECT * FROM operator_code WHERE id=1').fetchone()
        if row['version']!=data.version: fail(409,'CODE_VERSION_CONFLICT')
        if verify_password(new_code,row['code_hash']): fail(422,'CODE_UNCHANGED')
        conn.execute('UPDATE operator_code SET code_hash=?,version=version+1,updated_at=?,updated_by=? WHERE id=1',(new_hash,now_ms(),user['id']))
        audit(conn,user['id'],'operator_code.rotated')
        return code_meta(conn)

def validate_booking(data):
    room_check(data.roomId)
    start=datetime.fromisoformat(f'{data.date}T{data.start//60:02}:{data.start%60:02}:00').replace(tzinfo=ZoneInfo('Asia/Seoul'))
    if data.start>=data.end or data.start%30 or data.end%30 or start.timestamp()<=time.time() or not data.name.strip() or not data.purpose.strip(): fail(422,'INVALID_BOOKING')

def save_booking(data,request,booking_id=None):
    user=auth_write(request);validate_booking(data)
    def action(conn):
        if booking_id:
            old=conn.execute('SELECT owner FROM reservations WHERE id=?',(booking_id,)).fetchone()
            if not old or old['owner']!=user['id']: fail(404,'NOT_FOUND')
        if conn.execute('SELECT id FROM reservations WHERE date=? AND start<? AND end>? AND id!=?',(str(data.date),data.end,data.start,booking_id or '')).fetchone(): fail(409,'BOOKING_CONFLICT')
        identifier=booking_id or str(uuid4())
        conn.execute('INSERT INTO reservations VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET date=excluded.date,start=excluded.start,end=excluded.end,purpose=excluded.purpose,name=excluded.name,people=excluded.people',(identifier,str(data.date),data.start,data.end,data.purpose.strip(),data.name.strip(),data.people,user['id']))
        return booking_json(conn.execute('SELECT * FROM reservations WHERE id=?',(identifier,)).fetchone(),user)
    return mutation(request,user,data.model_dump(),action)

@router.post('/bookings',status_code=201)
def create_booking(data:Booking,request:Request): return save_booking(data,request)
@router.patch('/bookings/{booking_id}')
def update_booking(booking_id:str,data:Booking,request:Request): return save_booking(data,request,booking_id)
@router.delete('/bookings/{booking_id}',status_code=204)
def delete_booking(booking_id:str,request:Request):
    user=auth_write(request)
    def action(conn):
        if conn.execute('DELETE FROM reservations WHERE id=? AND owner=?',(booking_id,user['id'])).rowcount!=1: fail(404,'NOT_FOUND')
    mutation(request,user,{},action)

def save_post(data,request,post_id=None):
    user=auth_write(request);room_check(data.roomId)
    categories={'public':('자유','스터디','공용물품'),'inquiry':('문의','건의')}
    if data.category not in categories.get(data.kind,()) or not data.title.strip() or not data.body.strip(): fail(422,'INVALID_POST')
    def action(conn):
        if post_id:
            row=allowed_post(conn,post_id,user)
            if row['author_id']!=user['id']: fail(404,'NOT_FOUND')
            if row['kind']!=data.kind: fail(422,'POST_KIND_IMMUTABLE')
            conn.execute('UPDATE posts SET category=?,title=?,body=? WHERE id=?',(data.category,data.title.strip(),data.body.strip(),post_id))
            identifier=post_id
        else:
            identifier=str(uuid4())
            conn.execute('INSERT INTO posts (id,category,title,body,created_at,edit_token_hash,author_id,kind,status) VALUES (?,?,?,?,?,\'\',?,?,\'received\')',(identifier,data.category,data.title.strip(),data.body.strip(),now_ms(),user['id'],data.kind))
        return post_json(conn,conn.execute('SELECT * FROM posts WHERE id=?',(identifier,)).fetchone(),user)
    return mutation(request,user,data.model_dump(),action)

@router.post('/posts',status_code=201)
def create_post(data:Post,request:Request): return save_post(data,request)
@router.patch('/posts/{post_id}')
def update_post(post_id:str,data:Post,request:Request): return save_post(data,request,post_id)
@router.delete('/posts/{post_id}',status_code=204)
def delete_post(post_id:str,request:Request):
    user=auth_write(request)
    def action(conn):
        row=allowed_post(conn,post_id,user)
        if row['author_id']!=user['id']: fail(404,'NOT_FOUND')
        conn.execute('DELETE FROM posts WHERE id=?',(post_id,))
    mutation(request,user,{},action)

def add_comment(post_id,data,request,reply=False):
    user=auth_write(request,STAFF if reply else None)
    if not data.body.strip(): fail(422,'INVALID_COMMENT')
    def action(conn):
        row=allowed_post(conn,post_id,user)
        if reply and row['kind']!='inquiry': fail(422,'INVALID_REPLY')
        if not reply and row['kind']=='inquiry' and row['author_id']!=user['id']: fail(403,'FORBIDDEN')
        identifier=str(uuid4())
        conn.execute('INSERT INTO comments (id,post_id,body,created_at,author_id,is_staff) VALUES (?,?,?,?,?,?)',(identifier,post_id,data.body.strip(),now_ms(),user['id'],int(reply)))
        if row['kind']=='inquiry': conn.execute('UPDATE posts SET status=? WHERE id=?',('answered' if reply else 'received',post_id))
        return comment_json(conn.execute('SELECT * FROM comments WHERE id=?',(identifier,)).fetchone(),user)
    return mutation(request,user,data.model_dump(),action)
@router.post('/posts/{post_id}/comments',status_code=201)
def comment(post_id:str,data:Comment,request:Request): return add_comment(post_id,data,request)
@router.post('/posts/{post_id}/reply',status_code=201)
def reply(post_id:str,data:Comment,request:Request): return add_comment(post_id,data,request,True)

@router.patch('/me/preferences')
def preferences(data:Preferences,request:Request):
    user=auth_write(request)
    if data.theme not in ('light','dark','blue') or data.gauge not in ('basic','water','lava'): fail(422,'INVALID_PREFERENCES')
    def action(conn):
        conn.execute('UPDATE users SET theme=?,gauge=? WHERE id=?',(data.theme,data.gauge,user['id']))
        return data.model_dump()
    return mutation(request,user,data.model_dump(),action)

@router.post('/me/ball-image',status_code=201)
def upload_ball(data:Upload,request:Request):
    user=auth_write(request);rate_limit('ball-upload',user['id'],15)
    try:
        if not data.imageData.startswith('data:image/png;base64,'): raise ValueError()
        raw=base64.b64decode(data.imageData.split(',',1)[1],validate=True)
        with Image.open(io.BytesIO(raw)) as image:
            if image.format!='PNG' or not 1<=image.width<=1024 or not 1<=image.height<=1024: raise ValueError()
            image.load();image=image.convert('RGBA');image.thumbnail((256,256));output=io.BytesIO();image.save(output,format='PNG');png=output.getvalue()
    except (ValueError,OSError,UnidentifiedImageError,Image.DecompressionBombError): fail(422,'INVALID_IMAGE')
    def action(conn):
        # Unattached uploads expire; keep retries valid for one day.
        conn.execute('DELETE FROM ball_images WHERE created_at<? AND id NOT IN (SELECT ball_image_id FROM users WHERE ball_image_id IS NOT NULL)',(now_ms()-86400000,))
        identifier=str(uuid4());conn.execute('INSERT INTO ball_images VALUES (?,?,?,?)',(identifier,user['id'],png,now_ms()))
        return {'imageId':identifier,'imageUrl':f'/media/balls/{identifier}.png'}
    return mutation(request,user,{'imageDigest':hashlib.sha256(png).hexdigest()},action)

@router.patch('/me/ball')
def save_ball(data:Ball,request:Request):
    user=auth_write(request)
    if not re.fullmatch(r'#[0-9a-fA-F]{6}',data.color): fail(422,'INVALID_COLOR')
    def action(conn):
        if data.imageId and not conn.execute('SELECT 1 FROM ball_images WHERE id=? AND owner_id=?',(data.imageId,user['id'])).fetchone(): fail(404,'NOT_FOUND')
        conn.execute('UPDATE users SET ball_anonymous=?,ball_color=?,ball_image_id=? WHERE id=?',(int(data.anonymous),data.color,data.imageId,user['id']))
        conn.execute('UPDATE room_state SET sequence=sequence+1 WHERE id=1')
        return ball_style(conn.execute('SELECT * FROM users WHERE id=?',(user['id'],)).fetchone())
    return mutation(request,user,data.model_dump(),action)

@router.post('/me/presence')
def check_in(request:Request):
    user=auth_write(request)
    def action(conn):
        stamp=int(time.time());conn.execute('INSERT INTO presence VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET checked_in_at=excluded.checked_in_at,expires_at=excluded.expires_at',(user['id'],stamp,stamp+4*3600));conn.execute('UPDATE room_state SET sequence=sequence+1 WHERE id=1')
        return {'checkedIn':True}
    return mutation(request,user,{},action)
@router.delete('/me/presence')
def check_out(request:Request):
    user=auth_write(request)
    def action(conn):
        conn.execute('DELETE FROM presence WHERE user_id=?',(user['id'],));conn.execute('UPDATE room_state SET sequence=sequence+1 WHERE id=1');return {'checkedIn':False}
    return mutation(request,user,{},action)

def presence_snapshot(request,room_id,include_members=False):
    import beacon  # imported lazily: beacon imports this module
    room_check(room_id);user=current_user(request)
    with get_connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        t=beacon.now();settings=beacon.load_settings(conn)
        removed=conn.execute("DELETE FROM presence WHERE expires_at<=? OR user_id IN (SELECT id FROM users WHERE status!='approved')",(int(t),)).rowcount
        removed+=beacon.purge(conn,settings,t)
        if removed: conn.execute('UPDATE room_state SET sequence=sequence+1 WHERE id=1')
        since=beacon.active_since(conn,settings,t)
        ids=sorted(since,key=lambda u:(since[u],u))
        rows=[r for r in (conn.execute('SELECT * FROM users WHERE id=?',(i,)).fetchone() for i in ids) if r]
        sequence=conn.execute('SELECT sequence FROM room_state WHERE id=1').fetchone()[0]
        result={'count':len(rows),'referenceCapacity':settings['reference_capacity'],'sequence':sequence,'checkedIn':any(r['id']==user['id'] for r in rows),'observedAt':datetime.fromtimestamp(t,ZoneInfo('UTC')).isoformat(),
                'lastDetectionAt':beacon.last_detection_iso(conn),'beacon':{'enabled':bool(settings['enabled']),'configured':bool(settings['uuid'])}}
        if include_members: result.update({'hiddenCount':0,'members':[{'id':r['id'],'displayName':'익명 회원' if r['ball_anonymous'] else r['name'],'isSelf':r['id']==user['id'],'ball':ball_style(r)} for r in rows]})
        return result
@router.get('/rooms/{room_id}/occupancy')
def occupancy(room_id:str,request:Request): return presence_snapshot(request,room_id)
@router.get('/rooms/{room_id}/occupants')
def occupants(room_id:str,request:Request): return presence_snapshot(request,room_id,True)
