"""PostgreSQL transport for the existing parameterized repository queries.

The hosted app uses an unexposed schema and a dedicated database role. A small
pool limits connections; transaction locks preserve the SQLite write semantics.
"""
import os
import re
import sqlite3
from contextlib import contextmanager
from threading import Lock

import psycopg
import certifi
from psycopg_pool import ConnectionPool

_pool = None
_lock = Lock()
WRITE_LOCK = 734104261
TOKEN = re.compile(r"'(?:''|[^'])*'|\"(?:\"\"|[^\"])*\"|\?|\b(?:end|window)\b")


class Row(dict):
    def __getitem__(self, key):
        if isinstance(key, int):
            return tuple(self.values())[key]
        return super().__getitem__(key)


def row_factory(cursor):
    names = [column.name for column in cursor.description] if cursor.description else []
    return lambda values: Row(zip(names, values))


def sql_text(query):
    # Skip literals and quoted identifiers: values always remain bound parameters.
    return TOKEN.sub(lambda match: '%s' if match[0] == '?' else
                     '"' + match[0] + '"' if match[0] in ('end', 'window') else match[0], query)


def pool():
    global _pool
    with _lock:
        if _pool is None:
            tls = {'sslmode':'verify-full', 'sslrootcert':certifi.where()} if os.environ.get('SAI_ENV') == 'production' else {}
            _pool = ConnectionPool(
                os.environ['SAI_DATABASE_URL'], min_size=0, max_size=4,
                timeout=15, max_idle=60, open=True,
                kwargs={'connect_timeout':10, 'prepare_threshold':None,
                        'row_factory':row_factory, **tls},
                check=ConnectionPool.check_connection,
            )
        return _pool


def close_pool():
    global _pool
    with _lock:
        if _pool is not None:
            _pool.close()
            _pool = None


class Connection:
    def __init__(self, raw):
        self.raw = raw

    def execute(self, query, parameters=None):
        if query.strip().upper() == 'BEGIN IMMEDIATE':
            # All multi-step mutations use this same lock, preventing duplicate
            # bookings and idempotency races across processes, not just threads.
            return self.raw.execute('SELECT pg_advisory_xact_lock(%s)', (WRITE_LOCK,))
        try:
            return self.raw.execute(sql_text(query), parameters)
        except psycopg.IntegrityError as error:
            # Keep existing endpoint conflict handling; context rolls back.
            raise sqlite3.IntegrityError('Database constraint violation') from error

    def commit(self):
        self.raw.commit()


@contextmanager
def connection():
    with pool().connection() as raw:
        # SET LOCAL is reset on commit, compatible with transaction poolers.
        raw.execute('SET LOCAL search_path TO sai_private, pg_catalog')
        raw.execute("SET LOCAL statement_timeout = '15s'")
        raw.execute("SET LOCAL lock_timeout = '10s'")
        yield Connection(raw)


def verify_schema():
    with connection() as conn:
        row = conn.execute('SELECT version FROM schema_version WHERE id=1').fetchone()
        if not row or row['version'] != 1:
            raise RuntimeError('Apply the SAI PostgreSQL schema before starting the server')
