-- Migration: Row Level Security Policies
-- Spec §7.3 — org-scoped isolation via app.current_org_id GUC
--
-- The middleware sets: SET LOCAL app.current_org_id = '<uuid>';
-- Service role bypasses RLS automatically (Supabase default).
--
-- Tables WITHOUT RLS (system-owned, accessed only via service role with explicit org filter):
--   script_templates, credit_packages, rpo_snapshots, webhook_events, audit_log

-- ============================================================
-- 1. organizations
-- Special policy: user sees only orgs they have accepted membership in.
-- Uses auth.uid() (Supabase JWT subject) rather than the GUC.
-- ============================================================

ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "organizations_member_visibility" ON "organizations"
  FOR ALL
  USING (
    "id" IN (
      SELECT "org_id" FROM "memberships"
      WHERE "user_id" = auth.uid()
        AND "accepted_at" IS NOT NULL
    )
  );

-- ============================================================
-- 2. memberships
-- ============================================================

ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "memberships_org_isolation" ON "memberships"
  FOR ALL
  USING  ("org_id" = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK ("org_id" = current_setting('app.current_org_id', true)::uuid);

-- ============================================================
-- 3. scripts
-- ============================================================

ALTER TABLE "scripts" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "scripts_org_isolation" ON "scripts"
  FOR ALL
  USING  ("org_id" = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK ("org_id" = current_setting('app.current_org_id', true)::uuid);

-- ============================================================
-- 4. contact_lists
-- ============================================================

ALTER TABLE "contact_lists" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contact_lists_org_isolation" ON "contact_lists"
  FOR ALL
  USING  ("org_id" = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK ("org_id" = current_setting('app.current_org_id', true)::uuid);

-- ============================================================
-- 5. contacts
-- ============================================================

ALTER TABLE "contacts" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contacts_org_isolation" ON "contacts"
  FOR ALL
  USING  ("org_id" = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK ("org_id" = current_setting('app.current_org_id', true)::uuid);

-- ============================================================
-- 6. campaigns
-- ============================================================

ALTER TABLE "campaigns" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "campaigns_org_isolation" ON "campaigns"
  FOR ALL
  USING  ("org_id" = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK ("org_id" = current_setting('app.current_org_id', true)::uuid);

-- ============================================================
-- 7. calls
-- ============================================================

ALTER TABLE "calls" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "calls_org_isolation" ON "calls"
  FOR ALL
  USING  ("org_id" = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK ("org_id" = current_setting('app.current_org_id', true)::uuid);

-- ============================================================
-- 8. appointments
-- ============================================================

ALTER TABLE "appointments" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "appointments_org_isolation" ON "appointments"
  FOR ALL
  USING  ("org_id" = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK ("org_id" = current_setting('app.current_org_id', true)::uuid);

-- ============================================================
-- 9. credit_ledger
-- ============================================================

ALTER TABLE "credit_ledger" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "credit_ledger_org_isolation" ON "credit_ledger"
  FOR ALL
  USING  ("org_id" = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK ("org_id" = current_setting('app.current_org_id', true)::uuid);

-- ============================================================
-- 10. payments
-- ============================================================

ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payments_org_isolation" ON "payments"
  FOR ALL
  USING  ("org_id" = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK ("org_id" = current_setting('app.current_org_id', true)::uuid);

-- ============================================================
-- 11. opt_out_registry
-- ============================================================

ALTER TABLE "opt_out_registry" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "opt_out_registry_org_isolation" ON "opt_out_registry"
  FOR ALL
  USING  ("org_id" = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK ("org_id" = current_setting('app.current_org_id', true)::uuid);

-- ============================================================
-- 12. phone_numbers
-- Only org-scoped rows are visible to authenticated users.
-- Shared-pool rows (org_id IS NULL) are only accessible via service role.
-- ============================================================

ALTER TABLE "phone_numbers" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "phone_numbers_org_isolation" ON "phone_numbers"
  FOR ALL
  USING  ("org_id" = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK ("org_id" = current_setting('app.current_org_id', true)::uuid);

-- ============================================================
-- 13. webhooks_outgoing
-- ============================================================

ALTER TABLE "webhooks_outgoing" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "webhooks_outgoing_org_isolation" ON "webhooks_outgoing"
  FOR ALL
  USING  ("org_id" = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK ("org_id" = current_setting('app.current_org_id', true)::uuid);

-- ============================================================
-- 14. webhook_deliveries
-- No direct org_id; join through webhooks_outgoing.
-- ============================================================

ALTER TABLE "webhook_deliveries" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "webhook_deliveries_org_isolation" ON "webhook_deliveries"
  FOR ALL
  USING (
    "webhook_id" IN (
      SELECT "id" FROM "webhooks_outgoing"
      WHERE "org_id" = current_setting('app.current_org_id', true)::uuid
    )
  )
  WITH CHECK (
    "webhook_id" IN (
      SELECT "id" FROM "webhooks_outgoing"
      WHERE "org_id" = current_setting('app.current_org_id', true)::uuid
    )
  );

-- ============================================================
-- Verification query (run manually after applying):
--
--   SELECT tablename, rowsecurity
--   FROM pg_tables
--   WHERE schemaname = 'public'
--   ORDER BY tablename;
--
-- Expected: all 14 org-scoped tables have rowsecurity = true.
-- Expected: script_templates, credit_packages, rpo_snapshots,
--           webhook_events, audit_log have rowsecurity = false.
-- ============================================================
