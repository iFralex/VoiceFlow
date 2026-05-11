/**
 * Unit tests for operations-dashboard service — plan 14 task 18.
 *
 * DB context is mocked so tests verify the data-aggregation logic (call volume
 * grouping, CLI health tallying, correct zero-coalescing) without Postgres.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── mock db/context ──────────────────────────────────────────────────────────

type TxFn<T> = (tx: typeof mockTx) => Promise<T>;

vi.mock('@/lib/db/context', () => ({
  withSystemContext: vi.fn((fn: TxFn<unknown>) => fn(mockTx)),
}));

// ── mock db/schema ───────────────────────────────────────────────────────────

vi.mock('@/lib/db/schema', () => ({
  organizations: { deleted_at: {} },
  campaigns: { status: {} },
  creditLedger: { entry_type: {}, created_at: {}, delta_cents: {} },
  calls: { status: {}, outcome: {}, created_at: {} },
  phoneNumbers: { status: {} },
  payments: { status: {}, created_at: {}, amount_cents: {} },
  webhookDeliveries: { delivered_at: {}, error: {}, status_code: {} },
  auditLog: { action: {}, created_at: {} },
}));

// ── mock drizzle-orm ──────────────────────────────────────────────────────────

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ and: args })),
  or: vi.fn((...args: unknown[]) => ({ or: args })),
  eq: vi.fn((col: unknown, val: unknown) => ({ eq: [col, val] })),
  gte: vi.fn((col: unknown, val: unknown) => ({ gte: [col, val] })),
  inArray: vi.fn((col: unknown, vals: unknown[]) => ({ inArray: [col, vals] })),
  isNull: vi.fn((col: unknown) => ({ isNull: col })),
  isNotNull: vi.fn((col: unknown) => ({ isNotNull: col })),
  count: vi.fn(() => 'COUNT(*)'),
  sql: Object.assign(vi.fn((strings: TemplateStringsArray) => strings[0]), { raw: vi.fn() }),
}));

// ── shared mock tx state ──────────────────────────────────────────────────────

type SelectResult = Record<string, unknown>[];

let _queryResults: SelectResult[] = [];
let _queryIndex = 0;

function nextResult(): SelectResult {
  return _queryResults[_queryIndex++] ?? [];
}

const mockGroupBy = vi.fn(() => Promise.resolve(nextResult()));
const mockWhere = vi.fn(() => ({ groupBy: mockGroupBy, then: (fn: (v: SelectResult) => unknown) => Promise.resolve(nextResult()).then(fn) }));
const mockFrom = vi.fn(() => ({ where: mockWhere, groupBy: mockGroupBy }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));

const mockTx = {
  select: mockSelect,
};

beforeEach(() => {
  _queryResults = [];
  _queryIndex = 0;
  vi.clearAllMocks();
  mockSelect.mockReturnValue({ from: mockFrom });
  mockFrom.mockReturnValue({ where: mockWhere, groupBy: mockGroupBy });
  mockWhere.mockImplementation(() => ({
    groupBy: mockGroupBy,
    then: (fn: (v: SelectResult) => unknown) => Promise.resolve(nextResult()).then(fn),
  }));
  mockGroupBy.mockImplementation(() => Promise.resolve(nextResult()));
});

import { getOperationsDashboardData } from './operations-dashboard';

// ── helpers ───────────────────────────────────────────────────────────────────

function setQuerySequence(results: SelectResult[]): void {
  _queryResults = results;
  _queryIndex = 0;
}

// ── tests ──────────────────────────────────────────────────────────────────────

describe('getOperationsDashboardData', () => {
  it('returns zero values when all queries return empty', async () => {
    setQuerySequence([
      [{ n: 0 }],          // active orgs
      [{ n: 0 }],          // active campaigns
      [{ cents: '0' }],    // mrr 30d
      [{ cents: '0' }],    // credit 24h
      [],                  // call rows (grouped)
      [],                  // cli rows (grouped)
      [{ cents: '0' }],    // stripe volume
      [{ n: 0 }],          // failed webhooks
      [{ n: 0 }],          // gdpr requests
    ]);

    const data = await getOperationsDashboardData();

    expect(data.activeOrgsCount).toBe(0);
    expect(data.activeCampaignsCount).toBe(0);
    expect(data.mrrEquivalentCents).toBe(0);
    expect(data.credit24hCents).toBe(0);
    expect(data.callVolume24h.total).toBe(0);
    expect(data.callVolume24h.byOutcome).toEqual({});
    expect(data.callVolume24h.byStatus).toEqual({});
    expect(data.cliPoolHealth).toEqual({ active: 0, cooling_down: 0, retired: 0 });
    expect(data.stripeVolumeLast30dCents).toBe(0);
    expect(data.failedWebhookDeliveries24h).toBe(0);
    expect(data.gdprRequestsLast30d).toBe(0);
    expect(data.generatedAt).toBeInstanceOf(Date);
  });

  it('aggregates call volume by status and outcome correctly', async () => {
    setQuerySequence([
      [{ n: 5 }],
      [{ n: 2 }],
      [{ cents: '1000' }],
      [{ cents: '100' }],
      [
        { status: 'completed', outcome: 'interested', cnt: 10 },
        { status: 'completed', outcome: 'not_interested', cnt: 5 },
        { status: 'failed', outcome: null, cnt: 3 },
        { status: 'no_answer', outcome: null, cnt: 2 },
      ],
      [],
      [{ cents: '5000' }],
      [{ n: 1 }],
      [{ n: 0 }],
    ]);

    const data = await getOperationsDashboardData();

    expect(data.callVolume24h.total).toBe(20);
    expect(data.callVolume24h.byStatus).toEqual({
      completed: 15,
      failed: 3,
      no_answer: 2,
    });
    expect(data.callVolume24h.byOutcome).toEqual({
      interested: 10,
      not_interested: 5,
    });
  });

  it('tallies CLI pool health by status', async () => {
    setQuerySequence([
      [{ n: 3 }],
      [{ n: 1 }],
      [{ cents: '2000' }],
      [{ cents: '200' }],
      [],
      [
        { status: 'active', cnt: 8 },
        { status: 'cooling_down', cnt: 2 },
        { status: 'retired', cnt: 1 },
      ],
      [{ cents: '0' }],
      [{ n: 0 }],
      [{ n: 0 }],
    ]);

    const data = await getOperationsDashboardData();

    expect(data.cliPoolHealth).toEqual({ active: 8, cooling_down: 2, retired: 1 });
  });

  it('converts string cents to numbers', async () => {
    setQuerySequence([
      [{ n: '10' }],
      [{ n: '3' }],
      [{ cents: '999999' }],
      [{ cents: '12345' }],
      [],
      [],
      [{ cents: '500000' }],
      [{ n: '7' }],
      [{ n: '2' }],
    ]);

    const data = await getOperationsDashboardData();

    expect(data.activeOrgsCount).toBe(10);
    expect(data.activeCampaignsCount).toBe(3);
    expect(data.mrrEquivalentCents).toBe(999999);
    expect(data.credit24hCents).toBe(12345);
    expect(data.stripeVolumeLast30dCents).toBe(500000);
    expect(data.failedWebhookDeliveries24h).toBe(7);
    expect(data.gdprRequestsLast30d).toBe(2);
  });
});
