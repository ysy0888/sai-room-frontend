import os
import sqlite3
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]


def test_render_origin_production_session_and_health(tmp_path):
    code = '''
from fastapi.testclient import TestClient
from main import app
from security import PUBLIC_ORIGIN
assert PUBLIC_ORIGIN == 'https://sai-deploy-test.onrender.com'
with TestClient(app, base_url=PUBLIC_ORIGIN) as client:
    assert client.get('/healthz').json() == {'status':'ok'}
    assert client.get('/api/docs').status_code == 404
    response = client.get('/api/v1/auth/csrf')
    assert response.status_code == 200
    cookie = response.headers['set-cookie']
    assert '__Host-sai_session=' in cookie and 'Secure' in cookie and 'HttpOnly' in cookie
    assert client.get('/',headers={'host':'other.example'}).status_code == 400
'''
    env = {**os.environ, 'PYTHONPATH':str(BACKEND), 'SAI_ENV':'production',
           'RENDER_EXTERNAL_URL':'https://sai-deploy-test.onrender.com',
           'SAI_DB_PATH':str(tmp_path/'test.db'), 'SAI_BACKUP_DIR':str(tmp_path/'backups'),
           'SAI_INITIAL_OPERATOR_CODE':'Isolated-deployment-test-code'}
    env.pop('SAI_PUBLIC_ORIGIN',None)
    subprocess.run([sys.executable,'-c',code],env=env,check=True,capture_output=True,text=True)


def test_backup_is_readable_private_and_does_not_overwrite_daily_copy(tmp_path,monkeypatch):
    sys.path.insert(0,str(BACKEND))
    import maintenance
    db=tmp_path/'live.db'; backups=tmp_path/'backups'
    monkeypatch.setattr(maintenance,'DB_PATH',db)
    monkeypatch.setenv('SAI_BACKUP_DIR',str(backups))
    with sqlite3.connect(db) as conn:
        conn.execute('CREATE TABLE records(value TEXT)')
        conn.execute("INSERT INTO records VALUES ('before')")
    snapshot=maintenance.daily_backup()
    with sqlite3.connect(db) as conn: conn.execute("INSERT INTO records VALUES ('after')")
    assert maintenance.daily_backup()==snapshot
    with sqlite3.connect(snapshot) as conn:
        assert conn.execute('SELECT value FROM records').fetchall()==[('before',)]
    assert snapshot.stat().st_mode & 0o777 == 0o600
    assert not list(backups.glob('.sai-backup-*'))


def test_vercel_entrypoint_trusts_only_configured_domains_and_requires_postgres():
    code = '''
import asyncio
from fastapi.testclient import TestClient
from app import app
from security import PUBLIC_ORIGIN, TRUSTED_ORIGINS
assert PUBLIC_ORIGIN == 'https://sai-production.vercel.app'
assert TRUSTED_ORIGINS == {PUBLIC_ORIGIN, 'https://sai-deployment.vercel.app', 'https://sai-branch.vercel.app'}
client = TestClient(app, base_url=PUBLIC_ORIGIN)
assert client.get('/').status_code == 200
assert client.get('/', headers={'host':'sai-deployment.vercel.app'}).status_code == 200
assert client.get('/', headers={'host':'someone-else.vercel.app'}).status_code == 400
assert client.post('/api/v1/auth/login',headers={'origin':'https://someone-else.vercel.app'},json={'email':'member@example.org','password':'isolated-test-pass'}).status_code == 403
assert client.get('/sai-room-backend/security.py').status_code == 404
assert client.get('/.env').status_code == 404
async def check_startup():
    try:
        async with app.router.lifespan_context(app):
            raise AssertionError('ephemeral SQLite accepted')
    except RuntimeError as exc:
        assert 'Vercel requires SAI_DATABASE_URL' in str(exc)
asyncio.run(check_startup())
'''
    env = {**os.environ, 'PYTHONPATH':str(BACKEND.parent), 'SAI_ENV':'production',
           'VERCEL':'1', 'VERCEL_PROJECT_PRODUCTION_URL':'sai-production.vercel.app',
           'VERCEL_URL':'sai-deployment.vercel.app','VERCEL_BRANCH_URL':'sai-branch.vercel.app'}
    for key in ('SAI_PUBLIC_ORIGIN','SAI_DATABASE_URL','RENDER_EXTERNAL_URL'):
        env.pop(key,None)
    subprocess.run([sys.executable,'-c',code],env=env,check=True,capture_output=True,text=True)
