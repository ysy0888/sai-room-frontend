"""Database portability and concurrency checks for the hosted backend."""
import os
import sys
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import pytest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from postgres import sql_text, Row


def test_parameter_translation_preserves_literals():
    assert sql_text("SELECT end,window,'end ? window',\"end\" FROM reservations WHERE id=?") == "SELECT \"end\",\"window\",'end ? window',\"end\" FROM reservations WHERE id=%s"
    assert Row([('count',3)])[0] == 3


@pytest.mark.skipif(not os.environ.get('SAI_TEST_POSTGRES_URL'),reason='Requires isolated PostgreSQL test service')
def test_write_lock_serializes_concurrent_read_modify_write(monkeypatch,pg_database):
    import psycopg
    from postgres import connection,close_pool
    url,runtime_url=pg_database
    monkeypatch.setenv('SAI_DATABASE_URL',runtime_url)
    with psycopg.connect(url,autocommit=True) as conn:
        conn.execute((Path(__file__).resolve().parents[1]/'schema.postgres.sql').read_text())
        conn.execute('INSERT INTO sai_private.room_state VALUES (1,0) ON CONFLICT(id) DO UPDATE SET sequence=0')
    def increment(_):
        with connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            value=conn.execute('SELECT sequence FROM room_state WHERE id=1').fetchone()[0]
            conn.execute('UPDATE room_state SET sequence=? WHERE id=1',(value+1,))
    try:
        with ThreadPoolExecutor(max_workers=8) as executor:
            list(executor.map(increment,range(24)))
        with connection() as conn:
            assert conn.execute('SELECT sequence FROM room_state WHERE id=1').fetchone()[0] == 24
    finally:
        close_pool()


@pytest.mark.skipif(not os.environ.get('SAI_TEST_POSTGRES_URL'),reason='Requires isolated PostgreSQL test service')
def test_runtime_role_is_private_and_cannot_change_schema(pg_database):
    import psycopg
    _,runtime_url=pg_database
    with psycopg.connect(runtime_url,autocommit=True) as conn:
        flags=conn.execute('SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=current_user').fetchone()
        assert flags == (False,False,False,False,False)
        assert conn.execute("SELECT has_schema_privilege(current_user,'sai_private','USAGE'),has_schema_privilege(current_user,'sai_private','CREATE')").fetchone() == (True,False)
        assert conn.execute("SELECT count(*) FROM pg_tables WHERE schemaname='sai_private' AND NOT rowsecurity").fetchone()[0] == 0
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute('CREATE TABLE sai_private.forbidden_test(id INTEGER)')
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute('UPDATE sai_private.schema_version SET version=2 WHERE id=1')
        # No PUBLIC privileges may expose app data to anonymous database roles.
        assert conn.execute("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE n.nspname='sai_private' AND a.grantee=0").fetchone()[0] == 0
