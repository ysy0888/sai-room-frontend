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
