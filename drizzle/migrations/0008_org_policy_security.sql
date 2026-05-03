-- Migration: Security fix — restrict organizations to read-only via PostgREST
--
-- The original "organizations_member_visibility" policy (0001_rls_policies) used
-- FOR ALL, which means the USING clause was also applied as WITH CHECK. This
-- inadvertently allowed any authenticated member to UPDATE or DELETE their
-- organization row via the PostgREST API.
--
-- Organization mutations (create, rename, delete) must only go through the
-- server-side service layer, which connects as the postgres role and bypasses
-- RLS. Direct writes from the authenticated role must be blocked.
--
-- Fix: drop the FOR ALL policy and replace it with a FOR SELECT policy so
-- authenticated users can only read the organizations they belong to.

DROP POLICY "organizations_member_visibility" ON "organizations";

CREATE POLICY "organizations_member_visibility" ON "organizations"
  FOR SELECT
  USING (
    "id" IN (
      SELECT "org_id" FROM "memberships"
      WHERE "user_id" = auth.uid()
        AND "accepted_at" IS NOT NULL
    )
  );

-- ============================================================
-- Verification (run manually after applying):
--
--   SET LOCAL ROLE authenticated;
--   -- SET jwt claim so auth.uid() returns a known user uuid
--
--   -- SELECT should still work for the user's org:
--   SELECT id, name FROM organizations;
--
--   -- UPDATE should now fail with RLS violation (42501 or empty result):
--   UPDATE organizations SET name = 'hacked' WHERE id = '<org-uuid>';
--
--   -- DELETE should also fail:
--   DELETE FROM organizations WHERE id = '<org-uuid>';
-- ============================================================
