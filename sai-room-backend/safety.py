"""Account lifecycle and private community moderation."""
import time
from typing import Literal
from uuid import uuid4
from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from database import get_connection
from auth import verify_password
from security import COOKIE, audit, csrf_check, current_user, fail, rate_limit
from api_v1 import allowed_post, auth_write, STAFF
from community_policy import POLICY_VERSION, visible

router = APIRouter(prefix='/api/v1')
class Input(BaseModel):
    model_config = ConfigDict(extra='forbid')
class Password(Input):
    currentPassword: str = Field(min_length=1, max_length=128)
class Transfer(Password):
    userId: str
class Consent(Input):
    version: Literal['2026-11-23']
class Report(Input):
    targetKind: Literal['post', 'comment']
    targetId: str = Field(max_length=100)
    reason: Literal['욕설·괴롭힘', '음란·폭력', '개인정보', '스팸', '기타']
    detail: str = Field(default='', max_length=1000)
class Block(Input):
    targetKind: Literal['post', 'comment']
    targetId: str = Field(max_length=100)
class Review(Input):
    action: Literal['remove', 'dismiss']

def public_target(conn, kind, identifier, user):
    if kind == 'post':
        row = allowed_post(conn, identifier, user)
        if row['kind'] != 'public': fail(404, 'NOT_FOUND')
    else:
        row = conn.execute('SELECT * FROM comments WHERE id=?', (identifier,)).fetchone()
        if not row: fail(404, 'NOT_FOUND')
        post = allowed_post(conn, row['post_id'], user)
        if post['kind'] != 'public' or not visible(conn, row, user, 'comment'): fail(404, 'NOT_FOUND')
    return row

@router.post('/me/community-consent', status_code=204)
def consent(data: Consent, request: Request):
    user = auth_write(request)
    with get_connection() as conn:
        conn.execute('INSERT INTO policy_acceptance VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET version=excluded.version,accepted_at=excluded.accepted_at', (user['id'], data.version, int(time.time())))

@router.post('/reports', status_code=201)
def report(data: Report, request: Request):
    user = auth_write(request)
    rate_limit('reports', user['id'], 20, 3600)
    with get_connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        target = public_target(conn, data.targetKind, data.targetId, user)
        if target['author_id'] == user['id']: fail(422, 'OWN_CONTENT')
        old = conn.execute('SELECT id FROM safety_reports WHERE reporter_id=? AND target_kind=? AND target_id=?', (user['id'], data.targetKind, data.targetId)).fetchone()
        if old: return {'id': old['id']}
        identifier = str(uuid4())
        conn.execute("INSERT INTO safety_reports (id,reporter_id,target_kind,target_id,reason,detail,status,created_at) VALUES (?,?,?,?,?,?,'pending',?)", (identifier, user['id'], data.targetKind, data.targetId, data.reason, data.detail.strip(), int(time.time())))
        return {'id': identifier}

@router.post('/me/blocks', status_code=201)
def block(data: Block, request: Request):
    user = auth_write(request)
    with get_connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        target = public_target(conn, data.targetKind, data.targetId, user)
        if target['author_id'] == user['id'] or not target['author_id']: fail(422, 'OWN_CONTENT')
        conn.execute('INSERT INTO member_blocks VALUES (?,?,?,?) ON CONFLICT(user_id,blocked_id) DO NOTHING', (str(uuid4()), user['id'], target['author_id'], int(time.time())))
    return {'blocked': True}

@router.get('/me/blocks')
def blocks(request: Request):
    user = current_user(request)
    with get_connection() as conn:
        return [{'id': r['id'], 'createdAt': r['created_at']*1000} for r in conn.execute('SELECT id,created_at FROM member_blocks WHERE user_id=? ORDER BY created_at', (user['id'],))]

@router.delete('/me/blocks/{block_id}', status_code=204)
def unblock(block_id: str, request: Request):
    user = auth_write(request)
    with get_connection() as conn:
        if conn.execute('DELETE FROM member_blocks WHERE id=? AND user_id=?', (block_id, user['id'])).rowcount != 1: fail(404, 'NOT_FOUND')

@router.get('/staff/reports')
def reports(request: Request):
    current_user(request, roles=STAFF)
    with get_connection() as conn:
        result = []
        for row in conn.execute('SELECT * FROM safety_reports ORDER BY created_at DESC LIMIT 200'):
            table = 'posts' if row['target_kind'] == 'post' else 'comments'
            target = conn.execute(f'SELECT body FROM {table} WHERE id=?', (row['target_id'],)).fetchone()
            result.append({'id': row['id'], 'targetKind': row['target_kind'], 'reason': row['reason'], 'detail': row['detail'], 'status': row['status'], 'createdAt': row['created_at']*1000, 'body': target['body'] if target else '삭제된 콘텐츠'})
        return result

