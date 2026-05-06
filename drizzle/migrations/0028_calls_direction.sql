-- Migration: track call direction so inbound (IVR) calls can be distinguished
-- from outbound campaign calls in the same `calls` table.
--
-- The inbound IVR (`src/lib/voice/templates/prompts/inbound-ivr.txt`,
-- plan 10 task 9) handles incoming calls to pool DIDs for opt-out and
-- accidental-callback handling. Persisting inbound rows is the job of plan 10
-- task 11 (the inbound webhook handler) — that task will also relax the
-- NOT NULL constraint on `campaign_id`/`contact_id` since inbound rows have
-- neither at insert time. Splitting those concerns keeps task 9 focused on
-- the schema marker that downstream queries (e.g. the per-CLI metrics on
-- `/admin/cli-pool`) need to filter on.
--
-- Outbound campaign calls keep the existing default and are unaffected.
-- Note: numbered 0028 (not 0013 as in the plan) because earlier slots are taken.

CREATE TYPE "call_direction" AS ENUM ('outbound', 'inbound');

ALTER TABLE "calls"
  ADD COLUMN IF NOT EXISTS "direction" "call_direction" NOT NULL DEFAULT 'outbound';

-- The inbound IVR opt-out lookup (plan 10 task 10) and the per-CLI metrics
-- on `/admin/cli-pool` both filter on (direction, from_number).
CREATE INDEX IF NOT EXISTS "calls_direction_from_number_idx"
  ON "calls" ("direction", "from_number")
  WHERE "from_number" IS NOT NULL;
