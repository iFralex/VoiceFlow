-- Migration: Allow users to SELECT their own membership rows via Supabase PostgREST
--
-- The existing "memberships_org_isolation" policy uses the app.current_org_id GUC,
-- which is only set inside service-layer transactions (withOrgContext). It does NOT
-- work for PostgREST requests authenticated via JWT (e.g. from middleware).
--
-- Middleware needs to query the memberships table via the Supabase anon client
-- (PostgREST + user JWT) to resolve which organisation a user belongs to and
-- what role they hold. This requires a separate permissive policy based on
-- auth.uid() rather than the GUC.
--
-- Multiple permissive policies combine with OR, so this policy adds a SELECT
-- path without disturbing the existing GUC-based write policies.

CREATE POLICY "memberships_self_select" ON "memberships"
  FOR SELECT
  USING (user_id = auth.uid());

-- ============================================================
-- Verification (run manually after applying):
--
--   -- As an authenticated user (JWT role):
--   SELECT org_id, role FROM memberships WHERE user_id = auth.uid();
--   -- Should return the user's own memberships without setting the GUC.
--
--   -- Cross-user read should still be blocked by RLS:
--   SELECT org_id, role FROM memberships WHERE user_id != auth.uid();
--   -- Should return zero rows (filtered by RLS, not an error).
-- ============================================================
