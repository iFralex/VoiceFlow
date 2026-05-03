import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// ──────────────────────────────────────────────────────────────────────────────
// Pure-JS simulation of the SQL trigger logic
//
// The Postgres trigger runs:
//   NEW.balance_after_cents :=
//     COALESCE(
//       (SELECT balance_after_cents FROM credit_ledger
//        WHERE org_id = NEW.org_id ORDER BY created_at DESC LIMIT 1),
//       0
//     ) + NEW.delta_cents;
//
// We replicate this as a JS function so we can unit-test the running-balance
// logic without a live database.
// ──────────────────────────────────────────────────────────────────────────────

interface LedgerRow {
  org_id: string;
  delta_cents: number;
  balance_after_cents: number;
}

/**
 * Simulates the credit_ledger_set_balance trigger.
 * Mirrors the SQL: COALESCE((SELECT balance_after_cents FROM credit_ledger
 * WHERE org_id = NEW.org_id ORDER BY created_at DESC LIMIT 1), 0) + NEW.delta_cents
 *
 * We use the last element in existingRows for the same org as the "most recently
 * inserted" row, which matches the ORDER BY created_at DESC LIMIT 1 behaviour
 * in the fully-serialised (FOR UPDATE) insert pattern.
 */
function applyBalanceTrigger(existingRows: LedgerRow[], newRow: Omit<LedgerRow, 'balance_after_cents'>): LedgerRow {
  const orgRows = existingRows.filter((r) => r.org_id === newRow.org_id);
  const lastRow = orgRows.length > 0 ? orgRows[orgRows.length - 1] : null;
  const prevBalance = lastRow ? lastRow.balance_after_cents : 0;
  return {
    ...newRow,
    balance_after_cents: prevBalance + newRow.delta_cents,
  };
}

