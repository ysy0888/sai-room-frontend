"""Shared visibility and community policy checks; never expose anonymous author IDs."""
import os
import re
import unicodedata
from security import fail

POLICY_VERSION = '2026-11-23'

def visible(conn, row, user, kind='post'):
    if kind == 'post' and row['kind'] == 'inquiry':
        return row['author_id'] == user['id'] or user['role'] in ('admin', 'operator')
    if conn.execute('SELECT 1 FROM moderation_hidden WHERE target_kind=? AND target_id=?', (kind, row['id'])).fetchone():
        return False
    return not conn.execute('SELECT 1 FROM member_blocks WHERE user_id=? AND blocked_id=?', (user['id'], row['author_id'])).fetchone()

def check_content(conn, user, *texts):
    if not conn.execute('SELECT 1 FROM policy_acceptance WHERE user_id=? AND version=?', (user['id'], POLICY_VERSION)).fetchone():
        fail(422, 'COMMUNITY_CONSENT_REQUIRED')
    # A configurable initial filter, supplemented by member reports and staff review.
    terms = ('죽여버린다', '강간하겠다', '아동성착취') + tuple(filter(None, os.environ.get('SAI_BLOCKED_TERMS', '').split(',')))
    normalized = re.sub(r'\s+', '', unicodedata.normalize('NFKC', ' '.join(texts))).casefold()
    if any(re.sub(r'\s+', '', term).casefold() in normalized for term in terms):
        fail(422, 'CONTENT_NOT_ALLOWED')
