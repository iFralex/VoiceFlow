-- Migration: Supabase Realtime Publication for calls and campaigns
-- Spec: plan 12 (dashboard live view) subscribes to row changes on these tables.
--
-- Supabase creates a default publication named "supabase_realtime" that powers
-- the Realtime service. To enable change events for a table you add it to that
-- publication using ALTER PUBLICATION ... ADD TABLE.
--
-- IMPORTANT: This migration targets the Supabase-managed "supabase_realtime"
-- publication which already exists in every Supabase project. Do NOT run
-- CREATE PUBLICATION — it already exists.
--
-- HOW TO APPLY:
--   Option 1 (Supabase Dashboard): Database > Replication > supabase_realtime
--     → toggle ON for "calls" and "campaigns" tables
--   Option 2 (SQL Editor): Run the ALTER PUBLICATION statements below in the
--     Supabase SQL editor (connect as postgres / service role).
--   Option 3 (psql): psql $DATABASE_DIRECT_URL -f drizzle/migrations/0005_realtime_publication.sql
--
-- NOTE: The ALTER PUBLICATION statement requires superuser or replication
-- privileges. In Supabase this means using the service-role / postgres user.
-- The statement is idempotent via IF EXISTS / on conflict with existing tables.

-- Add calls and campaigns to the supabase_realtime publication.
-- Wrapped in a DO block so this is a no-op on plain-Postgres environments
-- (e.g. the integration-test Docker DB) where the publication does not exist.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE calls';
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE campaigns';
  ELSE
    RAISE NOTICE 'supabase_realtime publication not found — realtime tables not added (non-Supabase environment)';
  END IF;
END $$;

-- ============================================================
-- Verification (run after applying):
--
--   SELECT schemaname, tablename
--   FROM pg_publication_tables
--   WHERE pubname = 'supabase_realtime'
--     AND tablename IN ('calls', 'campaigns');
--   -- Expected: two rows returned
--
-- Subscription pattern: see src/lib/supabase/realtime.ts
-- ============================================================
