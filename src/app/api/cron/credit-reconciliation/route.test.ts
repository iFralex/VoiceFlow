import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockWithSystemContext,
  mockSelect,
  mockSelectDistinct,
  mockUpdate,
  mockRecordAudit,
  mockTopUp,
  mockStripeSessionsRetrieve,
  mockStripeInvoicesRetrieve,
  mockEnv,
} = vi.hoisted(() => {
  const mockSelect = vi.fn();
  const mockSelectDistinct = vi.fn();
  const mockUpdate = vi.fn();

  const mockTx = {
    select: mockSelect,
    selectDistinct: mockSelectDistinct,
    update: mockUpdate,
  };

  const mockWithSystemContext = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(mockTx));
  const mockRecordAudit = vi.fn().mockResolvedValue(undefined);
  const mockTopUp = vi.fn().mockResolvedValue(undefined);
  const mockStripeSessionsRetrieve = vi.fn();
  const mockStripeInvoicesRetrieve = vi.fn();
  const mockEnv = { CRON_SECRET: 'test-cron-secret-16chars' };

  return {
    mockWithSystemContext,
    mockSelect,
    mockSelectDistinct,
    mockUpdate,
    mockRecordAudit,
    mockTopUp,
    mockStripeSessionsRetrieve,
    mockStripeInvoicesRetrieve,
    mockEnv,
  };
});

vi.mock('@/lib/db/context', () => ({
  withSystemContext: mockWithSystemContext,
}));

vi.mock('@/lib/db/audit', () => ({
  recordAudit: mockRecordAudit,
}));

vi.mock('@/lib/services/credit', () => ({
  topUp: mockTopUp,
}));

vi.mock('@/lib/stripe/client', () => ({
  stripe: {
    checkout: { sessions: { retrieve: mockStripeSessionsRetrieve } },
    invoices: { retrieve: mockStripeInvoicesRetrieve },
  },
}));

vi.mock('@/lib/env', () => ({
  env: mockEnv,
}));

vi.mock('@/lib/db/schema', () => ({
  payments: {
    id: 'p_id',
    org_id: 'p_org_id',
    stripe_session_id: 'p_stripe_session_id',
    amount_cents: 'p_amount_cents',
    package_id: 'p_package_id',
    status: 'p_status',
    stripe_payment_intent_id: 'p_stripe_payment_intent_id',
    invoice_url: 'p_invoice_url',
    completed_at: 'p_completed_at',
    created_at: 'p_created_at',
  },
  creditLedger: {
    id: 'cl_id',
    org_id: 'cl_org_id',
    delta_cents: 'cl_delta_cents',
    balance_after_cents: 'cl_balance_after_cents',
    created_at: 'cl_created_at',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown) => ({ type: 'eq', col, val }),
  and: (...args: unknown[]) => ({ type: 'and', args }),
  lt: (col: unknown, val: unknown) => ({ type: 'lt', col, val }),
  lte: (col: unknown, val: unknown) => ({ type: 'lte', col, val }),
  gte: (col: unknown, val: unknown) => ({ type: 'gte', col, val }),
  desc: (col: unknown) => ({ type: 'desc', col }),
  sql: Object.assign((strings: TemplateStringsArray) => strings.join(''), { raw: (s: string) => s }),
  sum: (col: unknown) => ({ type: 'sum', col }),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { GET, reconcilePendingPayments, runLedgerSanityCheck } from './route';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ORG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
const PAYMENT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000002';
const PACKAGE_ID = 'cccccccc-cccc-4ccc-8ccc-000000000003';
const SESSION_ID = 'cs_test_session_123';
const PAYMENT_INTENT_ID = 'pi_test_123';
const CRON_SECRET = 'test-cron-secret-16chars';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Builds a select mock that returns `rows` for a simple from/where/then chain. */
function makeSelectMock(rows: unknown[]) {
  const chainEnd = {
    then: (resolve: (v: unknown) => void) => resolve(rows),
    where: vi.fn(() => ({
      then: (resolve: (v: unknown) => void) => resolve(rows),
      orderBy: vi.fn(() => ({
        limit: vi.fn().mockResolvedValue(rows),
      })),
    })),
    orderBy: vi.fn(() => ({
      limit: vi.fn().mockResolvedValue(rows),
    })),
  };
  return vi.fn(() => ({
    from: vi.fn(() => chainEnd),
  }));
}

/** Builds an update mock that resolves undefined (no returning). */
function makeUpdateMock() {
  return vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn().mockResolvedValue(undefined),
    })),
  }));
}

