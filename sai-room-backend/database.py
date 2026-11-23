
import sqlite3
import os
from contextlib import contextmanager
from pathlib import Path

DB_PATH = Path(os.environ.get("SAI_DB_PATH", Path(__file__).resolve().parent / "sai.db"))

def postgres_enabled():
    return bool(os.environ.get('SAI_DATABASE_URL'))

@contextmanager
def get_connection():
    if postgres_enabled():
        from postgres import connection
        with connection() as conn:
            yield conn
        return
    with sqlite_connection() as conn:
        yield conn

@contextmanager
def sqlite_connection():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    created = not DB_PATH.exists()
    conn = sqlite3.connect(DB_PATH, timeout=15)
    if created:
        os.chmod(DB_PATH, 0o600)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=15000")
    try:
        with conn:
            yield conn
    finally:
        conn.close()

def init_db():
    if postgres_enabled():
        from postgres import verify_schema
        verify_schema()
        return
    init_sqlite()

def init_sqlite():
    with get_connection() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS reservations (
                id TEXT PRIMARY KEY,
                date TEXT NOT NULL,
                start INTEGER NOT NULL,
                end INTEGER NOT NULL,
                purpose TEXT NOT NULL,
                name TEXT NOT NULL,
                people INTEGER NOT NULL,
                owner TEXT NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS posts (
                id TEXT PRIMARY KEY,
                category TEXT NOT NULL,
                title TEXT NOT NULL,
                body TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                edit_token_hash TEXT NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS comments (
                id TEXT PRIMARY KEY,
                post_id TEXT NOT NULL,
                body TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
            )
        """)
        conn.execute("""CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, student_id TEXT NOT NULL UNIQUE,
            username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'member', status TEXT NOT NULL DEFAULT 'pending',
            created_at INTEGER NOT NULL
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS sessions (
            token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL,
            expires_at INTEGER NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )""")
        # Additive migration preserves existing accounts, passwords and content.
        for table, additions in {
            "users": {"email": "TEXT", "theme": "TEXT NOT NULL DEFAULT 'light'", "gauge": "TEXT NOT NULL DEFAULT 'water'", "ball_anonymous": "INTEGER NOT NULL DEFAULT 0", "ball_color": "TEXT NOT NULL DEFAULT '#233f6d'", "ball_image_id": "TEXT"},
            "posts": {"author_id": "TEXT", "kind": "TEXT NOT NULL DEFAULT 'public'", "status": "TEXT NOT NULL DEFAULT 'received'"},
            "comments": {"author_id": "TEXT", "is_staff": "INTEGER NOT NULL DEFAULT 0"},
        }.items():
            columns = {r['name'] for r in conn.execute(f'PRAGMA table_info({table})')}
            for name, definition in additions.items():
                if name not in columns:
                    conn.execute(f'ALTER TABLE {table} ADD COLUMN {name} {definition}')
        conn.execute('CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users(email) WHERE email IS NOT NULL')
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS web_sessions (token_hash TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), csrf TEXT NOT NULL, expires_at INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS operator_code (id INTEGER PRIMARY KEY CHECK(id=1), code_hash TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL, updated_by TEXT REFERENCES users(id));
            CREATE TABLE IF NOT EXISTS audit_events (id TEXT PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES users(id), action TEXT NOT NULL, subject_id TEXT, created_at INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, window INTEGER NOT NULL, attempts INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS request_keys (user_id TEXT NOT NULL, key TEXT NOT NULL, fingerprint TEXT NOT NULL, response TEXT NOT NULL, expires_at INTEGER NOT NULL, PRIMARY KEY(user_id,key));
            CREATE TABLE IF NOT EXISTS ball_images (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), png BLOB NOT NULL, created_at INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS presence (user_id TEXT PRIMARY KEY REFERENCES users(id), checked_in_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS beacon_devices (user_id TEXT PRIMARY KEY REFERENCES users(id), token_hash TEXT NOT NULL UNIQUE, platform TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_observed_at INTEGER NOT NULL DEFAULT 0, last_event_id TEXT NOT NULL DEFAULT '', suppressed_until INTEGER NOT NULL DEFAULT 0, owns_presence INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS room_state (id INTEGER PRIMARY KEY CHECK(id=1), sequence INTEGER NOT NULL DEFAULT 0);
            INSERT OR IGNORE INTO room_state (id,sequence) VALUES (1,0);
        """)
        conn.commit()
