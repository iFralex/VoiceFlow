-- Migration: fix credit_ledger_set_balance trigger to use id as tiebreaker
--
-- When two ledger rows for the same org share an identical created_at timestamp
-- (which can happen when millisecond-precision clocks collide under load), the
-- ORDER BY created_at DESC LIMIT 1 in the original trigger is non-deterministic.
-- Adding id DESC as a secondary sort key provides a stable tiebreaker so that
-- concurrent rows with the same timestamp are always ordered consistently.
-- Note: credit_ledger.id is a UUID (gen_random_uuid()), so id DESC ordering is
-- arbitrary — it does NOT imply insertion order. A future migration should add a
-- bigserial sequence column to provide a true insertion-order tiebreaker.

CREATE OR REPLACE FUNCTION credit_ledger_set_balance()
RETURNS TRIGGER AS $$
BEGIN
  NEW.balance_after_cents := COALESCE(
    (
      SELECT balance_after_cents
      FROM credit_ledger
      WHERE org_id = NEW.org_id
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    ),
    0
  ) + NEW.delta_cents;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
