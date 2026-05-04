import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockRecordAudit = vi.fn().mockResolvedValue(undefined);
const mockSendInngestEvent = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/db/audit', () => ({
  recordAudit: (...args: unknown[]) => mockRecordAudit(...args),
}));

vi.mock('@/lib/inngest/client', () => ({
  sendInngestEvent: (...args: unknown[]) => mockSendInngestEvent(...args),
}));

// Select results queue — consumed in FIFO order per test
let selectResults: unknown[][] = [];
let insertResults: unknown[][] = [];

// Creates a thenable chain mock that resolves to the next item from selectResults
function makeSelectChain(result: unknown[]) {
  const chain: Record<string, () => typeof chain> & { then?: unknown } = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    for: () => chain,
    innerJoin: () => chain,
  };
  // Make awaitable
  (chain as Record<string, unknown>).then = (
    resolve: (v: unknown) => unknown,
    reject?: (e: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

const mockTx = {
  select: vi.fn(),
  insert: vi.fn(),
  execute: vi.fn().mockResolvedValue(undefined),
};

function resetMockTx() {
  mockTx.select.mockImplementation(() => {
    const result = selectResults.shift() ?? [];
    return makeSelectChain(result);
  });

  mockTx.insert.mockImplementation(() => {
    const result = insertResults.shift() ?? [];
    return {
      values: vi.fn(() => ({
        onConflictDoNothing: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue(result),
        })),
        // For adjust (no onConflictDoNothing)
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
      })),
    };
  });
}

vi.mock('@/lib/db/context', () => ({
  withOrgContext: vi.fn((_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(mockTx)),
  withSystemContext: vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn(mockTx)),
}));

const { withOrgContext } = await import('@/lib/db/context');

