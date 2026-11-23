"""Beacon-based room presence.

Phones running the SAI app report that they currently sense the club-room beacon.
The server stores only the last report per (member, device), uses its OWN clock,
and counts each approved member at most once no matter how many devices or
repeated requests there are. All state lives in the shared database (SQLite or
PostgreSQL), never in process memory, so a restart or several server instances
do not break the count.

Security note: beacon identifiers (UUID/Major/Minor) are broadcast in the clear. They
are a room *identifier*, not a password and not an access credential. A signed-in member
could post a false "inside" report; this is accepted for a club headcount and is limited by
approval, authentication, rate limiting and the expiry window. Do not use this count for
door access or attendance that must be tamper-proof.
"""
import re
import time
from datetime import datetime
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Request
from pydantic import Field

import api_v1
from database import get_connection
from security import PRODUCTION, audit, current_user, fail, rate_limit

router = APIRouter(prefix='/api/v1')
UUID_RE = re.compile(r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')
MAX_DEVICES_PER_USER = 5


def now():
    """Server clock in seconds. Tests replace this to move time without sleeping."""
    return time.time()


def simulator_allowed():
    return not PRODUCTION


def load_settings(conn):
    row = conn.execute('SELECT * FROM beacon_settings WHERE id=1').fetchone()
    if row is None:
        # Fresh or truncated database: create the single row with TEST defaults.
        conn.execute('INSERT INTO beacon_settings (id) VALUES (1) ON CONFLICT(id) DO NOTHING')
        row = conn.execute('SELECT * FROM beacon_settings WHERE id=1').fetchone()
    return row


def config_json(row):
    return {
        'enabled': bool(row['enabled']),
        'configured': bool(row['uuid']),
        'uuid': row['uuid'],
        'major': row['major'],
        'minor': row['minor'],
        'enterRssi': row['enter_rssi'],
        'exitRssi': row['exit_rssi'],
        'reportIntervalSeconds': row['report_interval'],
        'exitGraceSeconds': row['exit_grace'],
        'referenceCapacity': row['reference_capacity'],
        'version': row['version'],
        'updatedAt': row['updated_at'],
        # True until staff save the values once: the shipped numbers are TEST defaults.
        'usingTestDefaults': row['version'] == 1,
        'simulatorAllowed': simulator_allowed(),
    }


def bump_sequence(conn):
    conn.execute('UPDATE room_state SET sequence=sequence+1 WHERE id=1')


def purge(conn, settings, t):
    """Drop beacon rows that are no longer inside the exit-grace window."""
    cutoff = int(t * 1000) - settings['exit_grace'] * 1000
    return conn.execute('DELETE FROM beacon_presence WHERE last_seen_at<=?', (cutoff,)).rowcount


def active_since(conn, settings, t):
    """{user_id: entered_at_ms} of approved members currently counted (manual or beacon)."""
    result = {}
    for r in conn.execute(
            "SELECT p.user_id, p.checked_in_at*1000 AS since FROM presence p JOIN users u ON u.id=p.user_id "
            "WHERE p.expires_at>? AND u.status='approved'", (int(t),)).fetchall():
        result[r['user_id']] = r['since']
    if settings['enabled']:
        cutoff = int(t * 1000) - settings['exit_grace'] * 1000
        for r in conn.execute(
                "SELECT b.user_id, MIN(b.entered_at) AS since FROM beacon_presence b JOIN users u ON u.id=b.user_id "
                "WHERE b.last_seen_at>? AND u.status='approved' GROUP BY b.user_id", (cutoff,)).fetchall():
            result[r['user_id']] = min(result.get(r['user_id'], r['since']), r['since'])
    return result


def last_detection_iso(conn):
    row = conn.execute('SELECT MAX(last_seen_at) AS m FROM beacon_presence').fetchone()
    if not row or row['m'] is None:
        return None
    return datetime.fromtimestamp(row['m'] / 1000, ZoneInfo('UTC')).isoformat()


class Report(api_v1.Input):
    state: Literal['inside', 'outside']
    rssi: int | None = Field(default=None, ge=-127, le=20)
    uuid: str | None = Field(default=None, max_length=36)
    major: int | None = Field(default=None, ge=0, le=65535)
    minor: int | None = Field(default=None, ge=0, le=65535)
    deviceId: str = Field(default='default', pattern=r'^[A-Za-z0-9_-]{1,64}$')
    source: Literal['native', 'simulator'] = 'native'


class ConfigInput(api_v1.Input):
    version: int = Field(ge=1)
    enabled: bool
    uuid: str | None = Field(default=None, max_length=36)
    major: int | None = Field(default=None, ge=0, le=65535)
    minor: int | None = Field(default=None, ge=0, le=65535)
    enterRssi: int = Field(ge=-120, le=-30)
    exitRssi: int = Field(ge=-120, le=-30)
    reportIntervalSeconds: int = Field(ge=10, le=300)
    exitGraceSeconds: int = Field(ge=30, le=900)
    referenceCapacity: int = Field(ge=1, le=100)


@router.get('/rooms/{room_id}/beacon-config')
def get_config(room_id: str, request: Request):
    api_v1.room_check(room_id)
    current_user(request)
    with get_connection() as conn:
        return config_json(load_settings(conn))


@router.put('/rooms/{room_id}/beacon-config')
def put_config(room_id: str, data: ConfigInput, request: Request):
    api_v1.room_check(room_id)
    user = api_v1.auth_write(request, api_v1.STAFF)
    uuid = data.uuid.strip().lower() if data.uuid else None
    if uuid is not None and not UUID_RE.match(uuid):
        fail(422, 'INVALID_BEACON_UUID')
    if data.enabled and not uuid:
        fail(422, 'BEACON_UUID_REQUIRED')
    if data.minor is not None and data.major is None:
        fail(422, 'MAJOR_REQUIRED_FOR_MINOR')
    if data.exitRssi > data.enterRssi:
        fail(422, 'INVALID_THRESHOLDS')
    # The grace window must tolerate at least one missed report, otherwise the count flickers.
    if data.exitGraceSeconds < 2 * data.reportIntervalSeconds:
        fail(422, 'GRACE_TOO_SHORT')

    def action(conn):
        before = load_settings(conn)
        result = conn.execute(
            'UPDATE beacon_settings SET enabled=?,uuid=?,major=?,minor=?,enter_rssi=?,exit_rssi=?,report_interval=?,'
            'exit_grace=?,reference_capacity=?,version=version+1,updated_at=?,updated_by=? WHERE id=1 AND version=?',
            (int(data.enabled), uuid, data.major, data.minor, data.enterRssi, data.exitRssi, data.reportIntervalSeconds,
             data.exitGraceSeconds, data.referenceCapacity, api_v1.now_ms(), user['id'], data.version))
        if result.rowcount != 1:
            fail(409, 'BEACON_CONFIG_CONFLICT')
        # Reports made for a different beacon identity must not keep counting people.
        if (before['uuid'], before['major'], before['minor']) != (uuid, data.major, data.minor) or not data.enabled:
            conn.execute('DELETE FROM beacon_presence')
        bump_sequence(conn)
        audit(conn, user['id'], 'beacon.config')
        return config_json(load_settings(conn))

    return api_v1.mutation(request, user, data.model_dump(), action)


def _matches(settings, data):
    if not data.uuid or data.uuid.strip().lower() != settings['uuid']:
        return False
    if settings['major'] is not None and data.major != settings['major']:
        return False
    if settings['minor'] is not None and data.minor != settings['minor']:
        return False
    return True


@router.post('/me/beacon-presence')
def report(data: Report, request: Request):
    # The member comes from the authenticated session. Any user id in the body is rejected
    # by the schema (extra='forbid'), so a client can only ever report for itself.
    user = api_v1.auth_write(request)
    if data.source == 'simulator' and not simulator_allowed():
        fail(403, 'SIMULATOR_DISABLED')
    rate_limit('beacon', user['id'], 40, 60)
    with get_connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        settings = load_settings(conn)
        if not settings['enabled']:
            fail(409, 'BEACON_DISABLED')
        if not settings['uuid']:
            fail(409, 'BEACON_NOT_CONFIGURED')
        t = now()
        stamp = int(t * 1000)
        cutoff = stamp - settings['exit_grace'] * 1000
        purge(conn, settings, t)
        before = set(active_since(conn, settings, t))
        accepted = False
        if data.state == 'outside':
            conn.execute('DELETE FROM beacon_presence WHERE user_id=? AND device_id=?', (user['id'], data.deviceId))
            accepted = True
        else:
            if not _matches(settings, data):
                fail(422, 'BEACON_MISMATCH')
            if data.rssi is None:
                fail(422, 'RSSI_REQUIRED')
            existing = conn.execute('SELECT last_seen_at FROM beacon_presence WHERE user_id=? AND device_id=?',
                                    (user['id'], data.deviceId)).fetchone()
            fresh = bool(existing) and existing['last_seen_at'] > cutoff
            # Hysteresis: it takes a stronger signal to enter than to stay.
            if data.rssi >= settings['enter_rssi'] or (fresh and data.rssi >= settings['exit_rssi']):
                conn.execute(
                    'INSERT INTO beacon_presence (user_id,device_id,entered_at,last_seen_at,rssi,source) VALUES (?,?,?,?,?,?) '
                    'ON CONFLICT(user_id,device_id) DO UPDATE SET last_seen_at=excluded.last_seen_at,rssi=excluded.rssi,'
                    'source=excluded.source,entered_at=CASE WHEN ?=1 THEN beacon_presence.entered_at ELSE excluded.entered_at END',
                    (user['id'], data.deviceId, stamp, stamp, data.rssi, data.source, int(fresh)))
                conn.execute(
                    'DELETE FROM beacon_presence WHERE user_id=? AND device_id NOT IN '
                    '(SELECT device_id FROM beacon_presence WHERE user_id=? ORDER BY last_seen_at DESC LIMIT ?)',
                    (user['id'], user['id'], MAX_DEVICES_PER_USER))
                accepted = True
        after = set(active_since(conn, settings, t))
        if before != after:
            bump_sequence(conn)
        return {
            'accepted': accepted,
            'present': user['id'] in after,
            'observedAt': datetime.fromtimestamp(t, ZoneInfo('UTC')).isoformat(),
        }
