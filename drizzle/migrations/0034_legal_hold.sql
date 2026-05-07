-- Migration: legal hold flag on contacts (plan 11 task 14).
--
-- A legal hold pauses retention purge for a contact and the recordings /
-- transcripts of every call linked to it. When set to a non-NULL future
-- timestamp the daily purge cron (src/app/api/cron/retention-purge) skips
-- the contact row and any storage objects on calls.contact_id == this row.
--
-- NULL (the default) means "no hold" — retention rules apply normally. A
-- past timestamp also lets the hold expire automatically without manual
-- intervention; the purge query compares `legal_hold_until > now()`.
--
-- The plan's slot `0017` was already taken by an unrelated migration; this
-- lands at `0034` as the next available sequential slot.

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS legal_hold_until timestamptz;

CREATE INDEX IF NOT EXISTS contacts_legal_hold_until_idx
  ON contacts (legal_hold_until)
  WHERE legal_hold_until IS NOT NULL;
