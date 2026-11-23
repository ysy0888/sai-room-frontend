"""Beacon presence: aggregation, expiry, hysteresis, auth and configuration.

Runs against the real FastAPI app with a controllable server clock, on SQLite by default and on
PostgreSQL when SAI_TEST_POSTGRES_URL is set (CI). It proves server behaviour only; it says
nothing about real BLE hardware.
"""
import os
import sqlite3
import sys
import time
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import beacon, database, security
from main import app
from test_api import CODE, account, client, signin, write  # noqa: F401  (client = shared SQLite/PostgreSQL fixture)

UUID = '11111111-2222-3333-4444-555555555555'
ON_POSTGRES = bool(os.environ.get('SAI_TEST_POSTGRES_URL'))
sqlite_only = pytest.mark.skipif(ON_POSTGRES, reason='SQLite file-specific check')
postgres_only = pytest.mark.skipif(not ON_POSTGRES, reason='Requires isolated PostgreSQL test service')


@pytest.fixture
def clock(monkeypatch):
    state = {'t': time.time()}
    monkeypatch.setattr(beacon, 'now', lambda: state['t'])
    return state


def member_client(role='member', status='approved'):
    """A second, independent browser (own cookie jar) signed in as a new account."""
    c = TestClient(app)
    _, email = account(role, status)
    signin(c, email)
    return c


def configure(c, **overrides):
    current = c.get('/api/v1/rooms/sai-room/beacon-config').json()
    body = {'version': current['version'], 'enabled': True, 'uuid': UUID, 'major': 1, 'minor': 1,
            'enterRssi': -75, 'exitRssi': -85, 'reportIntervalSeconds': 30, 'exitGraceSeconds': 120,
            'referenceCapacity': 15}
    body.update(overrides)
    return write(c, '/rooms/sai-room/beacon-config', body, 'PUT')


def seen(c, rssi=-60, device='phone-a', state='inside', **extra):
    body = {'state': state, 'rssi': rssi, 'uuid': UUID, 'major': 1, 'minor': 1, 'deviceId': device}
    body.update(extra)
    return write(c, '/me/beacon-presence', body)


def count(c):
    return c.get('/api/v1/rooms/sai-room/occupancy').json()


@pytest.fixture
def room(client, clock):
    """Admin client with the beacon enabled, plus two approved member clients."""
    _, admin = account('admin')
    signin(client, admin)
    assert configure(client).status_code == 200
    return client, member_client(), member_client()


def test_two_different_members_count_as_two(room):
    admin, a, b = room
    assert count(admin)['count'] == 0
    assert seen(a).json()['present'] is True
    assert seen(b).json()['present'] is True
    snap = count(admin)
    assert snap['count'] == 2 and snap['referenceCapacity'] == 15
    names = admin.get('/api/v1/rooms/sai-room/occupants').json()['members']
    assert len(names) == 2 and len({m['id'] for m in names}) == 2


def test_repeats_and_multiple_devices_never_double_count(room):
    admin, a, _ = room
    for _ in range(5):
        assert seen(a).status_code == 200
    assert count(admin)['count'] == 1
    assert seen(a, device='tablet-b').status_code == 200  # same member, second phone
    assert count(admin)['count'] == 1
    # One device leaving must not drop the member while the other still senses the beacon.
    assert seen(a, state='outside', rssi=None, device='phone-a').json()['present'] is True
    assert count(admin)['count'] == 1
    assert seen(a, state='outside', rssi=None, device='tablet-b').json()['present'] is False
    assert count(admin)['count'] == 0


def test_manual_check_in_and_beacon_do_not_double_count(room):
    admin, a, _ = room
    assert write(a, '/me/presence').status_code == 200
    assert seen(a).status_code == 200
    assert count(admin)['count'] == 1


def test_missing_updates_expire_after_grace_and_sequence_advances(room, clock):
    admin, a, b = room
    seen(a); seen(b)
    before = count(admin)
    assert before['count'] == 2
    clock['t'] += 100  # inside the 120 s grace: unchanged, no flicker
    seen(a)            # only A keeps reporting
    assert count(admin)['count'] == 2
    clock['t'] += 100  # B silent for 200 s > grace, A refreshed 100 s ago
    after = count(admin)
    assert after['count'] == 1 and after['sequence'] > before['sequence']
    clock['t'] += 200
    assert count(admin)['count'] == 0


