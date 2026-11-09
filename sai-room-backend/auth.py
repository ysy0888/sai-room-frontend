"""SAI ROOM membership and approval APIs. Python standard-library crypto."""
import hashlib
import hmac
import secrets
import sqlite3
import time
from uuid import uuid4
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field
from database import get_connection

router = APIRouter(prefix='/auth', tags=['회원가입·로그인'])
ITERATIONS = 600000
SESSION_SECONDS = 7 * 24 * 3600


def hash_password(password, salt=None):
    salt = salt or secrets.token_bytes(16)
    derived = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, ITERATIONS)
    return f'pbkdf2_sha256${ITERATIONS}${salt.hex()}${derived.hex()}'


def verify_password(password, stored):
    try:
        scheme, rounds, salt_hex, expected = stored.split('$')
        if scheme != 'pbkdf2_sha256':
            return False
        actual = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), bytes.fromhex(salt_hex), int(rounds))
        return hmac.compare_digest(actual, bytes.fromhex(expected))
    except (ValueError, TypeError):
        return False


def token_hash(token):
    return hashlib.sha256(token.encode('utf-8')).hexdigest()


def public_user(row):
    return {k: row[k] for k in ('id', 'name', 'student_id', 'username', 'role', 'status')}


def require_user(authorization: str | None):
    if not authorization or not authorization.startswith('Bearer '):
        raise HTTPException(401, '로그인이 필요합니다.')
    token = authorization[7:].strip()
    if not token:
        raise HTTPException(401, '로그인이 필요합니다.')
    with get_connection() as conn:
        row = conn.execute('''SELECT users.* FROM sessions JOIN users ON sessions.user_id=users.id
            WHERE sessions.token_hash=? AND sessions.expires_at>?''', (token_hash(token), int(time.time()))).fetchone()
    if not row or row['status'] != 'approved':
        raise HTTPException(401, '로그인 정보가 만료되었거나 승인되지 않은 계정입니다.')
    return row


def require_admin(authorization):
    user = require_user(authorization)
    if user['role'] != 'admin':
        raise HTTPException(403, '운영진만 접근할 수 있습니다.')
    return user


class SignupInput(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    student_id: str = Field(min_length=4, max_length=20)
    username: str = Field(min_length=4, max_length=30, pattern=r'^[A-Za-z0-9_]+$')
    password: str = Field(min_length=8, max_length=128)


class LoginInput(BaseModel):
    username: str
    password: str


@router.post('/signup', status_code=201)
def signup(data: SignupInput):
    if not data.name.strip() or not data.student_id.strip():
        raise HTTPException(400, '이름과 학번을 입력해주세요.')
    with get_connection() as conn:
        try:
            conn.execute('''INSERT INTO users (id, name, student_id, username, password_hash, role, status, created_at)
                VALUES (?, ?, ?, ?, ?, 'member', 'pending', ?)''',
                (str(uuid4()), data.name.strip(), data.student_id.strip(), data.username.lower(), hash_password(data.password), int(time.time())))
            conn.commit()
        except sqlite3.IntegrityError:
            raise HTTPException(409, '이미 사용 중인 아이디 또는 학번입니다.')
    return {'message': '가입 신청이 완료되었습니다. 운영진 승인을 기다려주세요.', 'status': 'pending'}


@router.post('/login')
def login(data: LoginInput):
    with get_connection() as conn:
        row = conn.execute('SELECT * FROM users WHERE username=?', (data.username.lower().strip(),)).fetchone()
        if not row or not verify_password(data.password, row['password_hash']):
            raise HTTPException(401, '아이디 또는 비밀번호가 올바르지 않습니다.')
        if row['status'] == 'pending':
            raise HTTPException(403, '운영진 승인 대기 중입니다.')
        if row['status'] != 'approved':
            raise HTTPException(403, '승인되지 않은 계정입니다.')
        token = secrets.token_urlsafe(32)
        conn.execute('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
                     (token_hash(token), row['id'], int(time.time()) + SESSION_SECONDS))
        conn.commit()
    return {'access_token': token, 'token_type': 'bearer', 'user': public_user(row)}


@router.get('/me')
def me(authorization: str | None = Header(default=None)):
    return public_user(require_user(authorization))


@router.post('/logout')
def logout(authorization: str | None = Header(default=None)):
    require_user(authorization)
    with get_connection() as conn:
        conn.execute('DELETE FROM sessions WHERE token_hash=?', (token_hash(authorization[7:].strip()),))
        conn.commit()
    return {'message': '로그아웃되었습니다.'}


@router.get('/pending')
def pending(authorization: str | None = Header(default=None)):
    require_admin(authorization)
    with get_connection() as conn:
        rows = conn.execute("SELECT * FROM users WHERE status='pending' ORDER BY created_at").fetchall()
    return {'users': [public_user(r) for r in rows]}


@router.post('/users/{user_id}/approve')
def approve(user_id: str, authorization: str | None = Header(default=None)):
    require_admin(authorization)
    with get_connection() as conn:
        cursor = conn.execute("UPDATE users SET status='approved' WHERE id=? AND status='pending' AND role='member'", (user_id,))
        conn.commit()
    if cursor.rowcount == 0:
        raise HTTPException(404, '승인 대기 중인 회원을 찾을 수 없습니다.')
    return {'message': '회원 가입을 승인했습니다.'}


@router.post('/users/{user_id}/reject')
def reject(user_id: str, authorization: str | None = Header(default=None)):
    require_admin(authorization)
    with get_connection() as conn:
        cursor = conn.execute("UPDATE users SET status='rejected' WHERE id=? AND status='pending' AND role='member'", (user_id,))
        conn.commit()
    if cursor.rowcount == 0:
        raise HTTPException(404, '승인 대기 중인 회원을 찾을 수 없습니다.')
    return {'message': '회원 가입을 거절했습니다.'}
