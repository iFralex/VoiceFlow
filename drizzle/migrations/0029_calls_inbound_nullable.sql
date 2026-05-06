-- Migration: relax the NOT NULL constraints on calls.campaign_id and
-- calls.contact_id so inbound IVR calls (plan 10 task 11) can be persisted
-- without those references.
--
-- Outbound campaign calls always carry both. Inbound calls hit a shared-pool
-- DID, so neither the originating campaign nor a known contact exists when the
-- row is inserted by the inbound webhook handler. Picking a synthetic campaign
-- or stub contact would pollute reporting; making the columns nullable keeps
-- the schema honest and lets the inbound branch insert the row directly.
--
-- The 0028_calls_direction.sql migration header explicitly hands off this
-- relaxation to plan 10 task 11 — see that file for context.

ALTER TABLE "calls" ALTER COLUMN "campaign_id" DROP NOT NULL;
ALTER TABLE "calls" ALTER COLUMN "contact_id" DROP NOT NULL;
