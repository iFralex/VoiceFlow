-- Migration: per-org recording retention override (plan 11 task 12).
--
-- Spec §12.4 retention defaults are encoded in src/lib/compliance/retention.ts:
--   - call recordings: 365 days (12 months)
--   - transcripts:     730 days (24 months)
--   - audit_log:       2555 days (~7 years)
--   - soft-deleted contacts: hard-purged after 30 days
--   - payments: retained indefinitely (tax requirement)
--
-- The recording retention window is the only one that may be shortened on a
-- per-org basis (e.g. a dealer requesting a tighter window for compliance
-- with their own DPA). NULL means "use platform default".

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS recording_retention_days integer;

ALTER TABLE organizations
  ADD CONSTRAINT organizations_recording_retention_days_range
  CHECK (recording_retention_days IS NULL OR (recording_retention_days >= 1 AND recording_retention_days <= 3650));
