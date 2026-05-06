-- Migration: per-call observability for the CLI provider used at dispatch.
--
-- Plan 10 task 14 wants the founder dashboard (`/admin/cli-pool`) and the
-- per-call detail page (built in plan 12) to surface which provider supplied
-- the CLI for each outbound call. `calls.from_number` (added in
-- `0026_calls_from_number.sql`) already pins down *which* CLI was used; this
-- column denormalises the provider so that joins back to `phone_numbers` are
-- not required to render a "CLI utilizzato" badge — and so that the value is
-- preserved for forensics even if a CLI is later retired and removed from the
-- pool.
--
-- Reuses the existing `phone_provider` enum (`voiped` | `twilio` | `telnyx`)
-- so the value stays in sync with `phone_numbers.provider`. Nullable because
-- pre-existing call rows never had a CLI provider attached, and inbound rows
-- (direction='inbound') are not dispatched through the picker either.
--
-- Numbered 0031 (not 0015 as in the plan) because earlier slots are taken.

ALTER TABLE "calls"
  ADD COLUMN IF NOT EXISTS "cli_provider" "phone_provider";