beforeEach(() => {
  vi.clearAllMocks();
  selectResults = [];
  insertResults = [];
  resetMockTx();
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ORG_ID = 'org-1';
const CAMPAIGN_ID = 'camp-1';
const CALL_ID = 'call-1';
const PAYMENT_INTENT_ID = 'pi_test_123';
const PACKAGE_ID = 'pkg-starter';
const USER_ID = 'user-1';
const LEDGER_ROW = { id: 'led-1' };

// ─── getBalance ────────────────────────────────────────────────────────────────

describe('getBalance', () => {
  it('returns zero balance and zero minutes when no ledger entries exist', async () => {
    selectResults.push([]); // latest balance row → none
    selectResults.push([]); // topups → none

    const { getBalance } = await import('./credit');
    const result = await getBalance(ORG_ID);

    expect(result.balanceCents).toBe(0);
    expect(result.remainingMinutes).toBe(0);
    expect(withOrgContext).toHaveBeenCalledWith(ORG_ID, expect.any(Function));
  });

  it('returns balance from the latest ledger entry', async () => {
    selectResults.push([{ balance_after_cents: 5000 }]); // latest balance
    selectResults.push([]); // topups → none (no packages)

    const { getBalance } = await import('./credit');
    const result = await getBalance(ORG_ID);

    expect(result.balanceCents).toBe(5000);
    expect(result.remainingMinutes).toBe(0); // no packages purchased
  });

  it('computes remainingMinutes using weighted average across purchased packages', async () => {
    // Balance: 2990 cents
    // Topup 1: 2990 cents for 700 minutes (Starter) → 4.27 c/min
    // Weighted avg: 2990 / 700 ≈ 4.27 c/min
    // Remaining: floor(2990 / 4.27) = 700 minutes
    selectResults.push([{ balance_after_cents: 2990 }]); // latest balance
    selectResults.push([{ delta_cents: 2990, reference_id: PAYMENT_INTENT_ID }]); // topups
    selectResults.push([{ package_id: PACKAGE_ID }]); // payment → package
    selectResults.push([{ included_minutes: 700 }]); // package minutes

    const { getBalance } = await import('./credit');
    const result = await getBalance(ORG_ID);

    expect(result.balanceCents).toBe(2990);
    expect(result.remainingMinutes).toBe(700);
  });

  it('computes weighted average across multiple packages', async () => {
    // Package A: 990 cents, 200 minutes → 4.95 c/min
    // Package B: 2990 cents, 700 minutes → 4.27 c/min
    // Total: 3980 cents, 900 minutes → 4.42 c/min
    // Balance: 1990 → floor(1990 / (3980/900)) = floor(1990 * 900 / 3980) = floor(450) = 450
    selectResults.push([{ balance_after_cents: 1990 }]); // latest balance
    selectResults.push([
      { delta_cents: 990, reference_id: 'pi_a' },
      { delta_cents: 2990, reference_id: 'pi_b' },
    ]); // topups
    selectResults.push([{ package_id: 'pkg-a' }]); // payment for pi_a
    selectResults.push([{ included_minutes: 200 }]); // package A minutes
    selectResults.push([{ package_id: 'pkg-b' }]); // payment for pi_b
    selectResults.push([{ included_minutes: 700 }]); // package B minutes

    const { getBalance } = await import('./credit');
    const result = await getBalance(ORG_ID);

    expect(result.balanceCents).toBe(1990);
    // weighted avg = (990 + 2990) / (200 + 700) = 3980 / 900 ≈ 4.422 c/min
    // remaining = floor(1990 / 4.422) ≈ floor(450) = 450
    expect(result.remainingMinutes).toBe(450);
  });
});

// ─── topUp ────────────────────────────────────────────────────────────────────

describe('topUp', () => {
  it('inserts a topup ledger entry with the correct new balance', async () => {
    selectResults.push([{ balance_after_cents: 1000 }]); // lockBalance
    insertResults.push([LEDGER_ROW]); // insert returning

    const { topUp } = await import('./credit');
    await topUp(ORG_ID, {
      amountCents: 2990,
      packageId: PACKAGE_ID,
      stripePaymentIntentId: PAYMENT_INTENT_ID,
      description: 'Starter package',
    });

    expect(mockTx.insert).toHaveBeenCalledOnce();
    const insertCall = mockTx.insert.mock.calls[0]?.[0];
    expect(insertCall).toBeDefined();

    const valuesCall = mockTx.insert.mock.results[0]?.value.values;
    expect(valuesCall).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: ORG_ID,
        entry_type: 'topup',
        delta_cents: 2990,
        balance_after_cents: 3990,
        reference_type: 'payment',
        reference_id: PAYMENT_INTENT_ID,
      }),
    );
  });

  it('records a credit.topup audit entry', async () => {
    selectResults.push([{ balance_after_cents: 0 }]); // lockBalance
    insertResults.push([LEDGER_ROW]);

    const { topUp } = await import('./credit');
    await topUp(ORG_ID, {
      amountCents: 990,
      packageId: PACKAGE_ID,
      stripePaymentIntentId: PAYMENT_INTENT_ID,
      description: 'Test package',
    });

    expect(mockRecordAudit).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({
        action: 'credit.topup',
        orgId: ORG_ID,
        metadata: expect.objectContaining({ amountCents: 990, packageId: PACKAGE_ID }),
      }),
    );
  });

  it('is idempotent — no audit call when insert conflicts (duplicate delivery)', async () => {
    selectResults.push([{ balance_after_cents: 2990 }]); // lockBalance
    insertResults.push([]); // insert returns empty → conflict, no-op

    const { topUp } = await import('./credit');
    await topUp(ORG_ID, {
      amountCents: 2990,
      packageId: PACKAGE_ID,
      stripePaymentIntentId: PAYMENT_INTENT_ID,
      description: 'Starter package',
    });

    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it('uses withOrgContext', async () => {
    selectResults.push([{ balance_after_cents: 0 }]);
    insertResults.push([LEDGER_ROW]);

    const { topUp } = await import('./credit');
    await topUp(ORG_ID, {
      amountCents: 990,
      packageId: PACKAGE_ID,
      stripePaymentIntentId: PAYMENT_INTENT_ID,
      description: 'x',
    });

    expect(withOrgContext).toHaveBeenCalledWith(ORG_ID, expect.any(Function));
  });
});

// ─── reserveForCampaign ───────────────────────────────────────────────────────

