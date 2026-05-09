import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── DB mock ─────────────────────────────────────────────────────────────────

let selectResults: unknown[][] = [];

function makeSelectChain(result: unknown[]) {
  const chain: Record<string, () => typeof chain> & { then?: unknown } = {
    from: () => chain,
    where: () => chain,
    leftJoin: () => chain,
    innerJoin: () => chain,
    groupBy: () => chain,
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
  execute: vi.fn().mockResolvedValue(undefined),
};

function resetMockTx() {
  mockTx.select.mockImplementation(() => {
    const result = selectResults.shift() ?? [];
    return makeSelectChain(result);
  });
}

vi.mock('@/lib/db/context', () => ({
  withOrgContext: vi.fn(
    (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(mockTx),
  ),
  withSystemContext: vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn(mockTx)),
}));

beforeEach(() => {
  vi.clearAllMocks();
  selectResults = [];
  resetMockTx();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('getCampaignLiveSnapshot', () => {
  // Promise.all kicks off three queries in order. The first select() inside
  // each is fired synchronously: status counts, then campaign_stats, then
  // recent calls.
  function pushDefaultResults(opts: {
    statusCounts?: { status: string; cnt: number }[];
    stats?: { appointmentsBooked: number; costCents: number } | null;
    recent?: unknown[];
  }) {
    selectResults.push(opts.statusCounts ?? []);
    selectResults.push(
      opts.stats === null || opts.stats === undefined
        ? []
        : [{ appointmentsBooked: opts.stats.appointmentsBooked, costCents: opts.stats.costCents }],
    );
    selectResults.push(opts.recent ?? []);
  }

  it('aggregates total/completed/in_progress counts from status rows', async () => {
    pushDefaultResults({
      statusCounts: [
        { status: 'pending', cnt: 5 },
        { status: 'dialing', cnt: 2 },
        { status: 'in_progress', cnt: 3 },
        { status: 'completed', cnt: 10 },
        { status: 'failed', cnt: 1 },
      ],
      stats: { appointmentsBooked: 4, costCents: 2500 },
    });

    const { getCampaignLiveSnapshot } = await import('./campaign-live');
    const snap = await getCampaignLiveSnapshot('org-1', 'camp-1');

    expect(snap.totalCalls).toBe(21);
    expect(snap.completedCalls).toBe(11); // completed + failed (terminal)
    expect(snap.inProgressCalls).toBe(5); // dialing + in_progress
    expect(snap.appointmentsBooked).toBe(4);
    expect(snap.costCents).toBe(2500);
  });

  it('falls back to zeros when campaign_stats row missing', async () => {
    pushDefaultResults({
      statusCounts: [{ status: 'pending', cnt: 1 }],
      stats: null,
    });

    const { getCampaignLiveSnapshot } = await import('./campaign-live');
    const snap = await getCampaignLiveSnapshot('org-1', 'camp-1');

    expect(snap.appointmentsBooked).toBe(0);
    expect(snap.costCents).toBe(0);
  });

  it('serialises recent calls and joins contact names', async () => {
    pushDefaultResults({
      statusCounts: [],
      stats: { appointmentsBooked: 0, costCents: 0 },
      recent: [
        {
          id: 'call-1',
          status: 'in_progress',
          outcome: null,
          startedAt: new Date('2026-05-09T10:00:00Z'),
          endedAt: null,
          costCents: null,
          billableSeconds: null,
          firstName: 'Mario',
          lastName: 'Rossi',
          phoneE164: '+393331234567',
        },
        {
          id: 'call-2',
          status: 'completed',
          outcome: 'appointment_booked',
          startedAt: new Date('2026-05-09T09:00:00Z'),
          endedAt: new Date('2026-05-09T09:02:30Z'),
          costCents: 50,
          billableSeconds: 150,
          firstName: null,
          lastName: null,
          phoneE164: '+393339999999',
        },
      ],
    });

    const { getCampaignLiveSnapshot } = await import('./campaign-live');
    const snap = await getCampaignLiveSnapshot('org-1', 'camp-1');

    expect(snap.recentCalls).toHaveLength(2);
    expect(snap.recentCalls[0]).toMatchObject({
      id: 'call-1',
      contactName: 'Mario Rossi',
      phoneE164: '+393331234567',
      status: 'in_progress',
      startedAtIso: '2026-05-09T10:00:00.000Z',
      endedAtIso: null,
    });
    expect(snap.recentCalls[1]).toMatchObject({
      id: 'call-2',
      contactName: '+393339999999', // falls back to phone when no name
      outcome: 'appointment_booked',
      costCents: 50,
      billableSeconds: 150,
    });
  });
});
