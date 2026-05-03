-- Migration: Storage Bucket RLS Policies
-- Spec §7.3 — org-scoped isolation for Supabase Storage objects
--
-- Each of the four private buckets (recordings, transcripts, csv-uploads, exports)
-- enforces path-prefix isolation: objects must live under <org_id>/... and the
-- first path segment is checked against the app.current_org_id GUC.
--
-- Supabase's service role bypasses RLS automatically, so background jobs
-- (transcription workers, export generators) use the service-role client.
--
-- NOTE: Supabase Storage policies are applied to the storage.objects table in
-- the "storage" schema. These policies must be applied by the Supabase Dashboard
-- or via the Supabase Management API — they cannot be applied via a standard
-- Drizzle migration because the storage schema is managed by Supabase internally.
-- This file is committed as code for reproducibility and auditability.
--
-- HOW TO APPLY:
--   Option 1 (Dashboard): Storage > Policies > New policy (for each bucket below)
--   Option 2 (SQL Editor): Run this file in the Supabase SQL editor
--   Option 3 (psql): psql $DATABASE_URL -f drizzle/migrations/0004_storage_policies.sql
--
-- Path convention: <org_id>/<filename>
--   e.g. "550e8400-e29b-41d4-a716-446655440000/call-20240101-120000.mp3"
--
-- storage.foldername(name) returns the array of path segments excluding the filename.
-- (storage.foldername(name))[1] returns the first segment (the org UUID).

-- ============================================================
-- BUCKET: recordings
-- Max file size enforced via supabase/config.toml (500 MB)
-- ============================================================

CREATE POLICY "recordings_org_select" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'recordings'
    AND current_setting('app.current_org_id', true) <> ''
    AND (storage.foldername(name))[1] = current_setting('app.current_org_id', true)
  );

CREATE POLICY "recordings_org_insert" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'recordings'
    AND current_setting('app.current_org_id', true) <> ''
    AND (storage.foldername(name))[1] = current_setting('app.current_org_id', true)
  );

CREATE POLICY "recordings_org_update" ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'recordings'
    AND current_setting('app.current_org_id', true) <> ''
    AND (storage.foldername(name))[1] = current_setting('app.current_org_id', true)
  )
  WITH CHECK (
    bucket_id = 'recordings'
    AND current_setting('app.current_org_id', true) <> ''
    AND (storage.foldername(name))[1] = current_setting('app.current_org_id', true)
  );

CREATE POLICY "recordings_org_delete" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'recordings'
    AND current_setting('app.current_org_id', true) <> ''
    AND (storage.foldername(name))[1] = current_setting('app.current_org_id', true)
  );

-- ============================================================
-- BUCKET: transcripts
-- Max file size enforced via supabase/config.toml (50 MB)
-- ============================================================

CREATE POLICY "transcripts_org_select" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'transcripts'
    AND current_setting('app.current_org_id', true) <> ''
    AND (storage.foldername(name))[1] = current_setting('app.current_org_id', true)
  );

CREATE POLICY "transcripts_org_insert" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'transcripts'
    AND current_setting('app.current_org_id', true) <> ''
    AND (storage.foldername(name))[1] = current_setting('app.current_org_id', true)
  );

CREATE POLICY "transcripts_org_update" ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'transcripts'
    AND current_setting('app.current_org_id', true) <> ''
    AND (storage.foldername(name))[1] = current_setting('app.current_org_id', true)
  )
  WITH CHECK (
    bucket_id = 'transcripts'
    AND current_setting('app.current_org_id', true) <> ''
    AND (storage.foldername(name))[1] = current_setting('app.current_org_id', true)
  );

CREATE POLICY "transcripts_org_delete" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'transcripts'
    AND current_setting('app.current_org_id', true) <> ''
    AND (storage.foldername(name))[1] = current_setting('app.current_org_id', true)
  );

-- ============================================================
-- BUCKET: csv-uploads
-- Max file size enforced via supabase/config.toml (50 MB)
-- ============================================================

CREATE POLICY "csv_uploads_org_select" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'csv-uploads'
    AND current_setting('app.current_org_id', true) <> ''
    AND (storage.foldername(name))[1] = current_setting('app.current_org_id', true)
  );

CREATE POLICY "csv_uploads_org_insert" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'csv-uploads'
    AND current_setting('app.current_org_id', true) <> ''
    AND (storage.foldername(name))[1] = current_setting('app.current_org_id', true)
  );

CREATE POLICY "csv_uploads_org_update" ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'csv-uploads'
    AND current_setting('app.current_org_id', true) <> ''
    AND (storage.foldername(name))[1] = current_setting('app.current_org_id', true)
  )
  WITH CHECK (
    bucket_id = 'csv-uploads'
    AND current_setting('app.current_org_id', true) <> ''
    AND (storage.foldername(name))[1] = current_setting('app.current_org_id', true)
  );

CREATE POLICY "csv_uploads_org_delete" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'csv-uploads'
    AND current_setting('app.current_org_id', true) <> ''
    AND (storage.foldername(name))[1] = current_setting('app.current_org_id', true)
  );

-- ============================================================
-- BUCKET: exports
-- Max file size enforced via supabase/config.toml (50 MB)
-- ============================================================

CREATE POLICY "exports_org_select" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'exports'
    AND current_setting('app.current_org_id', true) <> ''
    AND (storage.foldername(name))[1] = current_setting('app.current_org_id', true)
  );

CREATE POLICY "exports_org_insert" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'exports'
    AND current_setting('app.current_org_id', true) <> ''
    AND (storage.foldername(name))[1] = current_setting('app.current_org_id', true)
  );

CREATE POLICY "exports_org_update" ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'exports'
    AND current_setting('app.current_org_id', true) <> ''
    AND (storage.foldername(name))[1] = current_setting('app.current_org_id', true)
  )
  WITH CHECK (
    bucket_id = 'exports'
    AND current_setting('app.current_org_id', true) <> ''
    AND (storage.foldername(name))[1] = current_setting('app.current_org_id', true)
  );

CREATE POLICY "exports_org_delete" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'exports'
    AND current_setting('app.current_org_id', true) <> ''
    AND (storage.foldername(name))[1] = current_setting('app.current_org_id', true)
  );

-- ============================================================
-- Cross-org isolation verification (run manually after applying):
--
-- In psql, swap org IDs and attempt to SELECT from storage.objects:
--
--   -- Set org context to org A
--   SELECT set_config('app.current_org_id', '<org-a-uuid>', true);
--
--   -- Upload a file as org A first (via SDK), then:
--   SELECT name FROM storage.objects WHERE bucket_id = 'recordings';
--   -- Expected: only objects starting with '<org-a-uuid>/' are returned
--
--   -- Now swap to org B
--   SELECT set_config('app.current_org_id', '<org-b-uuid>', true);
--   SELECT name FROM storage.objects WHERE bucket_id = 'recordings';
--   -- Expected: org A objects are NOT visible (returns empty or only org B objects)
--
-- Service role bypass (no org context needed):
--   -- Connect with service_role key; all objects visible regardless of path
-- ============================================================