describe('reserveForCampaign', () => {
  it('deducts maxCents from balance and inserts a reservation entry', async () => {
    selectResults.push([{ balance_after_cents: 5000 }]); // lockBalance
    insertResults.push([LEDGER_ROW]);

    const { reserveForCampaign } = await import('./credit');
    await reserveForCampaign(ORG_ID, CAMPAIGN_ID, 1000);

    const valuesCall = mockTx.insert.mock.results[0]?.value.values;
    expect(valuesCall).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: ORG_ID,
        entry_type: 'reservation',
        delta_cents: -1000,
        balance_after_cents: 4000,
        reference_type: 'campaign',
        reference_id: CAMPAIGN_ID,
      }),
    );
  });

  it('records a credit.reserved audit entry', async () => {
    selectResults.push([{ balance_after_cents: 5000 }]);
    insertResults.push([LEDGER_ROW]);

    const { reserveForCampaign } = await import('./credit');
    await reserveForCampaign(ORG_ID, CAMPAIGN_ID, 500);

    expect(mockRecordAudit).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({
        action: 'credit.reserved',
        subjectId: CAMPAIGN_ID,
        metadata: expect.objectContaining({ maxCents: 500 }),
      }),
    );
  });

  it('throws insufficient_credit when balance is less than maxCents', async () => {
    selectResults.push([{ balance_after_cents: 100 }]); // only 100 cents available

    const { reserveForCampaign } = await import('./credit');
    await expect(reserveForCampaign(ORG_ID, CAMPAIGN_ID, 500)).rejects.toThrow(
      'insufficient_credit',
    );
    expect(mockTx.insert).not.toHaveBeenCalled();
  });

  it('is idempotent — no audit when insert conflicts', async () => {
    selectResults.push([{ balance_after_cents: 5000 }]);
    insertResults.push([]); // conflict → no-op

    const { reserveForCampaign } = await import('./credit');
    await reserveForCampaign(ORG_ID, CAMPAIGN_ID, 500);

    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it('succeeds when balance exactly equals maxCents', async () => {
    selectResults.push([{ balance_after_cents: 500 }]);
    insertResults.push([LEDGER_ROW]);

    const { reserveForCampaign } = await import('./credit');
    await expect(reserveForCampaign(ORG_ID, CAMPAIGN_ID, 500)).resolves.toBeUndefined();
  });
});

// ─── releaseReservation ───────────────────────────────────────────────────────

