import base64
import io
import os
import sqlite3
import sys
import time
from pathlib import Path
from uuid import uuid4
import pytest
from fastapi.testclient import TestClient
from PIL import Image
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import database, security
from auth import hash_password, verify_password
from main import app

PASSWORD='Server-test-1234'
CODE='Test-Initial-Code-2026'

@pytest.fixture
def client(tmp_path,monkeypatch,pg_database):
    if pg_database:
        pg_url, runtime_url = pg_database
        import psycopg
        with psycopg.connect(pg_url, autocommit=True) as conn:
            conn.execute((Path(__file__).resolve().parents[1]/'schema.postgres.sql').read_text())
            tables = conn.execute("SELECT tablename FROM pg_tables WHERE schemaname='sai_private' AND tablename != 'schema_version'").fetchall()
            from psycopg import sql
            conn.execute(sql.SQL('TRUNCATE {} RESTART IDENTITY CASCADE').format(sql.SQL(',').join(sql.Identifier('sai_private',r[0]) for r in tables)))
            conn.execute('INSERT INTO sai_private.room_state VALUES (1,0)')
        monkeypatch.setenv('SAI_DATABASE_URL',runtime_url)
    monkeypatch.setattr(database,'DB_PATH',tmp_path/'test.db')
    monkeypatch.setattr(security,'DB_PATH',tmp_path/'test.db')
    monkeypatch.setenv('SAI_INITIAL_OPERATOR_CODE',CODE)
    with TestClient(app) as c: yield c

def account(role='admin',status='approved'):
    identifier=str(uuid4());email=identifier+'@example.test'
    with database.get_connection() as conn:
        conn.execute('INSERT INTO users (id,name,student_id,username,email,password_hash,role,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)',(identifier,'테스트 회원',identifier[:12],email,email,hash_password(PASSWORD),role,status,int(time.time())))
        conn.execute('INSERT INTO policy_acceptance VALUES (?,?,?)',(identifier,'2026-11-23',int(time.time())))
    return identifier,email

def signin(c,email,password=PASSWORD):
    csrf=c.get('/api/v1/auth/csrf').json()['csrfToken']
    response=c.post('/api/v1/auth/login',json={'email':email,'password':password},headers={'X-CSRF-Token':csrf})
    assert response.status_code==204,response.text
    data=c.get('/api/v1/bootstrap').json()
    return data['csrfToken']

def write(c,path,body=None,method='POST',csrf=None,key=None):
    csrf=csrf or c.get('/api/v1/auth/csrf').json()['csrfToken']
    return c.request(method,'/api/v1'+path,json=body,headers={'X-CSRF-Token':csrf,'Idempotency-Key':key or str(uuid4())})

def signup(c,code='',email=None,student=None):
    return write(c,'/auth/signup',{'displayName':'가입 회원','email':email or str(uuid4())+'@example.test','studentId':student or str(uuid4())[:12],'password':'12345678','operatorCode':code})

def test_signup_roles_approval_and_no_client_privileges(client):
    assert signup(client).status_code==204
    assert signup(client,CODE).status_code==204
    assert signup(client,'wrong-code').status_code==422
    with database.get_connection() as conn:
        rows=conn.execute('SELECT role,status FROM users ORDER BY rowid').fetchall()
        assert [(r['role'],r['status']) for r in rows]==[('member','pending'),('operator','pending')]
        assert CODE not in str([dict(r) for r in conn.execute('SELECT * FROM users')])
    data={'displayName':'악의적 요청','email':'extra@example.test','studentId':'20260001','password':'12345678','role':'admin'}
    assert write(client,'/auth/signup',data).status_code==422

def test_pending_can_check_status_but_no_protected_data(client):
    identifier,email=account('operator','pending');signin(client,email)
    data=client.get('/api/v1/bootstrap').json();assert data['posts']==[] and data['bookings']==[]
    for route in ['/staff/operator-code','/admin/membership-applications','/rooms/sai-room/occupants']:
        assert client.get('/api/v1'+route).status_code==403
    assert write(client,'/me/presence').status_code==403
    assert data['user']['membershipStatus']=='pending'

