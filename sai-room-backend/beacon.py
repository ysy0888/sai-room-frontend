"""Native background beacon adapter. Disabled until a real room beacon is configured.

The browser never scans in the background. A native app explicitly pairs once,
keeps its presence-only credential in Keychain/Keystore, and reports OS region
transitions. Beacon proximity is a convenience signal, not proof of attendance.
"""
import os
import secrets
import time
from typing import Literal
from uuid import UUID
from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field
from database import get_connection
from auth import token_hash
from security import current_user, csrf_check, fail, rate_limit, audit

router = APIRouter(prefix='/api/v1/beacon')
LEASE_SECONDS = 12 * 3600
EXIT_GRACE_SECONDS = 120
DEVICE_SECONDS = 30 * 86400


def configuration():
    try:
        uuid = str(UUID(os.environ.get('SAI_BEACON_UUID', '')))
        major, minor = int(os.environ['SAI_BEACON_MAJOR']), int(os.environ['SAI_BEACON_MINOR'])
        configured = 0 <= major <= 65535 and 0 <= minor <= 65535
    except (ValueError, KeyError):
        uuid, major, minor, configured = None, None, None, False
    return {'enabled': configured and os.environ.get('SAI_BEACON_ENABLED') == 'true',
            'configured': configured, 'roomId': 'sai-room', 'protocol': 'ibeacon',
            'uuid': uuid, 'major': major, 'minor': minor,
            'exitGraceSeconds': EXIT_GRACE_SECONDS, 'maxPresenceSeconds': LEASE_SECONDS,
            'requiresNativeApp': True}


class DeviceInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    platform: Literal['ios', 'android']
    consent: Literal[True]


class RegionEvent(BaseModel):
    model_config = ConfigDict(extra='forbid')
    eventId: str = Field(min_length=16, max_length=100, pattern=r'^[a-zA-Z0-9_-]+$')
    roomId: Literal['sai-room']
    state: Literal['inside', 'outside']
    uuid: UUID
    major: int = Field(ge=0, le=65535, strict=True)
    minor: int = Field(ge=0, le=65535, strict=True)
    observedAt: int = Field(ge=0, strict=True)  # Unix milliseconds, at most 2 minutes old


@router.get('/config')
def get_config(request: Request):
    user = current_user(request)
    with get_connection() as conn:
        device = conn.execute('SELECT platform,expires_at FROM beacon_devices WHERE user_id=?', (user['id'],)).fetchone()
    return {**configuration(), 'paired': bool(device and device['expires_at'] > int(time.time())),
            'platform': device['platform'] if device else None}


@router.post('/devices', status_code=201)
def pair(data: DeviceInput, request: Request):
    csrf_check(request)
    user = current_user(request)
    if not configuration()['enabled']: fail(503, 'BEACON_NOT_CONFIGURED')
    rate_limit('beacon-pair', user['id'], 5, 3600)
    stamp, token = int(time.time()), secrets.token_urlsafe(48)
    with get_connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        old = conn.execute('SELECT owns_presence FROM beacon_devices WHERE user_id=?', (user['id'],)).fetchone()
        if old and old['owns_presence']:
            conn.execute('DELETE FROM presence WHERE user_id=?', (user['id'],))
            conn.execute('UPDATE room_state SET sequence=sequence+1 WHERE id=1')
        conn.execute('DELETE FROM beacon_devices WHERE user_id=?', (user['id'],))
        conn.execute('INSERT INTO beacon_devices VALUES (?,?,?,?,?,0,\'\',0,0)',
                     (user['id'], token_hash(token), data.platform, stamp, stamp+DEVICE_SECONDS))
        audit(conn, user['id'], 'beacon.paired', data.platform)
    # A scoped token is returned once. It cannot read posts, inquiries or members.
    return {'deviceToken': token, 'expiresAt': stamp+DEVICE_SECONDS, 'scope': 'beacon:presence'}


