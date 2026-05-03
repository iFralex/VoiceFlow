import { describe, expect, it } from 'vitest';

import { creditEntryTypeEnum, creditLedger } from './credit_ledger';
import { creditPackages } from './credit_packages';
import { paymentStatusEnum, payments } from './payments';

// Helper for accessing Drizzle column config properties in schema tests
type Col = Record<string, unknown>;
type Tbl = Record<string, Col>;

describe('credit_packages schema', () => {
  it('has expected columns', () => {
    const cols = Object.keys(creditPackages);
    expect(cols).toContain('id');
    expect(cols).toContain('slug');
    expect(cols).toContain('display_name');
    expect(cols).toContain('price_cents');
    expect(cols).toContain('included_minutes');
    expect(cols).toContain('stripe_price_id');
    expect(cols).toContain('active');
  });

  it('active defaults to true', () => {
    const col = (creditPackages as unknown as Tbl).active!;
    expect(col.default).toBe(true);
  });

  it('stripe_price_id is nullable', () => {
    const col = (creditPackages as unknown as Tbl).stripe_price_id!;
    expect(col.notNull).toBeFalsy();
  });
});

describe('credit_ledger schema', () => {
  it('has expected columns', () => {
    const cols = Object.keys(creditLedger);
    expect(cols).toContain('id');
    expect(cols).toContain('org_id');
    expect(cols).toContain('entry_type');
    expect(cols).toContain('delta_cents');
    expect(cols).toContain('balance_after_cents');
    expect(cols).toContain('reference_type');
    expect(cols).toContain('reference_id');
    expect(cols).toContain('description');
    expect(cols).toContain('created_at');
  });

  it('creditEntryTypeEnum has correct values', () => {
    expect(creditEntryTypeEnum.enumValues).toEqual([
      'topup',
      'reservation',
      'release',
      'charge',
      'refund',
      'adjustment',
    ]);
  });

  it('nullable optional fields', () => {
    for (const field of ['reference_type', 'reference_id', 'description']) {
      const col = (creditLedger as unknown as unknown as Tbl)[field]!;
      expect(col.notNull, `${field} should be nullable`).toBeFalsy();
    }
  });

  it('balance_after_cents is not null', () => {
    const col = (creditLedger as unknown as Tbl).balance_after_cents!;
    expect(col.notNull).toBeTruthy();
  });
});

describe('payments schema', () => {
  it('has expected columns', () => {
    const cols = Object.keys(payments);
    expect(cols).toContain('id');
    expect(cols).toContain('org_id');
    expect(cols).toContain('package_id');
    expect(cols).toContain('stripe_session_id');
    expect(cols).toContain('stripe_payment_intent_id');
    expect(cols).toContain('amount_cents');
    expect(cols).toContain('currency');
    expect(cols).toContain('status');
    expect(cols).toContain('invoice_url');
    expect(cols).toContain('created_at');
    expect(cols).toContain('completed_at');
  });

  it('currency defaults to eur', () => {
    const col = (payments as unknown as Tbl).currency!;
    expect(col.default).toBe('eur');
  });

  it('status defaults to pending', () => {
    const col = (payments as unknown as Tbl).status!;
    expect(col.default).toBe('pending');
  });

  it('paymentStatusEnum has correct values', () => {
    expect(paymentStatusEnum.enumValues).toEqual([
      'pending',
      'succeeded',
      'failed',
      'refunded',
    ]);
  });

  it('nullable optional fields', () => {
    for (const field of ['stripe_payment_intent_id', 'invoice_url', 'completed_at']) {
      const col = (payments as unknown as unknown as Tbl)[field]!;
      expect(col.notNull, `${field} should be nullable`).toBeFalsy();
    }
  });
});
