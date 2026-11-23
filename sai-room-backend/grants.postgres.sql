-- The dedicated LOGIN role sai_runtime must already exist. Never grant it
-- membership in postgres, service_role, authenticated, anon, or an owner role.
GRANT USAGE ON SCHEMA sai_private TO sai_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA sai_private TO sai_runtime;
REVOKE INSERT,UPDATE,DELETE ON sai_private.schema_version FROM sai_runtime;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA sai_private TO sai_runtime;
DO $$ DECLARE item RECORD;
BEGIN
  FOR item IN SELECT tablename FROM pg_tables WHERE schemaname='sai_private' LOOP
    EXECUTE format('DROP POLICY IF EXISTS server_access ON sai_private.%I',item.tablename);
    EXECUTE format('CREATE POLICY server_access ON sai_private.%I TO sai_runtime USING (true) WITH CHECK (true)',item.tablename);
  END LOOP;
END $$;