@router.delete('/devices', status_code=204)
def unpair(request: Request):
    csrf_check(request)
    user = current_user(request)
    with get_connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        old = conn.execute('SELECT owns_presence FROM beacon_devices WHERE user_id=?', (user['id'],)).fetchone()
        if old and old['owns_presence']:
            conn.execute('DELETE FROM presence WHERE user_id=?', (user['id'],))
            conn.execute('UPDATE room_state SET sequence=sequence+1 WHERE id=1')
        conn.execute('DELETE FROM beacon_devices WHERE user_id=?', (user['id'],))
        audit(conn, user['id'], 'beacon.unpaired')


@router.post('/events')
def region_event(data: RegionEvent, request: Request):
    config = configuration()
    if not config['enabled']: fail(503, 'BEACON_NOT_CONFIGURED')
    authorization = request.headers.get('authorization', '')
    if not authorization.startswith('Bearer ') or not 40 <= len(authorization[7:]) <= 128:
        fail(401, 'DEVICE_AUTH_REQUIRED')
    digest, stamp = token_hash(authorization[7:]), int(time.time())
    if abs(data.observedAt - int(time.time()*1000)) > 120000: fail(422, 'STALE_BEACON_EVENT')
    if (str(data.uuid), data.major, data.minor) != (config['uuid'], config['major'], config['minor']):
        fail(422, 'UNKNOWN_BEACON')
    rate_limit('beacon-event', digest, 60, 60)
    with get_connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        device = conn.execute("SELECT d.* FROM beacon_devices d JOIN users u ON u.id=d.user_id WHERE d.token_hash=? AND d.expires_at>? AND u.status='approved'", (digest,stamp)).fetchone()
        if not device: fail(401, 'DEVICE_AUTH_REQUIRED')
        user_id = device['user_id']
        if data.eventId == device['last_event_id'] or data.observedAt <= device['last_observed_at']:
            return {'accepted': False, 'reason': 'duplicate_or_older'}
        # Regular, fresh native observations keep an opted-in device connected;
        # 30 days without any observation requires pairing again in the app.
        conn.execute('UPDATE beacon_devices SET last_observed_at=?,last_event_id=?,expires_at=? WHERE user_id=?',
                     (data.observedAt,data.eventId,stamp+DEVICE_SECONDS,user_id))
        if device['suppressed_until'] > stamp:
            return {'accepted': False, 'reason': 'manual_override', 'retryAfter': device['suppressed_until']-stamp}
        present = conn.execute('SELECT * FROM presence WHERE user_id=? AND expires_at>?', (user_id,stamp)).fetchone()
        if data.state == 'inside':
            # A manual check-in keeps its own lifetime until the user checks out.
            if not present or device['owns_presence']:
                if present:
                    conn.execute('UPDATE presence SET expires_at=? WHERE user_id=?', (stamp+LEASE_SECONDS,user_id))
                else:
                    conn.execute('INSERT INTO presence VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET checked_in_at=excluded.checked_in_at,expires_at=excluded.expires_at', (user_id,stamp,stamp+LEASE_SECONDS))
                conn.execute('UPDATE beacon_devices SET owns_presence=1 WHERE user_id=?', (user_id,))
                if not present: conn.execute('UPDATE room_state SET sequence=sequence+1 WHERE id=1')
        elif present and device['owns_presence']:
            # Repeated exit reports never push the departure deadline later.
            conn.execute('UPDATE presence SET expires_at=? WHERE user_id=?', (min(present['expires_at'],stamp+EXIT_GRACE_SECONDS),user_id))
        return {'accepted': True, 'state': data.state, 'exitGraceSeconds': EXIT_GRACE_SECONDS,
                'deviceExpiresAt': stamp+DEVICE_SECONDS}


def manual_override(conn, user_id, leaving=False):
    conn.execute('UPDATE beacon_devices SET owns_presence=0,suppressed_until=? WHERE user_id=?',
                 (int(time.time())+300 if leaving else 0,user_id))
