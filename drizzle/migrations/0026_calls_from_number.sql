-- Migration: track the CLI used per call for the picker's hourly cap
--
-- The CLI picker (`src/lib/voice/cli/picker.ts`, plan 10 task 4) enforces a
-- per-CLI hourly cap by counting recent calls dispatched from each candidate
-- CLI. That sliding-window count is `SELECT COUNT(*) FROM calls WHERE
-- from_number = <candidate.e164> AND started_at >= NOW() - INTERVAL '1 hour'`,
-- which requires the CLI to be persisted on the call row.
--
-- Plan 10 task 14 will additionally surface this column in the call detail UI;
-- for task 4 only the hourly-cap query depends on it. Index supports the
-- sliding-window count (filtered by started_at recency).

ALTER TABLE calls
  ADD COLUMN IF NOT EXISTS from_number text;

CREATE INDEX IF NOT EXISTS calls_from_number_started_at_idx
  ON calls (from_number, started_at)
  WHERE from_number IS NOT NULL AND started_at IS NOT NULL;
