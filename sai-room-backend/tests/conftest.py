"""Provision only the disposable local PostgreSQL service used by CI."""
import os
from pathlib import Path
from urllib.parse import urlsplit

import pytest


@pytest.fixture(scope='session')
def pg_database():
    admin_url = os.environ.get('SAI_TEST_POSTGRES_URL')
    if not admin_url:
        return None
    parts = urlsplit(admin_url)
    assert parts.hostname in ('localhost', '127.0.0.1') and parts.path == '/sai_test', 'Only the isolated local test database may be provisioned'
    import psycopg
    from psycopg.conninfo import make_conninfo
    backend = Path(__file__).resolve().parents[1]
    with psycopg.connect(admin_url, autocommit=True) as conn:
        conn.execute((backend / 'schema.postgres.sql').read_text())
        if not conn.execute("SELECT 1 FROM pg_roles WHERE rolname='sai_runtime'").fetchone():
            conn.execute('CREATE ROLE sai_runtime LOGIN')
        conn.execute("ALTER ROLE sai_runtime WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD 'isolated-ci-runtime'")
        conn.execute((backend / 'grants.postgres.sql').read_text())
    return admin_url, make_conninfo(admin_url, user='sai_runtime', password='isolated-ci-runtime')