describe('releaseReservation', () => {
  it('releases the full reservation when no calls were charged', async () => {
    selectResults.push([{ delta_cents: -500 }]); // reservation entry
    selectResults.push([]); // campaign calls → none
    selectResults.push([{ balance_after_cents: 500 }]); // lockBalance
    insertResults.push([LEDGER_ROW]);

    const { releaseReservation } = await import('./credit');
    await releaseReservation(ORG_ID, CAMPAIGN_ID);

    const valuesCall = mockTx.insert.mock.results[0]?.value.values;
    expect(valuesCall).toHaveBeenCalledWith(
      expect.objectContaining({
        entry_type: 'release',
        delta_cents: 500, // full reservation returned
        balance_after_cents: 1000,
        reference_type: 'campaign',
        reference_id: CAMPAIGN_ID,
      }),
    );
  });

  it('releases only unused portion when calls were charged', async () => {
    selectResults.push([{ delta_cents: -500 }]); // reservation = 500 cents
    selectResults.push([{ id: CALL_ID }]); // campaign has one call
    selectResults.push([{ total: '-300' }]); // sum of charges = -300 → 300 charged
    selectResults.push([{ balance_after_cents: 200 }]); // lockBalance after charges
    insertResults.push([LEDGER_ROW]);

    const { releaseReservation } = await import('./credit');
    await releaseReservation(ORG_ID, CAMPAIGN_ID);

    const valuesCall = mockTx.insert.mock.results[0]?.value.values;
    expect(valuesCall).toHaveBeenCalledWith(
      expect.objectContaining({
        entry_type: 'release',
        delta_cents: 200, // 500 - 300 = 200 unused
        balance_after_cents: 400,
      }),
    );
  });

  it('is a no-op when all reserved credit was consumed by charges (unused = 0)', async () => {
    selectResults.push([{ delta_cents: -500 }]); // reservation = 500
    selectResults.push([{ id: CALL_ID }]); // one call
    selectResults.push([{ total: '-500' }]); // exactly 500 charged

    const { releaseReservation } = await import('./credit');
    await releaseReservation(ORG_ID, CAMPAIGN_ID);

    // No ledger entry should be written when nothing remains to release
    expect(mockTx.insert).not.toHaveBeenCalled();
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it('is a no-op when no reservation entry exists', async () => {
    selectResults.push([]); // no reservation

    const { releaseReservation } = await import('./credit');
    await releaseReservation(ORG_ID, CAMPAIGN_ID);

    expect(mockTx.insert).not.toHaveBeenCalled();
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it('is idempotent — no audit when release entry already exists (conflict)', async () => {
    selectResults.push([{ delta_cents: -500 }]); // reservation
    selectResults.push([]); // no calls
    selectResults.push([{ balance_after_cents: 500 }]); // lockBalance
    insertResults.push([]); // conflict → no-op

    const { releaseReservation } = await import('./credit');
    await releaseReservation(ORG_ID, CAMPAIGN_ID);

    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it('records a credit.released audit entry', async () => {
    selectResults.push([{ delta_cents: -1000 }]); // reservation
    selectResults.push([]); // no calls
    selectResults.push([{ balance_after_cents: 100 }]); // lockBalance
    insertResults.push([LEDGER_ROW]);

    const { releaseReservation } = await import('./credit');
    await releaseReservation(ORG_ID, CAMPAIGN_ID);

    expect(mockRecordAudit).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({
        action: 'credit.released',
        subjectId: CAMPAIGN_ID,
        metadata: expect.objectContaining({ reservedCents: 1000, totalCharged: 0, unused: 1000 }),
      }),
    );
  });
});

// ─── chargeForCall ────────────────────────────────────────────────────────────

describe('chargeForCall', () => {
  it('deducts costCents from balance and inserts a charge entry', async () => {
    selectResults.push([{ balance_after_cents: 5000 }]); // lockBalance
    insertResults.push([LEDGER_ROW]);

    const { chargeForCall } = await import('./credit');
    await chargeForCall(ORG_ID, CALL_ID, 150);

    const valuesCall = mockTx.insert.mock.results[0]?.value.values;
    expect(valuesCall).toHaveBeenCalledWith(
      expect.objectContaining({
        entry_type: 'charge',
        delta_cents: -150,
        balance_after_cents: 4850,
        reference_type: 'call',
        reference_id: CALL_ID,
      }),
    );
  });

  it('records a credit.charged audit entry', async () => {
    selectResults.push([{ balance_after_cents: 5000 }]);
    insertResults.push([LEDGER_ROW]);

    const { chargeForCall } = await import('./credit');
    await chargeForCall(ORG_ID, CALL_ID, 75);

    expect(mockRecordAudit).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({
        action: 'credit.charged',
        subjectId: CALL_ID,
        metadata: expect.objectContaining({ costCents: 75 }),
      }),
    );
  });

  it('is a no-op for zero cost calls', async () => {
    const { chargeForCall } = await import('./credit');
    await chargeForCall(ORG_ID, CALL_ID, 0);

    expect(mockTx.insert).not.toHaveBeenCalled();
    expect(withOrgContext).not.toHaveBeenCalled();
  });

  it('is idempotent — no audit when insert conflicts', async () => {
    selectResults.push([{ balance_after_cents: 5000 }]);
    insertResults.push([]); // conflict → no-op

    const { chargeForCall } = await import('./credit');
    await chargeForCall(ORG_ID, CALL_ID, 100);

    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it('emits credit/low-balance event when remaining minutes cross below threshold', async () => {
    // Setup: balance 3000 → charge 2990 → newBalance 10 cents
    // Rate: 2990 cents / 700 min ≈ 4.27 c/min → floor(10/4.27) = 2 minutes → below 30
    // No prior alert today → should emit
    process.env['CREDIT_SOFT_THRESHOLD_MINUTES'] = '30';

    selectResults.push([{ balance_after_cents: 3000 }]); // lockBalance (charge tx)
    insertResults.push([LEDGER_ROW]);                     // insert charge entry
    // maybeEmitLowBalanceAlert → withOrgContext → weightedAvgCentsPerMinute
    selectResults.push([{ delta_cents: 2990, reference_id: PAYMENT_INTENT_ID }]); // topups
    selectResults.push([{ package_id: PACKAGE_ID }]);                            // payment
    selectResults.push([{ included_minutes: 700 }]);                             // package
    // maybeEmitLowBalanceAlert → withSystemContext → auditLog check
    selectResults.push([]); // no prior alert today

    const { chargeForCall } = await import('./credit');
    await chargeForCall(ORG_ID, CALL_ID, 2990);

    expect(mockSendInngestEvent).toHaveBeenCalledOnce();
    expect(mockSendInngestEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'credit/low-balance',
        data: expect.objectContaining({ orgId: ORG_ID, balanceCents: 10, remainingMinutes: 2 }),
      }),
    );
  });

  it('does not emit event when remaining minutes are above threshold', async () => {
    process.env['CREDIT_SOFT_THRESHOLD_MINUTES'] = '30';

    // balance 10000 → charge 100 → newBalance 9900 cents; rate 4.27 → 2318 min → above 30
    selectResults.push([{ balance_after_cents: 10000 }]); // lockBalance
    insertResults.push([LEDGER_ROW]);
    // weightedAvgCentsPerMinute
    selectResults.push([{ delta_cents: 2990, reference_id: PAYMENT_INTENT_ID }]);
    selectResults.push([{ package_id: PACKAGE_ID }]);
    selectResults.push([{ included_minutes: 700 }]);

    const { chargeForCall } = await import('./credit');
    await chargeForCall(ORG_ID, CALL_ID, 100);

    expect(mockSendInngestEvent).not.toHaveBeenCalled();
  });

  it('does not emit event if already alerted today', async () => {
    process.env['CREDIT_SOFT_THRESHOLD_MINUTES'] = '30';

    selectResults.push([{ balance_after_cents: 3000 }]); // lockBalance
    insertResults.push([LEDGER_ROW]);
    selectResults.push([{ delta_cents: 2990, reference_id: PAYMENT_INTENT_ID }]);
    selectResults.push([{ package_id: PACKAGE_ID }]);
    selectResults.push([{ included_minutes: 700 }]);
    selectResults.push([{ id: 'audit-1' }]); // audit_log has entry today → already alerted

    const { chargeForCall } = await import('./credit');
    await chargeForCall(ORG_ID, CALL_ID, 2990);

    expect(mockSendInngestEvent).not.toHaveBeenCalled();
  });

  it('does not emit event when no packages have been purchased', async () => {
    process.env['CREDIT_SOFT_THRESHOLD_MINUTES'] = '30';

    selectResults.push([{ balance_after_cents: 1000 }]); // lockBalance
    insertResults.push([LEDGER_ROW]);
    selectResults.push([]); // no topup entries → centsPerMinute null → returns early

    const { chargeForCall } = await import('./credit');
    await chargeForCall(ORG_ID, CALL_ID, 10);

    expect(mockSendInngestEvent).not.toHaveBeenCalled();
  });

  it('does not emit event for duplicate charge (idempotent)', async () => {
    process.env['CREDIT_SOFT_THRESHOLD_MINUTES'] = '30';

    selectResults.push([{ balance_after_cents: 5000 }]);
    insertResults.push([]); // conflict → no-op → newBalance stays undefined

    const { chargeForCall } = await import('./credit');
    await chargeForCall(ORG_ID, CALL_ID, 100);

    expect(mockSendInngestEvent).not.toHaveBeenCalled();
  });

  it('suppresses alert errors — chargeForCall resolves even if sendInngestEvent throws', async () => {
    process.env['CREDIT_SOFT_THRESHOLD_MINUTES'] = '30';
    mockSendInngestEvent.mockRejectedValueOnce(new Error('Inngest down'));

    selectResults.push([{ balance_after_cents: 3000 }]);
    insertResults.push([LEDGER_ROW]);
    selectResults.push([{ delta_cents: 2990, reference_id: PAYMENT_INTENT_ID }]);
    selectResults.push([{ package_id: PACKAGE_ID }]);
    selectResults.push([{ included_minutes: 700 }]);
    selectResults.push([]); // no prior alert

    const { chargeForCall } = await import('./credit');
    await expect(chargeForCall(ORG_ID, CALL_ID, 2990)).resolves.toBeUndefined();
  });
});

// ─── refundCall ───────────────────────────────────────────────────────────────

describe('refundCall', () => {
  it('adds costCents back to balance and inserts a refund entry', async () => {
    selectResults.push([{ balance_after_cents: 4850 }]); // lockBalance
    insertResults.push([LEDGER_ROW]);

    const { refundCall } = await import('./credit');
    await refundCall(ORG_ID, CALL_ID, 150, 'Provider error');

    const valuesCall = mockTx.insert.mock.results[0]?.value.values;
    expect(valuesCall).toHaveBeenCalledWith(
      expect.objectContaining({
        entry_type: 'refund',
        delta_cents: 150,
        balance_after_cents: 5000,
        reference_type: 'call',
        reference_id: CALL_ID,
        description: 'Provider error',
      }),
    );
  });

  it('records a credit.refunded audit entry', async () => {
    selectResults.push([{ balance_after_cents: 0 }]);
    insertResults.push([LEDGER_ROW]);

    const { refundCall } = await import('./credit');
    await refundCall(ORG_ID, CALL_ID, 50, 'Call failed before answer');

    expect(mockRecordAudit).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({
        action: 'credit.refunded',
        subjectId: CALL_ID,
        metadata: expect.objectContaining({ costCents: 50, reason: 'Call failed before answer' }),
      }),
    );
  });

  it('is idempotent — no audit when insert conflicts', async () => {
    selectResults.push([{ balance_after_cents: 0 }]);
    insertResults.push([]); // conflict

    const { refundCall } = await import('./credit');
    await refundCall(ORG_ID, CALL_ID, 50, 'duplicate');

    expect(mockRecordAudit).not.toHaveBeenCalled();
  });
});

// ─── adjust ───────────────────────────────────────────────────────────────────

describe('adjust', () => {
  it('applies a positive delta to the balance', async () => {
    selectResults.push([{ balance_after_cents: 1000 }]); // lockBalance
    insertResults.push([LEDGER_ROW]);

    // Override insert mock to handle adjust's non-onConflict path
    mockTx.insert.mockImplementation(() => ({
      values: vi.fn().mockResolvedValue([LEDGER_ROW]),
    }));

    const { adjust } = await import('./credit');
    await adjust(ORG_ID, USER_ID, 500, 'Bonus credits');

    expect(mockTx.insert).toHaveBeenCalledOnce();
    const valuesCall = mockTx.insert.mock.results[0]?.value.values;
    expect(valuesCall).toHaveBeenCalledWith(
      expect.objectContaining({
        entry_type: 'adjustment',
        delta_cents: 500,
        balance_after_cents: 1500,
        reference_type: 'adjustment',
        description: 'Bonus credits',
      }),
    );
  });

  it('applies a negative delta to the balance', async () => {
    selectResults.push([{ balance_after_cents: 1000 }]);
    mockTx.insert.mockImplementation(() => ({
      values: vi.fn().mockResolvedValue([LEDGER_ROW]),
    }));

    const { adjust } = await import('./credit');
    await adjust(ORG_ID, USER_ID, -200, 'Correction');

    const valuesCall = mockTx.insert.mock.results[0]?.value.values;
    expect(valuesCall).toHaveBeenCalledWith(
      expect.objectContaining({
        delta_cents: -200,
        balance_after_cents: 800,
      }),
    );
  });

  it('records a credit.adjusted audit entry with actorUserId', async () => {
    selectResults.push([{ balance_after_cents: 500 }]);
    mockTx.insert.mockImplementation(() => ({
      values: vi.fn().mockResolvedValue([LEDGER_ROW]),
    }));

    const { adjust } = await import('./credit');
    await adjust(ORG_ID, USER_ID, 100, 'Test adjustment');

    expect(mockRecordAudit).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({
        action: 'credit.adjusted',
        actorUserId: USER_ID,
        actorType: 'user',
        metadata: expect.objectContaining({ deltaCents: 100, reason: 'Test adjustment' }),
      }),
    );
  });

  it('uses a unique reference_id for each adjustment call', async () => {
    const capturedValues: unknown[] = [];

    for (let i = 0; i < 2; i++) {
      selectResults.push([{ balance_after_cents: 1000 }]);
    }

    mockTx.insert.mockImplementation(() => ({
      values: vi.fn((v: unknown) => {
        capturedValues.push(v);
        return Promise.resolve([LEDGER_ROW]);
      }),
    }));

    const { adjust } = await import('./credit');
    await adjust(ORG_ID, USER_ID, 100, 'First');
    await adjust(ORG_ID, USER_ID, 200, 'Second');

    expect(capturedValues).toHaveLength(2);
    const first = capturedValues[0] as { reference_id: string };
    const second = capturedValues[1] as { reference_id: string };
    expect(first.reference_id).toBeDefined();
    expect(second.reference_id).toBeDefined();
    expect(first.reference_id).not.toBe(second.reference_id);
  });

  it('uses withOrgContext', async () => {
    selectResults.push([{ balance_after_cents: 0 }]);
    mockTx.insert.mockImplementation(() => ({
      values: vi.fn().mockResolvedValue([LEDGER_ROW]),
    }));

    const { adjust } = await import('./credit');
    await adjust(ORG_ID, USER_ID, 50, 'Test');

    expect(withOrgContext).toHaveBeenCalledWith(ORG_ID, expect.any(Function));
  });
});

// ─── canAffordCampaign ────────────────────────────────────────────────────────

describe('canAffordCampaign', () => {
  it('returns ok:true when balance equals the estimate exactly', async () => {
    selectResults.push([{ balance_after_cents: 5000 }]); // latest balance
    selectResults.push([]); // topups → none

    const { canAffordCampaign } = await import('./credit');
    const result = await canAffordCampaign(ORG_ID, 5000);

    expect(result).toEqual({ ok: true });
  });

  it('returns ok:true when balance exceeds the estimate', async () => {
    selectResults.push([{ balance_after_cents: 10000 }]);
    selectResults.push([]);

    const { canAffordCampaign } = await import('./credit');
    const result = await canAffordCampaign(ORG_ID, 3000);

    expect(result).toEqual({ ok: true });
  });

  it('returns ok:false with currentCents and requiredCents when balance is insufficient', async () => {
    selectResults.push([{ balance_after_cents: 1000 }]);
    selectResults.push([]);

    const { canAffordCampaign } = await import('./credit');
    const result = await canAffordCampaign(ORG_ID, 5000);

    expect(result).toEqual({ ok: false, currentCents: 1000, requiredCents: 5000 });
  });

  it('returns ok:false when balance is zero', async () => {
    selectResults.push([]); // no ledger entries → balance = 0
    selectResults.push([]);

    const { canAffordCampaign } = await import('./credit');
    const result = await canAffordCampaign(ORG_ID, 100);

    expect(result).toEqual({ ok: false, currentCents: 0, requiredCents: 100 });
  });

  it('returns ok:true when estimate is zero (free campaign)', async () => {
    selectResults.push([{ balance_after_cents: 0 }]);
    selectResults.push([]);

    const { canAffordCampaign } = await import('./credit');
    const result = await canAffordCampaign(ORG_ID, 0);

    expect(result).toEqual({ ok: true });
  });

  it('delegates balance lookup to getBalance via withOrgContext', async () => {
    selectResults.push([{ balance_after_cents: 2000 }]);
    selectResults.push([]);

    const { canAffordCampaign } = await import('./credit');
    await canAffordCampaign(ORG_ID, 1000);

    expect(withOrgContext).toHaveBeenCalledWith(ORG_ID, expect.any(Function));
  });
});