def test_brief_signal_loss_does_not_make_the_count_bounce(room, clock):
    admin, a, _ = room
    seen(a, rssi=-60)
    counts = []
    for _ in range(3):  # three missed 30 s reports in a row = 90 s < 120 s grace
        clock['t'] += 30
        counts.append(count(admin)['count'])
    assert counts == [1, 1, 1]
    seen(a, rssi=-62)  # recovery inside the window: no phantom re-entry
    assert count(admin)['count'] == 1


def test_hysteresis_enter_needs_stronger_signal_than_staying(room, clock):
    admin, a, _ = room
    weak = seen(a, rssi=-80).json()  # between exit (-85) and enter (-75): cannot ENTER
    assert weak['accepted'] is False and weak['present'] is False
    assert count(admin)['count'] == 0
    assert seen(a, rssi=-60).json()['present'] is True
    clock['t'] += 30
    assert seen(a, rssi=-80).json()['accepted'] is True  # ...but enough to STAY
    assert count(admin)['count'] == 1
    clock['t'] += 30
    assert seen(a, rssi=-95).json()['accepted'] is False  # below exit: not refreshed
    clock['t'] += 130
    assert count(admin)['count'] == 0


def test_unauthenticated_and_forged_reports_are_rejected(room):
    admin, a, _ = room
    anon = TestClient(app)
    csrf = anon.get('/api/v1/auth/csrf').json()['csrfToken']
    body = {'state': 'inside', 'rssi': -50, 'uuid': UUID, 'major': 1, 'minor': 1}
    r = anon.post('/api/v1/me/beacon-presence', json=body, headers={'X-CSRF-Token': csrf, 'Idempotency-Key': str(uuid4())})
    assert r.status_code == 401
    assert a.post('/api/v1/me/beacon-presence', json=body).status_code == 403  # no CSRF token
    assert count(admin)['count'] == 0


def test_client_cannot_name_another_user_or_change_counts_directly(room):
    admin, a, _ = room
    victim = admin.get('/api/v1/bootstrap').json()['user']['id']
    assert seen(a, userId=victim).status_code == 422
    assert seen(a, count=99).status_code == 422
    assert count(admin)['count'] == 0
    for path in ['/rooms/sai-room/occupancy', '/rooms/sai-room/occupants', '/rooms/sai-room/count']:
        assert admin.post('/api/v1' + path, json={'count': 9}).status_code in (404, 405)


def test_pending_member_cannot_report(room):
    assert seen(member_client('member', 'pending')).status_code == 403


def test_logout_removes_beacon_presence_immediately(room):
    admin, a, _ = room
    seen(a)
    assert count(admin)['count'] == 1
    assert write(a, '/auth/logout').status_code == 204
    assert count(admin)['count'] == 0


def test_wrong_beacon_identity_and_disabled_state(room):
    admin, a, _ = room
    assert seen(a, uuid='99999999-2222-3333-4444-555555555555').status_code == 422
    assert seen(a, major=2).status_code == 422
    assert seen(a, rssi=None).status_code == 422
    assert configure(admin, enabled=False).status_code == 200
    assert seen(a).status_code == 409  # BEACON_DISABLED
    assert count(admin)['count'] == 0


def test_simulator_reports_are_refused_in_production(room, monkeypatch):
    admin, a, _ = room
    assert seen(a, source='simulator').status_code == 200
    monkeypatch.setattr(beacon, 'PRODUCTION', True)
    assert seen(a, source='simulator').status_code == 403
    assert seen(a, source='native').status_code == 200
    assert admin.get('/api/v1/rooms/sai-room/beacon-config').json()['simulatorAllowed'] is False


def test_config_permissions_validation_and_versioning(room):
    admin, a, _ = room
    cfg = a.get('/api/v1/rooms/sai-room/beacon-config').json()  # members may read (needed to scan)
    assert cfg['uuid'] == UUID and cfg['simulatorAllowed'] is True
    assert configure(a).status_code == 403                     # but not write
    version = admin.get('/api/v1/rooms/sai-room/beacon-config').json()['version']
    assert configure(admin, version=version - 1).status_code == 409
    assert configure(admin, uuid='not-a-uuid').status_code == 422
    assert configure(admin, major=None, minor=3).status_code == 422
    assert configure(admin, enterRssi=-90, exitRssi=-80).status_code == 422
    assert configure(admin, reportIntervalSeconds=60, exitGraceSeconds=90).status_code == 422
    assert configure(admin, uuid=None).status_code == 422       # enabled without an identifier


def test_default_thresholds_are_flagged_as_test_values(client):
    _, admin = account('admin'); signin(client, admin)
    cfg = client.get('/api/v1/rooms/sai-room/beacon-config').json()
    assert cfg['usingTestDefaults'] is True and cfg['enabled'] is False and cfg['configured'] is False
    assert configure(client).json()['usingTestDefaults'] is False