def test_admin_approval_and_staff_permission_boundaries(client):
    identifier,email=account('operator','pending');_,admin=account();signin(client,admin)
    rows=client.get('/api/v1/admin/membership-applications').json();assert rows[0]['role']=='operator'
    assert write(client,'/admin/membership-applications/'+identifier,{'membershipStatus':'approved'},'PATCH').status_code==204
    signin(client,email)
    assert client.get('/api/v1/staff/operator-code').status_code==200
    assert client.get('/api/v1/admin/membership-applications').status_code==403
    assert write(client,'/admin/membership-applications/'+identifier,{'membershipStatus':'approved'},'PATCH').status_code==403

def test_rotation_requires_password_is_versioned_and_old_code_immediately_fails(client):
    _,email=account('operator');signin(client,email)
    meta=client.get('/api/v1/staff/operator-code').json();assert 'code' not in meta and 'code_hash' not in meta
    payload={'newCode':'New-Operator-Code-58392','currentPassword':'wrong-password','version':meta['version']}
    assert write(client,'/staff/operator-code',payload,'PUT').json()['error']['code']=='PASSWORD_MISMATCH'
    payload['currentPassword']=PASSWORD
    result=write(client,'/staff/operator-code',payload,'PUT');assert result.status_code==200
    assert result.json()['version']==2
    assert write(client,'/staff/operator-code',{**payload,'newCode':'Another-Operator-Code-23'},'PUT').status_code==409
    assert signup(client,CODE).status_code==422
    assert signup(client,payload['newCode']).status_code==204
    security.initial_operator_code()
    assert signup(client,CODE).status_code==422  # restart never restores the initial code
    with database.get_connection() as conn:
        assert conn.execute('SELECT count(*) FROM audit_events WHERE action=?',('operator_code.rotated',)).fetchone()[0]==1
        assert not any(payload['newCode'] in str(dict(r)) for r in conn.execute('SELECT * FROM operator_code'))

def test_member_cannot_read_or_rotate_code(client):
    _,email=account('member');signin(client,email)
    assert client.get('/api/v1/staff/operator-code').status_code==403
    assert write(client,'/staff/operator-code',{'newCode':'Code-forbidden-12345','currentPassword':PASSWORD,'version':1},'PUT').status_code==403

def test_cookie_csrf_session_rotation_and_logout(client):
    _,email=account();csrf=client.get('/api/v1/auth/csrf');before=client.cookies.get(security.COOKIE)
    response=client.post('/api/v1/auth/login',json={'email':email,'password':PASSWORD},headers={'X-CSRF-Token':csrf.json()['csrfToken']})
    assert response.status_code==204
    assert 'HttpOnly' in response.headers['set-cookie'] and 'SameSite=strict' in response.headers['set-cookie']
    assert before!=client.cookies.get(security.COOKIE)
    assert client.post('/api/v1/me/presence').status_code==403
    token=client.get('/api/v1/bootstrap').json()['csrfToken']
    assert client.post('/api/v1/me/presence',headers={'X-CSRF-Token':token,'Origin':'https://evil.test'}).status_code==403
    assert write(client,'/auth/logout').status_code==204
    assert client.get('/api/v1/bootstrap').status_code==401

def test_rate_limits_invalid_logins(client):
    for _ in range(12):
        csrf=client.get('/api/v1/auth/csrf').json()['csrfToken']
        assert client.post('/api/v1/auth/login',json={'email':'unknown@example.test','password':'bad'},headers={'X-CSRF-Token':csrf}).status_code==401
    csrf=client.get('/api/v1/auth/csrf').json()['csrfToken']
    assert client.post('/api/v1/auth/login',json={'email':'unknown@example.test','password':'bad'},headers={'X-CSRF-Token':csrf}).status_code==429

def test_private_inquiry_scope_and_staff_reply(client):
    owner,email=account('member');_,other=account('member');_,staff=account('operator')
    signin(client,email);response=write(client,'/posts',{'kind':'inquiry','category':'문의','title':'비공개','body':'작성자 전용 내용'});assert response.status_code==201
    post=response.json();signin(client,other);assert client.get('/api/v1/bootstrap').json()['posts']==[]
    for suffix in ['/comments','/reply']:
        assert write(client,'/posts/'+post['id']+suffix,{'body':'침입'}).status_code in (403,404)
    signin(client,staff);assert len(client.get('/api/v1/bootstrap').json()['posts'])==1
    assert write(client,'/posts/'+post['id']+'/reply',{'body':'운영진 답변'}).json()['owner']=='admin'
    signin(client,email);updated=client.get('/api/v1/bootstrap').json()['posts'][0];assert updated['status']=='answered'
    assert write(client,'/posts/'+post['id']+'/comments',{'body':'추가 질문'}).status_code==201
    assert client.get('/api/v1/bootstrap').json()['posts'][0]['status']=='received'

