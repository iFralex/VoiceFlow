-- Migration: Materialised credit balance trigger
-- Spec §11.1 — credit_ledger.balance_after_cents must always reflect the
-- running balance for an org, computed as the previous row's balance plus
-- delta_cents for the new row.
--
-- The trigger runs BEFORE INSERT so it overwrites any caller-supplied value
-- for balance_after_cents, guaranteeing the column is always consistent.
--
-- IMPLEMENTATION NOTE: MAX vs. LAST ROW
-- ───────────────────────────────────────
-- Using MAX(balance_after_cents) would produce incorrect results once any
-- charge entry reduces the balance below a previous high. For example:
--
--   topup  +10000 → balance 10000
--   charge  -500  → balance  9500   (MAX of history = 10000, not 9500)
--   topup  +5000  → MAX(10000,9500)=10000 → 10000+5000=15000  ✗ (should be 14500)
--
-- The correct approach is to take the balance from the most recently inserted
-- row (ORDER BY created_at DESC LIMIT 1), which is safe because the FOR UPDATE
-- serialisation below prevents concurrent inserts from racing.
--
-- CONCURRENCY / SERIALISATION NOTE
-- ─────────────────────────────────
-- If two concurrent transactions both read the same "last balance" and each
-- adds their own delta, both will compute the same previous balance and produce
-- incorrect results. To prevent this, the service layer (plan 05) MUST
-- serialise per-org writes by issuing:
--
--   SELECT id FROM organizations WHERE id = $orgId FOR UPDATE;
--
-- before every credit_ledger INSERT. The FOR UPDATE on the organisations row
-- acts as a per-org advisory lock: only one transaction at a time can proceed
-- with a ledger write for a given org, making the trigger's subquery a correct,
-- strictly-sequential read.

CREATE OR REPLACE FUNCTION credit_ledger_set_balance()
RETURNS TRIGGER AS $$
BEGIN
  NEW.balance_after_cents := COALESCE(
    (
      SELECT balance_after_cents
      FROM credit_ledger
      WHERE org_id = NEW.org_id
      ORDER BY created_at DESC
      LIMIT 1
    ),
    0
  ) + NEW.delta_cents;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER credit_ledger_balance_trigger
  BEFORE INSERT ON credit_ledger
  FOR EACH ROW EXECUTE FUNCTION credit_ledger_set_balance();

-- ============================================================
-- Verification queries (run manually after applying):
--
--   -- Insert a sequence of entries for one org and check running balances:
--   BEGIN;
--   INSERT INTO credit_ledger (org_id, entry_type, delta_cents, balance_after_cents)
--     VALUES ('<org-uuid>', 'topup', 10000, 0);    -- trigger sets 0 + 10000 = 10000
--   INSERT INTO credit_ledger (org_id, entry_type, delta_cents, balance_after_cents)
--     VALUES ('<org-uuid>', 'charge', -500, 0);    -- trigger sets 10000 + (-500) = 9500
--   INSERT INTO credit_ledger (org_id, entry_type, delta_cents, balance_after_cents)
--     VALUES ('<org-uuid>', 'topup', 5000, 0);     -- trigger sets 9500 + 5000 = 14500
--   SELECT delta_cents, balance_after_cents FROM credit_ledger ORDER BY created_at;
--   -- Expected: 10000→10000, -500→9500, 5000→14500
--   ROLLBACK;
-- ============================================================
