-- Migration: Add campaign_stats to Supabase Realtime publication
-- Plan 12, Task 13: dashboard subscribes to Realtime changes on
-- campaign_stats rows to keep the active-campaigns row in sync without a
-- full-page revalidation.
--
-- Wrapped in a DO block so this is a no-op on plain-Postgres environments
-- (e.g. the integration-test Docker DB) where the publication does not exist.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE campaign_stats';
  ELSE
    RAISE NOTICE 'supabase_realtime publication not found — campaign_stats not added (non-Supabase environment)';
  END IF;
END $$;
