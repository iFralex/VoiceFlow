-- Migration: Fix credit_ledger balance_after_cents default and index order
--
-- 1. Add DEFAULT 0 to balance_after_cents so callers do not need to supply a
--    placeholder value. The BEFORE INSERT trigger overwrites whatever is stored,
--    but without a column default the NOT NULL constraint fires before the
--    trigger executes, requiring callers to always pass a dummy 0.
--
-- 2. Recreate the (org_id, created_at) index with created_at DESC so the
--    trigger's subquery (ORDER BY created_at DESC LIMIT 1) hits the index
--    efficiently. The previous index used ascending order.

ALTER TABLE "credit_ledger"
  ALTER COLUMN "balance_after_cents" SET DEFAULT 0;

DROP INDEX IF EXISTS "credit_ledger_org_created_at_idx";

CREATE INDEX "credit_ledger_org_created_at_idx"
  ON "credit_ledger" USING btree ("org_id", "created_at" DESC);