def test_changing_identity_clears_old_detections_and_capacity_is_configurable(room):
    admin, a, b = room
    seen(a); seen(b)
    assert count(admin)['count'] == 2
    assert configure(admin, uuid='99999999-2222-3333-4444-555555555555', referenceCapacity=1).status_code == 200
    snap = count(admin)
    assert snap['count'] == 0 and snap['referenceCapacity'] == 1


def test_count_may_exceed_reference_capacity_and_stays_exact(room):
    admin, a, b = room
    configure(admin, referenceCapacity=1)
    seen(a); seen(b)
    snap = count(admin)
    assert snap['count'] == 2 and snap['referenceCapacity'] == 1  # the UI caps the gauge, not the number


@sqlite_only
def test_state_survives_restart_because_it_lives_in_the_database(tmp_path, monkeypatch, clock):
    monkeypatch.setattr(database, 'DB_PATH', tmp_path / 'r.db'); monkeypatch.setattr(security, 'DB_PATH', tmp_path / 'r.db')
    monkeypatch.setenv('SAI_INITIAL_OPERATOR_CODE', CODE)
    with TestClient(app) as first:
        _, admin = account('admin'); signin(first, admin); configure(first)
        seen(member_client())
        assert count(first)['count'] == 1
    with TestClient(app) as second:  # a fresh "process"
        signin(second, admin)
        assert count(second)['count'] == 1


@sqlite_only
def test_old_sqlite_database_without_beacon_tables_migrates_in_place(tmp_path, monkeypatch):
    db = tmp_path / 'old.db'
    monkeypatch.setattr(database, 'DB_PATH', db)
    database.init_db()
    with sqlite3.connect(db) as conn:
        conn.execute('DROP TABLE beacon_presence'); conn.execute('DROP TABLE beacon_settings')
    database.init_db(); database.init_db()  # idempotent
    with database.get_connection() as conn:
        row = conn.execute('SELECT * FROM beacon_settings').fetchone()
        assert row['enabled'] == 0 and row['enter_rssi'] == -75


@postgres_only
def test_postgres_v1_database_migrates_to_v2_and_runtime_role_can_use_it(pg_database, monkeypatch):
    import psycopg
    from postgres import close_pool, verify_schema
    admin_url, runtime_url = pg_database
    backend = Path(__file__).resolve().parents[1]
    migration = (backend / 'migrations/postgres/002_beacon_presence.sql').read_text()
    monkeypatch.setenv('SAI_DATABASE_URL', runtime_url)
    try:
        with psycopg.connect(admin_url, autocommit=True) as conn:  # simulate a deployed v1 database
            conn.execute('DROP TABLE IF EXISTS sai_private.beacon_presence, sai_private.beacon_settings')
            conn.execute('UPDATE sai_private.schema_version SET version=1')
        close_pool()
        with pytest.raises(RuntimeError, match='002_beacon_presence'):
            verify_schema()
        with psycopg.connect(admin_url, autocommit=True) as conn:
            conn.execute(migration); conn.execute(migration)  # idempotent
        verify_schema()
        with psycopg.connect(runtime_url, autocommit=True) as conn:
            assert conn.execute('SELECT enabled FROM sai_private.beacon_settings WHERE id=1').fetchone()[0] == 0
            conn.execute('UPDATE sai_private.beacon_settings SET enter_rssi=-74 WHERE id=1')
            assert conn.execute("SELECT count(*) FROM pg_tables WHERE schemaname='sai_private' AND tablename LIKE 'beacon%' AND NOT rowsecurity").fetchone()[0] == 0
    finally:
        with psycopg.connect(admin_url, autocommit=True) as conn:
            conn.execute(migration)
        close_pool()


def test_dev_server_accepts_the_lan_host_in_public_origin_only(monkeypatch, tmp_path):
    import importlib, main as main_module
    monkeypatch.setenv('SAI_PUBLIC_ORIGIN', 'http://192.168.0.10:5317')
    monkeypatch.delenv('SAI_ENV', raising=False)
    importlib.reload(security)
    reloaded = importlib.reload(main_module)
    try:
        hosts = next(m.kwargs['allowed_hosts'] for m in reloaded.app.user_middleware if 'allowed_hosts' in m.kwargs)
        assert '192.168.0.10' in hosts and '10.0.0.99' not in hosts
    finally:
        monkeypatch.delenv('SAI_PUBLIC_ORIGIN')
        importlib.reload(security); importlib.reload(main_module)
