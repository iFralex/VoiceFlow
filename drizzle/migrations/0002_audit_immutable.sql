-- Migration: Audit Log Immutability
-- Spec §7.1 — the audit_log table must be append-only.
--
-- audit_log is a system-owned, append-only table accessed exclusively through
-- server-side transaction helpers (withOrgContext / withSystemContext), which
-- connect as the `postgres` role. The `postgres` role is the table owner and
-- inherits full access without requiring an explicit GRANT.
--
-- The `authenticated` (PostgREST JWT) and `anon` roles must have NO direct
-- access to audit_log: without RLS the table is not org-scoped, so any GRANT
-- would expose every organisation's audit history to any caller. All audit
-- reads and writes must go through the service layer only.
--
-- Revoke all direct access from the PostgREST-facing roles.
REVOKE ALL ON TABLE "audit_log" FROM authenticated;
REVOKE ALL ON TABLE "audit_log" FROM anon;

-- ============================================================
-- Verification query (run manually after applying):
--
--   SET ROLE authenticated;
--   -- This should FAIL with ERROR 42501 (insufficient_privilege):
--   INSERT INTO audit_log (actor_type, action, subject_type, subject_id)
--     VALUES ('system', 'test.insert', 'migration', '0002');
--   -- This should also fail with ERROR 42501 (insufficient_privilege):
--   UPDATE audit_log SET action = 'tampered' WHERE action = 'test.insert';
--   -- This should also fail with ERROR 42501:
--   DELETE FROM audit_log WHERE action = 'test.insert';
--   RESET ROLE;
-- ============================================================
