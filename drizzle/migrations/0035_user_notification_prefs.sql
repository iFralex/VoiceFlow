-- Migration: per-user notification preferences (plan 12 task 10).
--
-- One row per (user_id, org_id) tracks the toggles a user picked for the
-- notifications they receive about a specific organisation. Users can be
-- members of multiple orgs and want different defaults in each (e.g. opted
-- into the daily report for their main dealership, opted out for a side org).
--
-- All toggles default to `true` so a freshly invited member is opted into
-- the same set of notifications they would have received before this table
-- existed (the daily report cron previously emailed every owner). The
-- exception is `weekly_summary`, which is reserved for a future digest and
-- defaults to `false` — we don't ship that one yet but the column lives here
-- so the cron logic and settings UI stay forward-compatible.
--
-- The plan slot `0018` it requested was already taken by an unrelated
-- migration (voice catalogue); this lands at `0035` as the next sequential
-- slot.
--
-- Reads and writes happen in two paths:
--   - User-facing settings page → `withOrgContext` so RLS scopes the row to
--     the current org and the user's own user_id.
--   - Daily report / future cron dispatchers → `withSystemContext`, since
--     they cross orgs to enumerate recipients.

CREATE TABLE IF NOT EXISTS "user_notification_preferences" (
  "user_id"             uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  "org_id"              uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  "daily_report"        boolean NOT NULL DEFAULT true,
  "appointment_booked"  boolean NOT NULL DEFAULT true,
  "qualified_lead"      boolean NOT NULL DEFAULT true,
  "low_credit"          boolean NOT NULL DEFAULT true,
  "campaign_completed"  boolean NOT NULL DEFAULT true,
  "weekly_summary"      boolean NOT NULL DEFAULT false,
  "updated_at"          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("user_id", "org_id")
);

CREATE INDEX IF NOT EXISTS "user_notification_preferences_org_id_idx"
  ON "user_notification_preferences" ("org_id");

-- RLS: a user reads/writes only their own row, scoped to the active org via
-- the same `app.current_org_id` GUC every other org-scoped table uses.
ALTER TABLE "user_notification_preferences" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_notification_preferences_owner_rw"
  ON "user_notification_preferences"
  FOR ALL
  USING (
    user_id = auth.uid()
    AND current_setting('app.current_org_id', true) <> ''
    AND org_id = current_setting('app.current_org_id', true)::uuid
  )
  WITH CHECK (
    user_id = auth.uid()
    AND current_setting('app.current_org_id', true) <> ''
    AND org_id = current_setting('app.current_org_id', true)::uuid
  );