function makeRequest(secret?: string): Request {
  return new Request('http://localhost/api/cron/credit-reconciliation', {
    method: 'GET',
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/cron/credit-reconciliation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockWithSystemContext.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({ select: mockSelect, selectDistinct: mockSelectDistinct, update: mockUpdate }),
    );
    mockTopUp.mockResolvedValue(undefined);
    mockRecordAudit.mockResolvedValue(undefined);
  });

  it('returns 401 when Authorization header is missing', async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('Unauthorized');
  });

  it('returns 401 when CRON_SECRET is not configured', async () => {
    mockEnv.CRON_SECRET = undefined as unknown as string;
    const res = await GET(makeRequest(CRON_SECRET));
    expect(res.status).toBe(401);
    mockEnv.CRON_SECRET = CRON_SECRET;
  });

  it('returns 401 when bearer token does not match CRON_SECRET', async () => {
    const res = await GET(makeRequest('wrong-secret'));
    expect(res.status).toBe(401);
  });

  it('returns 200 with ok:true on valid secret with no stuck payments and no active orgs', async () => {
    // Stuck payments query → empty
    mockSelect.mockReturnValueOnce({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([]),
      })),
    });
    // Active orgs query → empty
    mockSelectDistinct.mockReturnValueOnce({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([]),
      })),
    });

    const res = await GET(makeRequest(CRON_SECRET));
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      pendingPayments: { reconciled: number; errors: number };
      ledgerSanity: { orgsChecked: number; discrepancies: number };
    };
    expect(json.ok).toBe(true);
    expect(json.pendingPayments).toEqual({ reconciled: 0, errors: 0 });
    expect(json.ledgerSanity).toEqual({ orgsChecked: 0, discrepancies: 0 });
  });
});

describe('reconcilePendingPayments', () => {
  const stuckPayment = {
    id: PAYMENT_ID,
    org_id: ORG_ID,
    stripe_session_id: SESSION_ID,
    amount_cents: 29900,
    package_id: PACKAGE_ID,
  };

  beforeEach(() => {
    vi.resetAllMocks();
    mockWithSystemContext.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({ select: mockSelect, selectDistinct: mockSelectDistinct, update: mockUpdate }),
    );
    mockTopUp.mockResolvedValue(undefined);
    mockRecordAudit.mockResolvedValue(undefined);
  });

  it('reconciles a completed Stripe session and credits the ledger', async () => {
    // First withSystemContext call: fetch stuck payments
    mockWithSystemContext.mockImplementationOnce(async (fn) =>
      fn({
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn().mockResolvedValue([stuckPayment]),
          })),
        })),
      }),
    );
    // Second withSystemContext call: update payment + recordAudit
    mockWithSystemContext.mockImplementationOnce(async (fn) =>
      fn({
        update: vi.fn(() => ({
          set: vi.fn(() => ({
            where: vi.fn().mockResolvedValue(undefined),
          })),
        })),
      }),
    );

    mockStripeSessionsRetrieve.mockResolvedValue({
      status: 'complete',
      payment_intent: PAYMENT_INTENT_ID,
      invoice: null,
    });

    const result = await reconcilePendingPayments();

    expect(mockStripeSessionsRetrieve).toHaveBeenCalledWith(SESSION_ID);
    expect(mockTopUp).toHaveBeenCalledWith(
      ORG_ID,
      expect.objectContaining({
        amountCents: 29900,
        packageId: PACKAGE_ID,
        stripePaymentIntentId: PAYMENT_INTENT_ID,
      }),
    );
    expect(result.reconciled).toBe(1);
    expect(result.errors).toBe(0);
  });

  it('marks an expired session as failed', async () => {
    mockWithSystemContext.mockImplementationOnce(async (fn) =>
      fn({
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn().mockResolvedValue([stuckPayment]),
          })),
        })),
      }),
    );
    mockWithSystemContext.mockImplementationOnce(async (fn) =>
      fn({ update: makeUpdateMock() }),
    );

    mockStripeSessionsRetrieve.mockResolvedValue({ status: 'expired' });

    const result = await reconcilePendingPayments();

    expect(mockStripeSessionsRetrieve).toHaveBeenCalledWith(SESSION_ID);
    expect(mockTopUp).not.toHaveBeenCalled();
    expect(result.reconciled).toBe(1);
    expect(result.errors).toBe(0);
  });

  it('skips an open session (still awaiting payment)', async () => {
    mockWithSystemContext.mockImplementationOnce(async (fn) =>
      fn({
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn().mockResolvedValue([stuckPayment]),
          })),
        })),
      }),
    );

    mockStripeSessionsRetrieve.mockResolvedValue({ status: 'open' });

    const result = await reconcilePendingPayments();

    expect(mockTopUp).not.toHaveBeenCalled();
    expect(result.reconciled).toBe(0);
    expect(result.errors).toBe(0);
  });

  it('counts Stripe errors without crashing', async () => {
    mockWithSystemContext.mockImplementationOnce(async (fn) =>
      fn({
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn().mockResolvedValue([stuckPayment]),
          })),
        })),
      }),
    );

    mockStripeSessionsRetrieve.mockRejectedValue(new Error('Stripe API error'));

    const result = await reconcilePendingPayments();

    expect(result.reconciled).toBe(0);
    expect(result.errors).toBe(1);
  });

  it('returns zeros when no stuck payments exist', async () => {
    mockWithSystemContext.mockImplementationOnce(async (fn) =>
      fn({
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn().mockResolvedValue([]),
          })),
        })),
      }),
    );

    const result = await reconcilePendingPayments();

    expect(mockStripeSessionsRetrieve).not.toHaveBeenCalled();
    expect(result.reconciled).toBe(0);
    expect(result.errors).toBe(0);
  });
});