def test_bookings_ownership_conflicts_and_idempotent_retry(client):
    _,email=account('member');_,other=account('member');signin(client,email)
    payload={'date':'2099-12-01','start':600,'end':660,'purpose':'스터디','name':'회원','people':2}
    key=str(uuid4());created=write(client,'/bookings',payload,key=key);assert created.status_code==201
    replay=write(client,'/bookings',payload,key=key);assert replay.json()['id']==created.json()['id']
    assert write(client,'/bookings',payload).status_code==409
    signin(client,other);assert write(client,'/bookings/'+created.json()['id'],None,'DELETE').status_code==404
    assert write(client,'/bookings/'+created.json()['id'],payload,'PATCH').status_code==404
    signin(client,email);assert write(client,'/bookings/'+created.json()['id'],None,'DELETE').status_code==204

def test_ball_ownership_and_anonymous_presence(client):
    owner,email=account('member');_,other=account('member');signin(client,email)
    image=Image.new('RGB',(256,256),'red');stream=io.BytesIO();image.save(stream,format='PNG')
    uploaded=write(client,'/me/ball-image',{'imageData':'data:image/png;base64,'+base64.b64encode(stream.getvalue()).decode()});assert uploaded.status_code==201
    image_id=uploaded.json()['imageId']
    assert write(client,'/me/ball',{'anonymous':True,'color':'#a6113c','imageId':image_id},'PATCH').status_code==200
    assert write(client,'/me/presence').json()['checkedIn']
    assert client.get('/api/v1/rooms/sai-room/occupancy').json()['checkedIn'] is True
    signin(client,other);rows=client.get('/api/v1/rooms/sai-room/occupants').json();assert rows['members'][0]['displayName']=='익명 회원'
    assert write(client,'/me/ball',{'anonymous':False,'color':'#a6113c','imageId':image_id},'PATCH').status_code==404
    assert client.get(uploaded.json()['imageUrl']).status_code==200
    signin(client,email);assert write(client,'/me/presence',None,'DELETE').json()['checkedIn'] is False
    snapshot=client.get('/api/v1/rooms/sai-room/occupancy').json();assert snapshot['count']==0 and snapshot['checkedIn'] is False

def test_static_does_not_expose_secrets_or_legacy_open_endpoints(client):
    for path in ['/sai-room-backend/sai.db','/sai-room-backend/main.py','/.env','/reservations','/posts','/auth/pending']:
        assert client.get(path).status_code==404
    assert client.get('/').status_code==200
    text=client.get('/').text
    assert 'accounts.js' not in text and 'review.js' not in text and 'motion-lab' not in text
    assert 'launch-screen' in text
    assert client.get('/api/v1/bootstrap').headers['Cache-Control']=='no-store'

def test_legacy_schema_and_passwords_migrate_without_data_loss(tmp_path,monkeypatch):
    db=tmp_path/'legacy.db';monkeypatch.setattr(database,'DB_PATH',db)
    old_hash=hash_password(PASSWORD)
    with sqlite3.connect(db) as c:
        c.execute('CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT NOT NULL,student_id TEXT NOT NULL UNIQUE,username TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,role TEXT NOT NULL,status TEXT NOT NULL,created_at INTEGER NOT NULL)')
        c.execute("INSERT INTO users VALUES('legacy','기존 관리자','20260001','legacy_admin',?,'admin','approved',1)",(old_hash,))
    database.init_db();database.init_db()
    with database.get_connection() as c:
        row=c.execute('SELECT * FROM users').fetchone();assert row['username']=='legacy_admin' and row['email'] is None
        assert verify_password(PASSWORD,row['password_hash']) and row['role']=='admin'

def test_initial_random_code_generated_once_and_not_reset(tmp_path,monkeypatch):
    monkeypatch.setattr(database,'DB_PATH',tmp_path/'instance.db');monkeypatch.setattr(security,'DB_PATH',tmp_path/'instance.db');monkeypatch.delenv('SAI_INITIAL_OPERATOR_CODE',raising=False)
    database.init_db();security.initial_operator_code();file=tmp_path/'instance.db.initial-operator-code'
    code=file.read_text().strip();assert len(code)>24 and (file.stat().st_mode & 0o777)==0o600
    security.initial_operator_code();assert file.read_text().strip()==code
    with database.get_connection() as c: assert verify_password(code,c.execute('SELECT code_hash FROM operator_code').fetchone()[0])

