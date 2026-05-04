-- Migration: Add contact_lists to Supabase Realtime publication
-- Plan 06, Task 8: list detail page subscribes to Realtime changes on
-- contact_lists rows to show live import progress.
--
-- Wrapped in a DO block so this is a no-op on plain-Postgres environments
-- (e.g. the integration-test Docker DB) where the publication does not exist.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE contact_lists';
  ELSE
    RAISE NOTICE 'supabase_realtime publication not found — contact_lists not added (non-Supabase environment)';
  END IF;
END $$;
