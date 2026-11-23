-- Migration v1 -> v2: room beacon presence.
-- Run ONCE with the database administrator (not the app runtime role), e.g. in the Supabase SQL editor
-- or:  psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f sai-room-backend/migrations/postgres/002_beacon_presence.sql
-- Additive and idempotent: existing accounts, bookings and posts are not touched. Safe to re-run.
BEGIN;
SET LOCAL search_path TO sai_private, pg_catalog;
CREATE TABLE IF NOT EXISTS beacon_settings (
  id INTEGER PRIMARY KEY CHECK(id=1), enabled INTEGER NOT NULL DEFAULT 0,
  uuid TEXT, major INTEGER CHECK(major BETWEEN 0 AND 65535), minor INTEGER CHECK(minor BETWEEN 0 AND 65535),
  enter_rssi INTEGER NOT NULL DEFAULT -75, exit_rssi INTEGER NOT NULL DEFAULT -85,
  report_interval INTEGER NOT NULL DEFAULT 30, exit_grace INTEGER NOT NULL DEFAULT 120,
  reference_capacity INTEGER NOT NULL DEFAULT 15,
  version INTEGER NOT NULL DEFAULT 1, updated_at BIGINT, updated_by TEXT REFERENCES users(id)
);
INSERT INTO beacon_settings (id) VALUES (1) ON CONFLICT(id) DO NOTHING;
CREATE TABLE IF NOT EXISTS beacon_presence (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, device_id TEXT NOT NULL,
  entered_at BIGINT NOT NULL, last_seen_at BIGINT NOT NULL, rssi INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'native' CHECK(source IN ('native','simulator')),
  PRIMARY KEY (user_id, device_id)
);
CREATE INDEX IF NOT EXISTS beacon_presence_seen ON beacon_presence(last_seen_at);
ALTER TABLE beacon_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE beacon_presence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON beacon_settings, beacon_presence FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE,DELETE ON beacon_settings, beacon_presence TO sai_runtime;
DROP POLICY IF EXISTS server_access ON beacon_settings;
CREATE POLICY server_access ON beacon_settings TO sai_runtime USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS server_access ON beacon_presence;
CREATE POLICY server_access ON beacon_presence TO sai_runtime USING (true) WITH CHECK (true);
UPDATE schema_version SET version=2 WHERE id=1 AND version<2;
COMMIT;