# Device events run against the same disposable SQLite/PostgreSQL fixtures.
BEACON_UUID='b277aa12-35f0-4c38-8bae-efdbcd118c22'

@pytest.fixture
def beacon_setup(client,monkeypatch):
    for key,value in {'ENABLED':'true','UUID':BEACON_UUID,'MAJOR':'1','MINOR':'7'}.items():
        monkeypatch.setenv('SAI_BEACON_'+key,value)
    identifier,email=account('member');signin(client,email)
    clock=[int(time.time())]
    monkeypatch.setattr(time,'time',lambda:clock[0])
    paired=write(client,'/beacon/devices',{'platform':'ios','consent':True})
    assert paired.status_code==201,paired.text
    token=paired.json()['deviceToken']
    def event(state='inside',**overrides):
        clock[0]+=1
        return {'eventId':str(uuid4()),'roomId':'sai-room','state':state,'uuid':BEACON_UUID,'major':1,'minor':7,'observedAt':clock[0]*1000,**overrides}
    def send(body,credential=token):
        return client.post('/api/v1/beacon/events',json=body,headers={'Authorization':'Bearer '+credential})
    return identifier,clock,event,send,token

def test_beacon_default_off_and_approved_consent_required(client,monkeypatch):
    monkeypatch.delenv('SAI_BEACON_ENABLED',raising=False)
    assert client.get('/api/v1/beacon/config').status_code==401
    _,email=account('member');signin(client,email)
    assert client.get('/api/v1/beacon/config').json()['enabled'] is False
    assert write(client,'/beacon/devices',{'platform':'ios','consent':True}).status_code==503
    _,pending=account('member','pending');signin(client,pending)
    assert client.get('/api/v1/beacon/config').status_code==403

def test_beacon_credential_is_scoped_hashed_revocable_and_user_bound(client,beacon_setup):
    identifier,clock,event,send,token=beacon_setup
    assert client.get('/api/v1/beacon/config').json()['paired'] is True
    with database.get_connection() as conn:
        row=conn.execute('SELECT * FROM beacon_devices').fetchone()
        assert row['user_id']==identifier and row['token_hash']!=token
    assert write(client,'/beacon/devices',{'platform':'ios','consent':False}).status_code==422
    assert write(client,'/beacon/devices',{'platform':'web','consent':True}).status_code==422
    assert client.post('/api/v1/beacon/devices',json={'platform':'ios','consent':True}).status_code==403
    assert send(event(userId='someone-else')).status_code==422
    assert send(event()).status_code==200
    client.cookies.clear()
    assert client.get('/api/v1/bootstrap',headers={'Authorization':'Bearer '+token}).status_code==401
    assert client.get('/api/v1/admin/membership-applications',headers={'Authorization':'Bearer '+token}).status_code==401
    assert send(event()).status_code==200  # independent of foreground cookie
    with database.get_connection() as conn:
        conn.execute("UPDATE users SET status='rejected' WHERE id=?",(identifier,))
    assert send(event()).status_code==401

def test_beacon_enter_exit_grace_reentry_and_duplicate_events(client,beacon_setup):
    identifier,clock,event,send,token=beacon_setup
    first=event();assert send(first).json()['accepted']
    snapshot=lambda:client.get('/api/v1/rooms/sai-room/occupancy').json()
    before=snapshot();assert before['count']==1 and before['checkedIn']
    assert send(first).json()['reason']=='duplicate_or_older'
    assert send(event(observedAt=first['observedAt']-1)).json()['accepted'] is False
    assert snapshot()['sequence']==before['sequence']
    with database.get_connection() as conn:
        checked_in=conn.execute('SELECT checked_in_at FROM presence').fetchone()[0]
    assert send(event('outside')).status_code==200
    clock[0]+=90
    assert snapshot()['count']==1
    assert send(event('inside')).status_code==200  # signal recovers before departure
    clock[0]+=40
    assert snapshot()['count']==1 and snapshot()['sequence']==before['sequence']
    with database.get_connection() as conn:
        assert conn.execute('SELECT checked_in_at FROM presence').fetchone()[0]==checked_in
    assert send(event('outside')).status_code==200
    clock[0]+=70
    assert send(event('outside')).status_code==200  # never extends original deadline
    clock[0]+=51
    assert snapshot()['count']==0 and snapshot()['sequence']>before['sequence']

