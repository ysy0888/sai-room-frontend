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
def test_write_lock_serializes_concurrent_read_modify_write(monkeypatch):
    from urllib.parse import urlsplit
    import psycopg
    from postgres import connection,close_pool
    url=os.environ['SAI_TEST_POSTGRES_URL']; parts=urlsplit(url)
    assert parts.hostname in ('localhost','127.0.0.1') and parts.path=='/sai_test'
    monkeypatch.setenv('SAI_DATABASE_URL',url)
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
