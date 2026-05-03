-- Migration: Review fixes
--
-- 1. Add memberships_self_read policy so users can query their own membership
--    rows without an org context GUC being set. This fixes a circular
--    dependency: the organizations_member_visibility policy reads memberships
--    via a subquery, but memberships RLS requires app.current_org_id to be
--    non-empty. Without this policy, authenticated users can never list their
--    organisations (e.g. at login, before an org has been selected).
--
-- 2. Add a UNIQUE constraint on users.email to prevent duplicate user rows
--    for the same email address, which would corrupt membership lookups.

-- ============================================================
-- 1. memberships — self-read policy (no GUC required)
-- ============================================================

CREATE POLICY "memberships_self_read" ON "memberships"
  FOR SELECT
  USING ("user_id" = auth.uid());

-- ============================================================
-- 2. users — unique email constraint
-- ============================================================

ALTER TABLE "users"
  ADD CONSTRAINT "users_email_unique" UNIQUE("email");

-- ============================================================
-- Verification queries (run manually after applying):
--
--   -- Test self-read policy: set role to authenticated with a known user id
--   -- and verify memberships for that user are visible without GUC:
--   SET LOCAL ROLE authenticated;
--   SET LOCAL request.jwt.claims = '{"sub": "<user-uuid>"}';
--   SELECT * FROM memberships WHERE user_id = auth.uid();
--   -- Should return the user's memberships regardless of app.current_org_id.
--
--   -- Test email uniqueness:
--   INSERT INTO users (id, email) VALUES (gen_random_uuid(), 'dup@example.com');
--   INSERT INTO users (id, email) VALUES (gen_random_uuid(), 'dup@example.com');
--   -- Second INSERT should fail with unique constraint violation.
-- ============================================================
