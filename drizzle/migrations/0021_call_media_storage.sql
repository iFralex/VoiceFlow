-- Migration: call-media Storage Bucket RLS Policies
-- Spec §9.1 — org-scoped isolation for call recordings and transcripts
--
-- The `call-media` bucket stores call recordings and transcripts under:
--   recordings/<org_id>/<call_id>.mp3
--   transcripts/<org_id>/<call_id>.json
--
-- The second path segment is the org UUID:
--   (storage.foldername(name))[2] = org_id
--
-- Supabase's service role bypasses RLS automatically, so background jobs
-- (persistence workers) use the service-role client.
--
-- NOTE: Supabase Storage policies are applied to the storage.objects table in
-- the "storage" schema. These policies must be applied by the Supabase Dashboard
-- or via the Supabase Management API — they cannot be applied via a standard
-- Drizzle migration because the storage schema is managed by Supabase internally.
-- This file is committed as code for reproducibility and auditability.
--
-- All statements are wrapped in a DO block so this migration is a no-op on
-- plain-Postgres environments (e.g. the integration-test Docker DB) where the
-- storage schema is absent.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.schemata WHERE schema_name = 'storage'
  ) THEN
    RAISE NOTICE 'storage schema not found — call-media bucket policies skipped (non-Supabase environment)';
    RETURN;
  END IF;

  -- ============================================================
  -- BUCKET: call-media
  -- Path layout: recordings/<org_id>/<call_id>.mp3
  --              transcripts/<org_id>/<call_id>.json
  -- Second segment (index 2) is the org UUID.
  -- ============================================================

  EXECUTE $p$ CREATE POLICY "call_media_org_select" ON storage.objects
    FOR SELECT
    USING (
      bucket_id = 'call-media'
      AND current_setting('app.current_org_id', true) <> ''
      AND (storage.foldername(name))[2] = current_setting('app.current_org_id', true)
    ) $p$;

  EXECUTE $p$ CREATE POLICY "call_media_org_insert" ON storage.objects
    FOR INSERT
    WITH CHECK (
      bucket_id = 'call-media'
      AND current_setting('app.current_org_id', true) <> ''
      AND (storage.foldername(name))[2] = current_setting('app.current_org_id', true)
    ) $p$;

  EXECUTE $p$ CREATE POLICY "call_media_org_update" ON storage.objects
    FOR UPDATE
    USING (
      bucket_id = 'call-media'
      AND current_setting('app.current_org_id', true) <> ''
      AND (storage.foldername(name))[2] = current_setting('app.current_org_id', true)
    )
    WITH CHECK (
      bucket_id = 'call-media'
      AND current_setting('app.current_org_id', true) <> ''
      AND (storage.foldername(name))[2] = current_setting('app.current_org_id', true)
    ) $p$;

  EXECUTE $p$ CREATE POLICY "call_media_org_delete" ON storage.objects
    FOR DELETE
    USING (
      bucket_id = 'call-media'
      AND current_setting('app.current_org_id', true) <> ''
      AND (storage.foldername(name))[2] = current_setting('app.current_org_id', true)
    ) $p$;

END $$;
