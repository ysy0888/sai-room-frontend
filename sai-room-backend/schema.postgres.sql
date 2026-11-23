-- Provision with a database administrator, never with the browser's API key.
-- sai_private is NOT an exposed PostgREST schema.
CREATE SCHEMA IF NOT EXISTS sai_private;
REVOKE ALL ON SCHEMA sai_private FROM PUBLIC;
SET search_path TO sai_private, pg_catalog;

CREATE TABLE IF NOT EXISTS schema_version (
  id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, student_id TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('member','operator','admin')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  created_at BIGINT NOT NULL, email TEXT,
  theme TEXT NOT NULL DEFAULT 'light', gauge TEXT NOT NULL DEFAULT 'water',
  ball_anonymous INTEGER NOT NULL DEFAULT 0, ball_color TEXT NOT NULL DEFAULT '#233f6d',
  ball_image_id TEXT, rowid BIGINT GENERATED ALWAYS AS IDENTITY
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users(email) WHERE email IS NOT NULL;
CREATE TABLE IF NOT EXISTS reservations (
  id TEXT PRIMARY KEY, date TEXT NOT NULL, start INTEGER NOT NULL, "end" INTEGER NOT NULL,
  purpose TEXT NOT NULL, name TEXT NOT NULL, people INTEGER NOT NULL,
  owner TEXT NOT NULL REFERENCES users(id),
  CHECK(start >= 540 AND "end" <= 1380 AND start < "end"),
  CHECK(start % 30 = 0 AND "end" % 30 = 0), CHECK(people BETWEEN 1 AND 15)
);
CREATE INDEX IF NOT EXISTS reservations_date_start ON reservations(date,start);
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY, category TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
  created_at BIGINT NOT NULL, edit_token_hash TEXT NOT NULL,
  author_id TEXT REFERENCES users(id), kind TEXT NOT NULL DEFAULT 'public',
  status TEXT NOT NULL DEFAULT 'received', rowid BIGINT GENERATED ALWAYS AS IDENTITY
);
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY, post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  body TEXT NOT NULL, created_at BIGINT NOT NULL,
  author_id TEXT REFERENCES users(id), is_staff INTEGER NOT NULL DEFAULT 0,
  rowid BIGINT GENERATED ALWAYS AS IDENTITY
);
CREATE INDEX IF NOT EXISTS comments_post_created ON comments(post_id,created_at,rowid);
CREATE INDEX IF NOT EXISTS posts_author ON posts(author_id);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS web_sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), csrf TEXT NOT NULL, expires_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS web_sessions_expiry ON web_sessions(expires_at);
CREATE TABLE IF NOT EXISTS operator_code (
  id INTEGER PRIMARY KEY CHECK(id=1), code_hash TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, updated_at BIGINT NOT NULL, updated_by TEXT REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES users(id), action TEXT NOT NULL,
  subject_id TEXT, created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY, "window" BIGINT NOT NULL, attempts INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS request_keys (
  user_id TEXT NOT NULL REFERENCES users(id), key TEXT NOT NULL, fingerprint TEXT NOT NULL,
  response TEXT NOT NULL, expires_at BIGINT NOT NULL, PRIMARY KEY(user_id,key)
);
CREATE TABLE IF NOT EXISTS ball_images (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), png BYTEA NOT NULL, created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS presence (
  user_id TEXT PRIMARY KEY REFERENCES users(id), checked_in_at BIGINT NOT NULL, expires_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS beacon_devices (
  user_id TEXT PRIMARY KEY REFERENCES users(id), token_hash TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL CHECK(platform IN ('ios','android')), created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL, last_observed_at BIGINT NOT NULL DEFAULT 0,
  last_event_id TEXT NOT NULL DEFAULT '', suppressed_until BIGINT NOT NULL DEFAULT 0,
  owns_presence INTEGER NOT NULL DEFAULT 0 CHECK(owns_presence IN (0,1))
);
CREATE TABLE IF NOT EXISTS room_state (
  id INTEGER PRIMARY KEY CHECK(id=1), sequence BIGINT NOT NULL DEFAULT 0
);
INSERT INTO room_state VALUES (1,0) ON CONFLICT(id) DO NOTHING;
INSERT INTO schema_version VALUES (1,1) ON CONFLICT(id) DO NOTHING;

-- Runtime role is provisioned separately. It has DML access, no schema ownership,
-- no DDL, no Supabase admin privileges, and no access to other applications.
DO $$ DECLARE item RECORD;
BEGIN
  FOR item IN SELECT tablename FROM pg_tables WHERE schemaname='sai_private' LOOP
    EXECUTE format('ALTER TABLE sai_private.%I ENABLE ROW LEVEL SECURITY',item.tablename);
    EXECUTE format('REVOKE ALL ON sai_private.%I FROM PUBLIC',item.tablename);
  END LOOP;
END $$;