def test_beacon_manual_actions_take_priority_and_do_not_erase_other_people(client,beacon_setup):
    identifier,clock,event,send,token=beacon_setup
    other,_=account('member')
    with database.get_connection() as conn:
        conn.execute('INSERT INTO presence VALUES (?,?,?)',(other,clock[0],clock[0]+3600))
    send(event())
    assert write(client,'/me/presence',None,'DELETE').status_code==200
    assert send(event()).json()['reason']=='manual_override'
    assert client.get('/api/v1/rooms/sai-room/occupancy').json()['count']==1
    clock[0]+=301
    assert send(event()).json()['accepted']
    assert write(client,'/me/presence').status_code==200
    send(event('outside'));clock[0]+=121
    assert client.get('/api/v1/rooms/sai-room/occupancy').json()['count']==2
    assert write(client,'/beacon/devices',None,'DELETE').status_code==204
    assert client.get('/api/v1/rooms/sai-room/occupancy').json()['count']==2
    assert send(event()).status_code==401

def test_beacon_repair_invalidates_old_device_and_disconnect_clears_only_owned_presence(client,beacon_setup):
    identifier,clock,event,send,token=beacon_setup
    send(event())
    new=write(client,'/beacon/devices',{'platform':'android','consent':True})
    assert new.status_code==201
    assert client.get('/api/v1/rooms/sai-room/occupancy').json()['count']==0
    assert send(event()).status_code==401
    assert send(event(),new.json()['deviceToken']).status_code==200
    assert write(client,'/beacon/devices',None,'DELETE').status_code==204
    assert client.get('/api/v1/rooms/sai-room/occupancy').json()['count']==0
    assert client.get('/api/v1/beacon/config').json()['paired'] is False

def test_beacon_rejects_wrong_room_stale_and_expired_credentials(client,beacon_setup):
    identifier,clock,event,send,token=beacon_setup
    assert send(event(minor=8)).json()['error']['code']=='UNKNOWN_BEACON'
    assert send(event(uuid=str(uuid4()))).status_code==422
    assert send(event(roomId='other-room')).status_code==422
    assert send(event(major=True)).status_code==422
    assert send(event(observedAt=(clock[0]-121)*1000)).json()['error']['code']=='STALE_BEACON_EVENT'
    assert send(event(observedAt=(clock[0]+122)*1000)).status_code==422
    with database.get_connection() as conn:
        conn.execute('UPDATE beacon_devices SET expires_at=?',(clock[0]-1,))
    assert send(event()).status_code==401
    assert client.get('/api/v1/beacon/config').json()['paired'] is False

def test_rate_limits_remain_independent_across_window_durations(client):
    from fastapi import HTTPException
    security.rate_limit('login-test','account',1,900)
    security.rate_limit('beacon-test','device',1,60)
    with pytest.raises(HTTPException) as error:
        security.rate_limit('login-test','account',1,900)
    assert error.value.status_code==429

def test_beacon_lease_expires_and_fresh_events_renew_active_device(client,beacon_setup):
    identifier,clock,event,send,token=beacon_setup
    first=send(event()).json()
    with database.get_connection() as conn:
        initial_checkin=conn.execute('SELECT checked_in_at FROM presence').fetchone()[0]
    clock[0]+=29*86400
    renewed=send(event()).json()
    assert renewed['deviceExpiresAt']>first['deviceExpiresAt']
    with database.get_connection() as conn:
        assert conn.execute('SELECT checked_in_at FROM presence').fetchone()[0]>initial_checkin
        email=conn.execute('SELECT email FROM users WHERE id=?',(identifier,)).fetchone()[0]
    clock[0]+=12*3600+1
    signin(client,email)  # the foreground cookie has correctly expired by day 29
    assert client.get('/api/v1/rooms/sai-room/occupancy').json()['count']==0
    clock[0]+=2*86400
    assert send(event()).status_code==200  # usable past original 30-day expiry


def test_android_presence_expires_without_fresh_advertisements(client,beacon_setup):
    identifier,clock,event,send,_=beacon_setup
    token=write(client,'/beacon/devices',{'platform':'android','consent':True}).json()['deviceToken']
    assert send(event(),token).status_code==200
    clock[0]+=240
    assert send(event(),token).status_code==200
    clock[0]+=240
    assert client.get('/api/v1/rooms/sai-room/occupancy').json()['count']==1
    clock[0]+=61
    assert client.get('/api/v1/rooms/sai-room/occupancy').json()['count']==0
