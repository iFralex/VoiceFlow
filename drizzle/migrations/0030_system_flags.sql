-- Migration: cross-cutting key/value flags read by the dispatcher and crons.
--
-- Plan 10 task 13 introduces an automatic SBC→Twilio fallback so that when the
-- Italian SBC trunk degrades (3 consecutive provider errors in <5 min) the
-- dispatcher routes around it by picking only Twilio CLIs from the pool. The
-- flag auto-clears after 30 minutes of healthy SBC operation.
--
-- The state lives in this small `system_flags` table (key/value, system-owned,
-- no RLS — accessed via `withSystemContext` only). A dedicated table beats
-- abusing an env var or a column on `phone_numbers` because:
--   - the watchdog cron and the dispatcher must observe the same value
--   - the value flips at runtime in response to dispatch outcomes
--   - future flags (e.g. emergency campaign pause, RPO supplier outage) can
--     reuse the same key/value substrate without another migration
--
-- The single row consumed by Task 13 has key='sbc_unhealthy' with value=
-- {"reason": "...", "since": "...", "lastFailureAt": "..."}; the absence of
-- the row means SBC is healthy. Other flags can be added by inserting rows
-- with new keys.
--
-- Numbered 0030 (not 0014 as in the plan) because earlier slots were taken by
-- migrations 0014_stripe_customer.sql and onward.

CREATE TABLE IF NOT EXISTS "system_flags" (
  "key" text PRIMARY KEY,
  "value" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
