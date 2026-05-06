-- Migration: phone_numbers metadata for CLI rotation
--
-- Adds the columns the CLI picker needs to match a number to a contact's
-- region and to forward the call through Vapi:
--   - region: lowercase Italian city slug (e.g. "milano"), null for mobile DIDs
--   - capabilities: array containing "mobile" and/or "landline"
--   - provider_external_id: the Vapi `phoneNumberId` for the DID
-- Note: numbered 0025 (not 0012 as in the plan) because earlier slots are taken.

ALTER TABLE "phone_numbers"
  ADD COLUMN IF NOT EXISTS "region" text,
  ADD COLUMN IF NOT EXISTS "capabilities" text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "provider_external_id" text;

CREATE INDEX IF NOT EXISTS "phone_numbers_region_status_active_idx"
  ON "phone_numbers" ("region", "status")
  WHERE "status" = 'active';