describe('credit balance trigger — logic simulation', () => {
  it('computes balance_after_cents as 0 + delta for the first entry', () => {
    const row = applyBalanceTrigger([], { org_id: 'org-1', delta_cents: 10000 });
    expect(row.balance_after_cents).toBe(10000);
  });

  it('adds delta to the most recent balance (ORDER BY created_at DESC LIMIT 1)', () => {
    const existing: LedgerRow[] = [
      { org_id: 'org-1', delta_cents: 10000, balance_after_cents: 10000 },
    ];
    const row = applyBalanceTrigger(existing, { org_id: 'org-1', delta_cents: -500 });
    expect(row.balance_after_cents).toBe(9500);
  });

  it('maintains a correct running balance across a sequence of inserts', () => {
    const ledger: LedgerRow[] = [];

    const r1 = applyBalanceTrigger(ledger, { org_id: 'org-1', delta_cents: 10000 });
    ledger.push(r1);
    expect(r1.balance_after_cents).toBe(10000);

    const r2 = applyBalanceTrigger(ledger, { org_id: 'org-1', delta_cents: -500 });
    ledger.push(r2);
    expect(r2.balance_after_cents).toBe(9500);

    const r3 = applyBalanceTrigger(ledger, { org_id: 'org-1', delta_cents: 5000 });
    ledger.push(r3);
    expect(r3.balance_after_cents).toBe(14500);

    const r4 = applyBalanceTrigger(ledger, { org_id: 'org-1', delta_cents: -14500 });
    ledger.push(r4);
    expect(r4.balance_after_cents).toBe(0);
  });

  it('allows balance to go negative (delta can exceed current balance)', () => {
    const existing: LedgerRow[] = [
      { org_id: 'org-1', delta_cents: 100, balance_after_cents: 100 },
    ];
    const row = applyBalanceTrigger(existing, { org_id: 'org-1', delta_cents: -300 });
    expect(row.balance_after_cents).toBe(-200);
  });

  it('isolates balances per org_id', () => {
    const ledger: LedgerRow[] = [];

    const a1 = applyBalanceTrigger(ledger, { org_id: 'org-A', delta_cents: 5000 });
    ledger.push(a1);

    const b1 = applyBalanceTrigger(ledger, { org_id: 'org-B', delta_cents: 3000 });
    ledger.push(b1);

    const a2 = applyBalanceTrigger(ledger, { org_id: 'org-A', delta_cents: -1000 });
    ledger.push(a2);

    // org-A: 5000 → 4000; org-B: 3000 (unchanged by org-A's entries)
    expect(a2.balance_after_cents).toBe(4000);
    expect(b1.balance_after_cents).toBe(3000);
  });

  it('handles a large sequence without drift', () => {
    const ledger: LedgerRow[] = [];
    const deltas = [10000, -200, -300, 5000, -4000, 1000, -500, 200, -100, 50];
    let expected = 0;

    for (const delta of deltas) {
      const row = applyBalanceTrigger(ledger, { org_id: 'org-1', delta_cents: delta });
      ledger.push(row);
      expected += delta;
      expect(row.balance_after_cents).toBe(expected);
    }
  });

  it('starting balance for a new org is 0 even if other orgs have entries', () => {
    const existing: LedgerRow[] = [
      { org_id: 'org-other', delta_cents: 99999, balance_after_cents: 99999 },
    ];
    const row = applyBalanceTrigger(existing, { org_id: 'org-new', delta_cents: 1000 });
    expect(row.balance_after_cents).toBe(1000);
  });

  it('uses COALESCE — returns delta directly when no prior rows exist for org', () => {
    // COALESCE((SELECT balance_after_cents ... ORDER BY created_at DESC LIMIT 1), 0) = 0 when no rows exist for org
    const row = applyBalanceTrigger([], { org_id: 'org-empty', delta_cents: -999 });
    expect(row.balance_after_cents).toBe(-999);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Migration file structure tests
// ──────────────────────────────────────────────────────────────────────────────

describe('migration 0003_credit_balance_trigger.sql', () => {
  const migrationPath = join(
    process.cwd(),
    'drizzle/migrations/0003_credit_balance_trigger.sql',
  );
  let sql: string;

  it('migration file exists and is non-empty', () => {
    sql = readFileSync(migrationPath, 'utf-8');
    expect(sql.length).toBeGreaterThan(100);
  });

  it('defines the trigger function credit_ledger_set_balance', () => {
    sql ??= readFileSync(migrationPath, 'utf-8');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION credit_ledger_set_balance()');
  });

  it('trigger function uses COALESCE to default to 0 when no prior rows exist', () => {
    sql ??= readFileSync(migrationPath, 'utf-8');
    expect(sql).toContain('COALESCE(');
  });

  it('trigger function selects the most recent row (ORDER BY created_at DESC LIMIT 1)', () => {
    sql ??= readFileSync(migrationPath, 'utf-8');
    expect(sql).toContain('ORDER BY created_at DESC');
    expect(sql).toContain('LIMIT 1');
  });

  it('trigger function filters by org_id = NEW.org_id', () => {
    sql ??= readFileSync(migrationPath, 'utf-8');
    expect(sql).toContain('WHERE org_id = NEW.org_id');
  });

  it('assigns result to NEW.balance_after_cents', () => {
    sql ??= readFileSync(migrationPath, 'utf-8');
    expect(sql).toContain('NEW.balance_after_cents :=');
  });

  it('creates a BEFORE INSERT trigger on credit_ledger', () => {
    sql ??= readFileSync(migrationPath, 'utf-8');
    expect(sql).toContain('BEFORE INSERT ON credit_ledger');
  });

  it('trigger executes FOR EACH ROW', () => {
    sql ??= readFileSync(migrationPath, 'utf-8');
    expect(sql).toContain('FOR EACH ROW');
  });

  it('documents SELECT FOR UPDATE serialisation pattern', () => {
    sql ??= readFileSync(migrationPath, 'utf-8');
    expect(sql).toContain('FOR UPDATE');
  });
});
