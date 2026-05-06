-- Migration: campaign_stats — add org_id and enable RLS
--
-- The 0022 migration created campaign_stats keyed only on campaign_id, with no
-- org_id and no RLS. Every other org-scoped table in this database enforces
-- isolation via the standard RLS pattern using the `app.current_org_id` GUC.
-- Without it, any caller that bypasses the upstream campaign-ownership check
-- can query per-campaign aggregates for a campaign in another tenant.
--
-- Backfills org_id from the parent campaigns row, then enables RLS with the
-- same policy used by other per-org tables.

ALTER TABLE "campaign_stats"
  ADD COLUMN "org_id" uuid REFERENCES "organizations"("id") ON DELETE CASCADE;

UPDATE "campaign_stats" cs
SET "org_id" = c."org_id"
FROM "campaigns" c
WHERE c."id" = cs."campaign_id";

ALTER TABLE "campaign_stats"
  ALTER COLUMN "org_id" SET NOT NULL;

CREATE INDEX "campaign_stats_org_id_idx" ON "campaign_stats" ("org_id");

ALTER TABLE "campaign_stats" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "campaign_stats_org_isolation" ON "campaign_stats"
  FOR ALL
  USING  (current_setting('app.current_org_id', true) <> '' AND "org_id" = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (current_setting('app.current_org_id', true) <> '' AND "org_id" = current_setting('app.current_org_id', true)::uuid);
