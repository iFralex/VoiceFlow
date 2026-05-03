-- Migration: Audit Log Immutability
-- Spec §7.1 — the audit_log table must be append-only.
--
-- The `authenticated` and `anon` Supabase roles represent application users
-- running via the PostgREST API gateway. Revoking UPDATE and DELETE from these
-- roles ensures no client-side code (even if exploited) can alter or remove
-- audit entries. INSERT and SELECT remain permitted so the application can
-- record and query audit events.
--
-- The `service_role` in Supabase bypasses all GRANT/REVOKE checks (it holds
-- superuser-like privileges). Audit inserts from the service layer therefore
-- continue to work. This is intentional: `recordAudit()` is only called from
-- server-side transaction helpers (never exposed to client code).

-- Revoke mutation privileges from the application-facing roles.
REVOKE UPDATE, DELETE ON TABLE "audit_log" FROM authenticated;
REVOKE UPDATE, DELETE ON TABLE "audit_log" FROM anon;

-- Ensure SELECT and INSERT are explicitly granted (Supabase default grants
-- these to authenticated already, but we make the intent explicit).
GRANT SELECT, INSERT ON TABLE "audit_log" TO authenticated;
GRANT SELECT ON TABLE "audit_log" TO anon;

-- ============================================================
-- Verification query (run manually after applying):
--
--   SET ROLE authenticated;
--   -- This should succeed:
--   INSERT INTO audit_log (actor_type, action, subject_type, subject_id)
--     VALUES ('system', 'test.insert', 'migration', '0002');
--   -- This should fail with ERROR 42501 (insufficient_privilege):
--   UPDATE audit_log SET action = 'tampered' WHERE action = 'test.insert';
--   -- This should also fail with ERROR 42501:
--   DELETE FROM audit_log WHERE action = 'test.insert';
--   RESET ROLE;
-- ============================================================