describe('runLedgerSanityCheck', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockWithSystemContext.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({ select: mockSelect, selectDistinct: mockSelectDistinct, update: mockUpdate }),
    );
  });

  it('returns zeros when no orgs have recent ledger activity', async () => {
    // Active orgs → empty
    mockWithSystemContext.mockImplementationOnce(async (fn) =>
      fn({
        selectDistinct: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn().mockResolvedValue([]),
          })),
        })),
      }),
    );

    const result = await runLedgerSanityCheck();

    expect(result.orgsChecked).toBe(0);
    expect(result.discrepancies).toBe(0);
  });

  it('reports no discrepancy when ledger delta matches balance movement', async () => {
    // Active orgs: one org
    mockWithSystemContext.mockImplementationOnce(async (fn) =>
      fn({
        selectDistinct: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn().mockResolvedValue([{ org_id: ORG_ID }]),
          })),
        })),
      }),
    );
    // delta_cents sum for the org in last 24h = +29900
    mockWithSystemContext.mockImplementationOnce(async (fn) =>
      fn({
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn().mockResolvedValue([{ total_delta: '29900' }]),
          })),
        })),
      }),
    );
    // Balance before window = 0
    mockWithSystemContext.mockImplementationOnce(async (fn) =>
      fn({
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              orderBy: vi.fn(() => ({
                limit: vi.fn().mockResolvedValue([]),
              })),
            })),
          })),
        })),
      }),
    );
    // Current balance = 29900
    mockWithSystemContext.mockImplementationOnce(async (fn) =>
      fn({
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              orderBy: vi.fn(() => ({
                limit: vi.fn().mockResolvedValue([{ balance_after_cents: 29900 }]),
              })),
            })),
          })),
        })),
      }),
    );

    const result = await runLedgerSanityCheck();

    expect(result.orgsChecked).toBe(1);
    expect(result.discrepancies).toBe(0);
  });

  it('counts discrepancy when ledger delta does not match balance movement by >€0.10', async () => {
    // Active orgs: one org
    mockWithSystemContext.mockImplementationOnce(async (fn) =>
      fn({
        selectDistinct: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn().mockResolvedValue([{ org_id: ORG_ID }]),
          })),
        })),
      }),
    );
    // delta sum = 29900 (expected from the ledger entries)
    mockWithSystemContext.mockImplementationOnce(async (fn) =>
      fn({
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn().mockResolvedValue([{ total_delta: '29900' }]),
          })),
        })),
      }),
    );
    // Balance before window = 0
    mockWithSystemContext.mockImplementationOnce(async (fn) =>
      fn({
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              orderBy: vi.fn(() => ({
                limit: vi.fn().mockResolvedValue([]),
              })),
            })),
          })),
        })),
      }),
    );
    // Current balance = 29850 → discrepancy of 50 cents (>10 cents threshold)
    mockWithSystemContext.mockImplementationOnce(async (fn) =>
      fn({
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              orderBy: vi.fn(() => ({
                limit: vi.fn().mockResolvedValue([{ balance_after_cents: 29850 }]),
              })),
            })),
          })),
        })),
      }),
    );

    const result = await runLedgerSanityCheck();

    expect(result.orgsChecked).toBe(1);
    expect(result.discrepancies).toBe(1);
  });

  it('does not count discrepancy <=€0.10 as alert', async () => {
    // Active orgs: one org
    mockWithSystemContext.mockImplementationOnce(async (fn) =>
      fn({
        selectDistinct: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn().mockResolvedValue([{ org_id: ORG_ID }]),
          })),
        })),
      }),
    );
    // delta sum = 29900
    mockWithSystemContext.mockImplementationOnce(async (fn) =>
      fn({
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn().mockResolvedValue([{ total_delta: '29900' }]),
          })),
        })),
      }),
    );
    // Balance before window = 0
    mockWithSystemContext.mockImplementationOnce(async (fn) =>
      fn({
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              orderBy: vi.fn(() => ({
                limit: vi.fn().mockResolvedValue([]),
              })),
            })),
          })),
        })),
      }),
    );
    // Current balance = 29895 → discrepancy of 5 cents (≤10 cents — INFO only, not counted)
    mockWithSystemContext.mockImplementationOnce(async (fn) =>
      fn({
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              orderBy: vi.fn(() => ({
                limit: vi.fn().mockResolvedValue([{ balance_after_cents: 29895 }]),
              })),
            })),
          })),
        })),
      }),
    );

    const result = await runLedgerSanityCheck();

    expect(result.orgsChecked).toBe(1);
    expect(result.discrepancies).toBe(0);
  });
});
