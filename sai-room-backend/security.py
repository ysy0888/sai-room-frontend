"""Cookie sessions and invitation lifecycle for the same-origin application."""
import os
import re
import secrets
import time
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4
from hmac import compare_digest
from fastapi import HTTPException, Request, Response
from database import get_connection, DB_PATH, postgres_enabled
from auth import hash_password, verify_password, token_hash

PRODUCTION = os.environ.get('SAI_ENV') == 'production'
vercel_domain = os.environ.get('VERCEL_PROJECT_PRODUCTION_URL') if os.environ.get('VERCEL') == '1' else None
PUBLIC_ORIGIN = (os.environ.get('SAI_PUBLIC_ORIGIN') or (f'https://{vercel_domain}' if vercel_domain else None) or os.environ.get('RENDER_EXTERNAL_URL') or 'http://127.0.0.1:5317').rstrip('/')
origin_parts = urlsplit(PUBLIC_ORIGIN)
if not origin_parts.hostname or origin_parts.username or origin_parts.password or origin_parts.path or origin_parts.query or origin_parts.fragment:
    raise RuntimeError('SAI_PUBLIC_ORIGIN must be an origin without a path or credentials')
if PRODUCTION and not PUBLIC_ORIGIN.startswith('https://'):
    raise RuntimeError('Production requires SAI_PUBLIC_ORIGIN=https://your-domain')
# Only deployment domains supplied by the hosting environment are trusted.
# Never accept arbitrary vercel.app hosts or derive trust from request headers.
TRUSTED_ORIGINS = {PUBLIC_ORIGIN}
if PRODUCTION and os.environ.get('VERCEL') == '1':
    for key in ('VERCEL_URL', 'VERCEL_BRANCH_URL'):
        domain = os.environ.get(key, '')
        if domain and re.fullmatch(r'[a-z0-9-]+\.vercel\.app', domain):
            TRUSTED_ORIGINS.add('https://' + domain)
COOKIE = '__Host-sai_session' if PRODUCTION else 'sai_session'
SESSION_SECONDS = 8 * 3600
DUMMY_HASH = hash_password(secrets.token_urlsafe(32))


def fail(status, code):
    raise HTTPException(status, detail={'code': code})


def normalize_email(value):
    value = value.strip().lower()
    if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', value) or len(value) > 254:
        fail(422, 'INVALID_EMAIL')
    return value


def initial_operator_code():
    with get_connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        if conn.execute('SELECT 1 FROM operator_code WHERE id=1').fetchone():
            return
        code = os.environ.get('SAI_INITIAL_OPERATOR_CODE') or 'SAI-' + secrets.token_urlsafe(18)
        if len(code) < 12 or len(code) > 128 or code == 'SAI-STAFF-DEMO':
            raise RuntimeError('Initial operator code must be 12–128 characters, never the public demo code')
        # The local file is deliberately outside the publicly served directories.
        if not os.environ.get('SAI_INITIAL_OPERATOR_CODE') and not postgres_enabled():
            target = Path(str(DB_PATH) + '.initial-operator-code')
            fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, 'w') as file:
                file.write(code + '\n')
        conn.execute('INSERT INTO operator_code VALUES (1,?,1,?,NULL)', (hash_password(code), int(time.time()*1000)))


def rate_limit(scope, subject, limit, seconds=900):
    # Each scope has its own window duration. A short beacon window must not
    # remove the longer login / invitation-code counters during cleanup.
    prefix = token_hash(scope) + ':'
    key = prefix + token_hash(subject)
    window = int(time.time()) // seconds
    with get_connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        conn.execute('INSERT INTO rate_limits VALUES (?,?,1) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN rate_limits.window=excluded.window THEN rate_limits.attempts+1 ELSE 1 END,window=excluded.window', (key,window))
        attempts = conn.execute('SELECT attempts FROM rate_limits WHERE key=?', (key,)).fetchone()[0]
        conn.execute('DELETE FROM rate_limits WHERE key LIKE ? AND window<?', (prefix+'%',window-2))
    if attempts > limit:
        fail(429, 'RATE_LIMITED')


def session(request):
    value = request.cookies.get(COOKIE, '')
    if not value or len(value) > 128:
        fail(401, 'AUTH_REQUIRED')
    with get_connection() as conn:
        row = conn.execute('SELECT * FROM web_sessions WHERE token_hash=? AND expires_at>?', (token_hash(value), int(time.time()))).fetchone()
    if not row:
        fail(401, 'AUTH_REQUIRED')
    return row


def issue_session(request, response, user_id=None):
    token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    duration = SESSION_SECONDS if user_id else 1800
    with get_connection() as conn:
        old = request.cookies.get(COOKIE)
        if old:
            conn.execute('DELETE FROM web_sessions WHERE token_hash=?', (token_hash(old),))
        conn.execute('DELETE FROM web_sessions WHERE expires_at<=?', (int(time.time()),))
        conn.execute('INSERT INTO web_sessions VALUES (?,?,?,?)', (token_hash(token), user_id, csrf, int(time.time())+duration))
    response.set_cookie(COOKIE, token, max_age=duration, httponly=True, secure=PRODUCTION, samesite='strict', path='/')
    return csrf


def csrf_check(request):
    origin = request.headers.get('origin')
    allowed = TRUSTED_ORIGINS if PRODUCTION else {PUBLIC_ORIGIN, str(request.base_url).rstrip('/')}
    if origin and origin not in allowed:
        fail(403, 'CSRF_FAILED')
    if request.headers.get('sec-fetch-site') == 'cross-site':
        fail(403, 'CSRF_FAILED')
    row = session(request)
    token = request.headers.get('x-csrf-token', '')
    if not token or not compare_digest(token, row['csrf']):
        fail(403, 'CSRF_FAILED')
    return row


def current_user(request, approved=True, roles=None):
    row = session(request)
    with get_connection() as conn:
        user = conn.execute('SELECT * FROM users WHERE id=?', (row['user_id'],)).fetchone()
    if not user:
        fail(401, 'AUTH_REQUIRED')
    if approved and user['status'] != 'approved':
        fail(403, 'MEMBERSHIP_REQUIRED')
    if roles and user['role'] not in roles:
        fail(403, 'FORBIDDEN')
    return user


def audit(conn, actor_id, action, subject=None):
    conn.execute('INSERT INTO audit_events VALUES (?,?,?,?,?)', (str(uuid4()),actor_id,action,subject,int(time.time()*1000)))
