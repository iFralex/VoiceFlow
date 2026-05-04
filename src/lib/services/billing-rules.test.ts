import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

let selectResults: unknown[][] = [];

function makeSelectChain(result: unknown[]) {
  const chain: Record<string, () => typeof chain> & { then?: unknown } = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    for: () => chain,
  };
  (chain as Record<string, unknown>).then = (
    resolve: (v: unknown) => unknown,
    reject?: (e: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

const mockTx = {
  select: vi.fn(),
};

function resetMockTx() {
  mockTx.select.mockImplementation(() => {
    const result = selectResults.shift() ?? [];
    return makeSelectChain(result);
  });
}

vi.mock('@/lib/db/context', () => ({
  withOrgContext: vi.fn((_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(mockTx)),
}));

const { withOrgContext } = await import('@/lib/db/context');

beforeEach(() => {
  vi.clearAllMocks();
  selectResults = [];
  resetMockTx();
});

const ORG_ID = 'org-1';

// ─── computeCallCost ──────────────────────────────────────────────────────────

describe('computeCallCost', () => {
  it('returns zero cost for calls under minimum billable duration (< 6s)', async () => {
    const { computeCallCost } = await import('./billing-rules');

    expect(computeCallCost({ durationSeconds: 0, perMinuteCents: 500 })).toEqual({
      billableSeconds: 0,
      costCents: 0,
    });

    expect(computeCallCost({ durationSeconds: 1, perMinuteCents: 500 })).toEqual({
      billableSeconds: 0,
      costCents: 0,
    });

    expect(computeCallCost({ durationSeconds: 5, perMinuteCents: 500 })).toEqual({
      billableSeconds: 0,
      costCents: 0,
    });

    expect(computeCallCost({ durationSeconds: 5.9, perMinuteCents: 500 })).toEqual({
      billableSeconds: 0,
      costCents: 0,
    });
  });

  it('bills exactly 6 seconds for a 6-second call', async () => {
    const { computeCallCost } = await import('./billing-rules');
    const result = computeCallCost({ durationSeconds: 6, perMinuteCents: 600 });
    // billable = ceil(6/6) * 6 = 6s
    // cost = ceil(6/60 * 600) = ceil(60) = 60 cents
    expect(result.billableSeconds).toBe(6);
    expect(result.costCents).toBe(60);
  });

  it('rounds a 7-second call UP to 12 seconds (next 6s boundary)', async () => {
    const { computeCallCost } = await import('./billing-rules');
    const result = computeCallCost({ durationSeconds: 7, perMinuteCents: 600 });
    // billable = ceil(7/6) * 6 = 2 * 6 = 12s
    // cost = ceil(12/60 * 600) = ceil(120) = 120 cents
    expect(result.billableSeconds).toBe(12);
    expect(result.costCents).toBe(120);
  });

  it('bills exactly 60 seconds for a full-minute call', async () => {
    const { computeCallCost } = await import('./billing-rules');
    const result = computeCallCost({ durationSeconds: 60, perMinuteCents: 427 });
    // billable = ceil(60/6) * 6 = 10 * 6 = 60s
    // cost = ceil(60/60 * 427) = ceil(427) = 427 cents
    expect(result.billableSeconds).toBe(60);
    expect(result.costCents).toBe(427);
  });

  it('rounds up cost to nearest cent for a partial minute', async () => {
    const { computeCallCost } = await import('./billing-rules');
    const result = computeCallCost({ durationSeconds: 30, perMinuteCents: 427 });
    // billable = ceil(30/6) * 6 = 5 * 6 = 30s
    // cost = ceil(30/60 * 427) = ceil(213.5) = 214 cents
    expect(result.billableSeconds).toBe(30);
    expect(result.costCents).toBe(214);
  });

  it('rounds duration up and cost up independently', async () => {
    const { computeCallCost } = await import('./billing-rules');
    const result = computeCallCost({ durationSeconds: 61, perMinuteCents: 427 });
    // billable = ceil(61/6) * 6 = 11 * 6 = 66s
    // cost = ceil(66/60 * 427) = ceil(469.7) = 470 cents
    expect(result.billableSeconds).toBe(66);
    expect(result.costCents).toBe(470);
  });

  it('handles exactly on a 6s boundary above minimum', async () => {
    const { computeCallCost } = await import('./billing-rules');
    const result = computeCallCost({ durationSeconds: 12, perMinuteCents: 300 });
    // billable = ceil(12/6) * 6 = 12s
    // cost = ceil(12/60 * 300) = ceil(60) = 60 cents
    expect(result.billableSeconds).toBe(12);
    expect(result.costCents).toBe(60);
  });

  it('handles long calls correctly (180 seconds = 3 minutes)', async () => {
    const { computeCallCost } = await import('./billing-rules');
    const result = computeCallCost({ durationSeconds: 180, perMinuteCents: 427 });
    // billable = ceil(180/6) * 6 = 30 * 6 = 180s
    // cost = ceil(180/60 * 427) = ceil(1281) = 1281 cents
    expect(result.billableSeconds).toBe(180);
    expect(result.costCents).toBe(1281);
  });
});

// ─── computePerMinuteCents ────────────────────────────────────────────────────

describe('computePerMinuteCents', () => {
  it('returns null when org has no topup entries', async () => {
    selectResults.push([]); // no topup entries

    const { computePerMinuteCents } = await import('./billing-rules');
    const result = await computePerMinuteCents(ORG_ID);

    expect(result).toBeNull();
    expect(withOrgContext).toHaveBeenCalledWith(ORG_ID, expect.any(Function));
  });

  it('returns the per-minute rate for a single untouched pool', async () => {
    // One Starter pool: 2990 cents for 700 min → 4.271... c/min
    // No charges yet
    selectResults.push([{ delta_cents: 2990, reference_id: 'pi_starter' }]); // topup entries
    selectResults.push([{ package_id: 'pkg-starter' }]); // payment row
    selectResults.push([{ included_minutes: 700 }]); // credit package
    selectResults.push([{ total: '0' }]); // no charges

    const { computePerMinuteCents } = await import('./billing-rules');
    const result = await computePerMinuteCents(ORG_ID);

    // 2990 / 700 ≈ 4.271...
    expect(result).toBeCloseTo(2990 / 700, 5);
  });

  it('returns the same rate for a partially consumed single pool', async () => {
    // Pool: 2990 cents for 700 min → 4.271 c/min
    // 1000 cents consumed → 1990 cents remaining → still same rate
    selectResults.push([{ delta_cents: 2990, reference_id: 'pi_starter' }]);
    selectResults.push([{ package_id: 'pkg-starter' }]);
    selectResults.push([{ included_minutes: 700 }]);
    selectResults.push([{ total: '1000' }]); // 1000 cents consumed

    const { computePerMinuteCents } = await import('./billing-rules');
    const result = await computePerMinuteCents(ORG_ID);

    // Rate stays the same (2990/700) even when partially consumed
    expect(result).toBeCloseTo(2990 / 700, 5);
  });

  it('returns null when single pool is fully depleted', async () => {
    // Pool: 2990 cents for 700 min — all consumed
    selectResults.push([{ delta_cents: 2990, reference_id: 'pi_starter' }]);
    selectResults.push([{ package_id: 'pkg-starter' }]);
    selectResults.push([{ included_minutes: 700 }]);
    selectResults.push([{ total: '2990' }]); // fully consumed

    const { computePerMinuteCents } = await import('./billing-rules');
    const result = await computePerMinuteCents(ORG_ID);

    expect(result).toBeNull();
  });

  it('depletes oldest pool first (FIFO) and uses next pool rate', async () => {
    // Pool A (older): 990 cents for 200 min → 4.95 c/min
    // Pool B (newer): 2990 cents for 700 min → 4.271 c/min
    // Consumed: 990 cents → Pool A fully depleted, Pool B untouched
    selectResults.push([
      { delta_cents: 990, reference_id: 'pi_a' },
      { delta_cents: 2990, reference_id: 'pi_b' },
    ]); // topup entries (A first)
    selectResults.push([{ package_id: 'pkg-a' }]); // payment for A
    selectResults.push([{ included_minutes: 200 }]); // package A
    selectResults.push([{ package_id: 'pkg-b' }]); // payment for B
    selectResults.push([{ included_minutes: 700 }]); // package B
    selectResults.push([{ total: '990' }]); // exactly pool A consumed

    const { computePerMinuteCents } = await import('./billing-rules');
    const result = await computePerMinuteCents(ORG_ID);

    // Only Pool B remaining: 2990/700 ≈ 4.271
    expect(result).toBeCloseTo(2990 / 700, 5);
  });

  it('computes weighted average over two partially-available pools', async () => {
    // Pool A: 990 cents for 200 min → 4.95 c/min
    // Pool B: 2990 cents for 700 min → 4.271 c/min
    // Consumed: 400 cents → Pool A partially consumed (590 cents / 119.19 min remaining)
    // Pool B: fully unconsumed (2990 cents / 700 min)
    selectResults.push([
      { delta_cents: 990, reference_id: 'pi_a' },
      { delta_cents: 2990, reference_id: 'pi_b' },
    ]);
    selectResults.push([{ package_id: 'pkg-a' }]);
    selectResults.push([{ included_minutes: 200 }]);
    selectResults.push([{ package_id: 'pkg-b' }]);
    selectResults.push([{ included_minutes: 700 }]);
    selectResults.push([{ total: '400' }]); // 400 consumed from pool A

    const { computePerMinuteCents } = await import('./billing-rules');
    const result = await computePerMinuteCents(ORG_ID);

    // Pool A: 990-400=590 cents remaining, rate=990/200=4.95, min=590/4.95=119.19
    // Pool B: 2990 cents, 700 min
    // total unconsumed cents = 590 + 2990 = 3580
    // total unconsumed min = 119.19 + 700 = 819.19
    // weighted avg = 3580 / 819.19 ≈ 4.370
    const rateA = 990 / 200;
    const unconsumedCentsA = 990 - 400;
    const unconsumedMinA = unconsumedCentsA / rateA;
    const rateB = 2990 / 700;
    const unconsumedCentsB = 2990;
    const unconsumedMinB = unconsumedCentsB / rateB;
    const expectedRate =
      (unconsumedCentsA + unconsumedCentsB) / (unconsumedMinA + unconsumedMinB);

    expect(result).toBeCloseTo(expectedRate, 5);
  });

  it('returns null when no package is found for a topup entry', async () => {
    selectResults.push([{ delta_cents: 2990, reference_id: 'pi_unknown' }]); // topup
    selectResults.push([]); // no payment found
    selectResults.push([{ total: '0' }]); // no charges

    const { computePerMinuteCents } = await import('./billing-rules');
    const result = await computePerMinuteCents(ORG_ID);

    // pools array will be empty because payment not found → null
    expect(result).toBeNull();
  });

  it('skips topup entries with no reference_id', async () => {
    selectResults.push([{ delta_cents: 2990, reference_id: null }]); // topup without ref
    selectResults.push([{ total: '0' }]); // no charges

    const { computePerMinuteCents } = await import('./billing-rules');
    const result = await computePerMinuteCents(ORG_ID);

    expect(result).toBeNull();
  });
});
