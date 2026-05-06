-- Migration: track each CLI cooldown event so the watchdog can retire CLIs
-- that cool down more than twice in a rolling 30-day window.
--
-- The CLI watchdog (`src/app/api/cron/cli-watchdog/route.ts`, plan 10 task 7)
-- moves an active CLI to `status='cooling_down'` whenever its 24-hour spam
-- score exceeds the threshold. If a CLI cools down >2 times in 30 days the
-- watchdog escalates to `status='retired'` (manual reactivation only). To
-- count cooldowns over time we record one row per cooldown here, with the
-- score that triggered it for forensics.

CREATE TABLE IF NOT EXISTS "cli_cooldown_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "phone_number_id" uuid NOT NULL REFERENCES "phone_numbers"("id") ON DELETE CASCADE,
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "spam_score" numeric NOT NULL,
  "reason" text NOT NULL DEFAULT 'spam_score_exceeded'
);

CREATE INDEX IF NOT EXISTS "cli_cooldown_history_phone_started_idx"
  ON "cli_cooldown_history" ("phone_number_id", "started_at" DESC);