@router.patch('/staff/reports/{report_id}', status_code=204)
def review(report_id: str, data: Review, request: Request):
    user = auth_write(request, STAFF)
    with get_connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        row = conn.execute('SELECT * FROM safety_reports WHERE id=?', (report_id,)).fetchone()
        if not row: fail(404, 'NOT_FOUND')
        if row['status'] != 'pending': fail(409, 'REPORT_ALREADY_REVIEWED')
        if data.action == 'remove':
            conn.execute('INSERT INTO moderation_hidden VALUES (?,?) ON CONFLICT(target_kind,target_id) DO NOTHING', (row['target_kind'], row['target_id']))
        conn.execute('UPDATE safety_reports SET status=? WHERE target_kind=? AND target_id=? AND status=?', (data.action, row['target_kind'], row['target_id'], 'pending'))
        audit(conn, user['id'], 'report.'+data.action, report_id)

@router.post('/admin/transfer', status_code=204)
def transfer(data: Transfer, request: Request):
    user = auth_write(request, ('admin',))
    rate_limit('admin-transfer', user['id'], 5, 900)
    if not verify_password(data.currentPassword, user['password_hash']): fail(422, 'PASSWORD_MISMATCH')
    with get_connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        target = conn.execute("SELECT id FROM users WHERE id=? AND status='approved' AND id!=?", (data.userId, user['id'])).fetchone()
        if not target: fail(422, 'INVALID_SUCCESSOR')
        conn.execute("UPDATE users SET role='admin' WHERE id=?", (data.userId,))
        conn.execute("UPDATE users SET role='operator' WHERE id=?", (user['id'],))
        audit(conn, user['id'], 'admin.transferred', data.userId)

@router.delete('/me/account', status_code=204)
def delete_account(data: Password, request: Request, response: Response):
    csrf_check(request)
    user = current_user(request, approved=False)
    rate_limit('delete-account', user['id'], 5, 900)
    if not verify_password(data.currentPassword, user['password_hash']): fail(422, 'PASSWORD_MISMATCH')
    uid = user['id']
    with get_connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        if user['role'] == 'admin' and not conn.execute("SELECT 1 FROM users WHERE role='admin' AND status='approved' AND id!=?", (uid,)).fetchone():
            fail(409, 'LAST_ADMIN_TRANSFER_REQUIRED')
        # Delete personal content and credentials atomically, including native tokens.
        conn.execute('DELETE FROM safety_reports WHERE reporter_id=? OR (target_kind=? AND target_id IN (SELECT id FROM posts WHERE author_id=?)) OR (target_kind=? AND target_id IN (SELECT id FROM comments WHERE author_id=? OR post_id IN (SELECT id FROM posts WHERE author_id=?)))', (uid, 'post', uid, 'comment', uid, uid))
        conn.execute('DELETE FROM moderation_hidden WHERE (target_kind=? AND target_id IN (SELECT id FROM posts WHERE author_id=?)) OR (target_kind=? AND target_id IN (SELECT id FROM comments WHERE author_id=? OR post_id IN (SELECT id FROM posts WHERE author_id=?)))', ('post', uid, 'comment', uid, uid))
        conn.execute('DELETE FROM comments WHERE author_id=?', (uid,))
        conn.execute('DELETE FROM posts WHERE author_id=?', (uid,))
        conn.execute('DELETE FROM reservations WHERE owner=?', (uid,))
        conn.execute('DELETE FROM ball_images WHERE owner_id=?', (uid,))
        for table in ('sessions', 'web_sessions', 'request_keys', 'presence', 'beacon_devices', 'policy_acceptance'):
            conn.execute(f'DELETE FROM {table} WHERE user_id=?', (uid,))
        conn.execute('DELETE FROM member_blocks WHERE user_id=? OR blocked_id=?', (uid, uid))
        conn.execute('UPDATE operator_code SET updated_by=NULL WHERE updated_by=?', (uid,))
        conn.execute('DELETE FROM audit_events WHERE actor_id=? OR subject_id=?', (uid, uid))
        conn.execute('DELETE FROM users WHERE id=?', (uid,))
        conn.execute('UPDATE room_state SET sequence=sequence+1 WHERE id=1')
    response.delete_cookie(COOKIE, path='/', httponly=True, samesite='strict')
