import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('next/cache', () => ({
  // Bypass caching in unit tests — call through to the underlying loader on every call.
  unstable_cache: <Args extends unknown[], R>(fn: (...args: Args) => Promise<R>) => fn,
}));

vi.mock('@/lib/env', () => ({
  env: { CREDIT_SOFT_THRESHOLD_MINUTES: 30 },
}));

const mockGetBalance = vi.fn();
vi.mock('@/lib/services/credit', () => ({
  getBalance: (...args: unknown[]) => mockGetBalance(...args),
}));

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
  withOrgContext: vi.fn((_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(mockTx)),
  withSystemContext: vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn(mockTx)),
}));

const { withOrgContext } = await import('@/lib/db/context');

beforeEach(() => {
  vi.clearAllMocks();
  selectResults = [];
  resetMockTx();
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ORG_ID = 'org-1';

/**
 * The service kicks off eight parallel sub-tasks inside a single transaction.
 * Each sub-task issues its first `tx.select()` synchronously before yielding,
 * so the FIFO order of select() invocations is:
 *   1. KPI calls aggregate              (kpiAggregateInRange — first select)
 *   2. per-day outcome counts            (perDayOutcomeCounts)
 *   3. per-day sparklines (14 d)         (perDaySparklines)
 *   4. active campaigns                  (activeCampaignsRows)
 *   5. recent appointments               (recentAppointmentsRows)
 *   6. cooling phones                    (coolingPhonesForOrg)
 *   7. disclosure failure flags          (disclosureFailureFlags)
 *   8. any campaign exists               (anyCampaignExists)
 *   9. KPI appointments aggregate        (kpiAggregateInRange — second select,
 *                                         issued after its first await resolves)
 */
function pushDefaultSelectResults(opts: {
  callsCompleted?: number;
  qualifiedLeads?: number;
  appointmentsBooked?: number;
  trendRows?: unknown[];
  sparklineRows?: unknown[];
  activeCampaigns?: unknown[];
  recentAppointments?: unknown[];
  coolingCount?: number;
  disclosureFailureCount?: number;
  hasCampaign?: boolean;
} = {}) {
  selectResults.push([{ completed: opts.callsCompleted ?? 0, qualified: opts.qualifiedLeads ?? 0 }]);
  selectResults.push(opts.trendRows ?? []);
  selectResults.push(opts.sparklineRows ?? []);
  selectResults.push(opts.activeCampaigns ?? []);
  selectResults.push(opts.recentAppointments ?? []);
  selectResults.push([{ count: opts.coolingCount ?? 0 }]);
  selectResults.push([{ count: opts.disclosureFailureCount ?? 0 }]);
  selectResults.push(opts.hasCampaign ? [{ id: 'c1' }] : []);
  selectResults.push([{ booked: opts.appointmentsBooked ?? 0 }]);
}

// ─── getDashboardData ─────────────────────────────────────────────────────────

describe('getDashboardData', () => {
  it('returns the requested period range and label', async () => {
    pushDefaultSelectResults();
    mockGetBalance.mockResolvedValue({ balanceCents: 0, remainingMinutes: 0 });

    const { getDashboardData } = await import('./dashboard');
    const data = await getDashboardData(ORG_ID, '7d');

    expect(data.period.label).toBe('7d');
    expect(data.period.start).toBeInstanceOf(Date);
    expect(data.period.end).toBeInstanceOf(Date);
    expect(data.period.end.getTime()).toBeGreaterThan(data.period.start.getTime());
  });

  it('runs queries inside withOrgContext', async () => {
    pushDefaultSelectResults();
    mockGetBalance.mockResolvedValue({ balanceCents: 0, remainingMinutes: 0 });

    const { getDashboardData } = await import('./dashboard');
    await getDashboardData(ORG_ID, 'today');

    expect(withOrgContext).toHaveBeenCalledWith(ORG_ID, expect.any(Function));
  });

  it('maps KPI aggregates into the response', async () => {
    pushDefaultSelectResults({
      callsCompleted: 42,
      qualifiedLeads: 17,
      appointmentsBooked: 5,
    });
    mockGetBalance.mockResolvedValue({ balanceCents: 12345, remainingMinutes: 200 });

    const { getDashboardData } = await import('./dashboard');
    const data = await getDashboardData(ORG_ID, '7d');

    expect(data.kpis.callsCompleted).toBe(42);
    expect(data.kpis.qualifiedLeads).toBe(17);
    expect(data.kpis.appointmentsBooked).toBe(5);
    expect(data.kpis.creditBalance.cents).toBe(12345);
    expect(data.kpis.creditBalance.minutes).toBe(200);
  });

  it('builds the trend chart with one entry per day in the range, filling missing days with zeros', async () => {
    pushDefaultSelectResults({ trendRows: [] });
    mockGetBalance.mockResolvedValue({ balanceCents: 0, remainingMinutes: 0 });

    const { getDashboardData } = await import('./dashboard');
    const data = await getDashboardData(ORG_ID, '7d');

    // 7d period spans 7 calendar days.
    expect(data.trends).toHaveLength(7);
    expect(data.trends.every((t) => t.completed === 0 && t.appointmentBooked === 0)).toBe(true);
    // Dates should be strictly increasing YYYY-MM-DD strings.
    const sorted = [...data.trends].sort((a, b) => a.date.localeCompare(b.date));
    expect(sorted.map((t) => t.date)).toEqual(data.trends.map((t) => t.date));
  });

  it('overlays per-day outcome counts onto the trend chart', async () => {
    const today = formatYmd(new Date());
    pushDefaultSelectResults({
      trendRows: [
        {
          date: today,
          completed: 3,
          appointmentBooked: 1,
          notInterested: 1,
          voicemail: 0,
          failed: 0,
        },
      ],
    });
    mockGetBalance.mockResolvedValue({ balanceCents: 0, remainingMinutes: 0 });

    const { getDashboardData } = await import('./dashboard');
    const data = await getDashboardData(ORG_ID, '7d');

    const todayPoint = data.trends.find((t) => t.date === today);
    expect(todayPoint).toBeDefined();
    expect(todayPoint?.completed).toBe(3);
    expect(todayPoint?.appointmentBooked).toBe(1);
    expect(todayPoint?.notInterested).toBe(1);
  });

  it('builds 14-day sparklines by stitching per-day rows over a 14-entry chronological array', async () => {
    const today = formatYmd(new Date());
    pushDefaultSelectResults({
      sparklineRows: [
        { date: today, completed: 7, qualifiedLeads: 4, appointmentBooked: 2 },
      ],
    });
    mockGetBalance.mockResolvedValue({ balanceCents: 0, remainingMinutes: 0 });

    const { getDashboardData } = await import('./dashboard');
    const data = await getDashboardData(ORG_ID, '7d');

    expect(data.sparklines.callsCompleted).toHaveLength(14);
    expect(data.sparklines.qualifiedLeads).toHaveLength(14);
    expect(data.sparklines.appointmentsBooked).toHaveLength(14);
    expect(data.sparklines.callsCompleted[13]).toBe(7);
    expect(data.sparklines.qualifiedLeads[13]).toBe(4);
    expect(data.sparklines.appointmentsBooked[13]).toBe(2);
  });

  it('emits a low_credit alert when remaining minutes are below the soft threshold', async () => {
    pushDefaultSelectResults();
    mockGetBalance.mockResolvedValue({ balanceCents: 100, remainingMinutes: 5 });

    const { getDashboardData } = await import('./dashboard');
    const data = await getDashboardData(ORG_ID, 'today');

    const alert = data.alerts.find((a) => a.kind === 'low_credit');
    expect(alert).toBeDefined();
    if (alert?.kind === 'low_credit') {
      expect(alert.balanceMinutes).toBe(5);
    }
  });

  it('does not emit a low_credit alert when remaining minutes is zero (no packages purchased yet)', async () => {
    pushDefaultSelectResults();
    mockGetBalance.mockResolvedValue({ balanceCents: 0, remainingMinutes: 0 });

    const { getDashboardData } = await import('./dashboard');
    const data = await getDashboardData(ORG_ID, 'today');

    expect(data.alerts.some((a) => a.kind === 'low_credit')).toBe(false);
  });

  it('emits cli_cooldown and disclosure_failure alerts when those counts are positive', async () => {
    pushDefaultSelectResults({ coolingCount: 2, disclosureFailureCount: 3 });
    mockGetBalance.mockResolvedValue({ balanceCents: 50000, remainingMinutes: 1000 });

    const { getDashboardData } = await import('./dashboard');
    const data = await getDashboardData(ORG_ID, 'today');

    const cli = data.alerts.find((a) => a.kind === 'cli_cooldown');
    const disc = data.alerts.find((a) => a.kind === 'disclosure_failure');
    expect(cli).toBeDefined();
    expect(disc).toBeDefined();
    if (cli?.kind === 'cli_cooldown') expect(cli.count).toBe(2);
    if (disc?.kind === 'disclosure_failure') expect(disc.count).toBe(3);
  });

  it('shapes active campaigns with default zeros when campaign_stats has no row yet', async () => {
    pushDefaultSelectResults({
      activeCampaigns: [
        {
          id: 'c1',
          name: 'Riattivazione',
          status: 'running',
          total: null,
          completed: null,
          appointmentsBooked: null,
        },
      ],
    });
    mockGetBalance.mockResolvedValue({ balanceCents: 0, remainingMinutes: 0 });

    const { getDashboardData } = await import('./dashboard');
    const data = await getDashboardData(ORG_ID, 'today');

    expect(data.activeCampaigns).toEqual([
      {
        id: 'c1',
        name: 'Riattivazione',
        status: 'running',
        total: 0,
        completed: 0,
        appointmentsBooked: 0,
      },
    ]);
  });

  it('builds recent appointments with full contact name and ISO scheduledAt', async () => {
    const scheduled = new Date('2026-05-10T15:00:00.000Z');
    pushDefaultSelectResults({
      recentAppointments: [
        {
          id: 'a1',
          scheduledAt: scheduled,
          contactFirst: 'Mario',
          contactLast: 'Rossi',
          contactPhone: '+390000000000',
          campaignId: 'c1',
          campaignName: 'Riattivazione',
        },
      ],
    });
    mockGetBalance.mockResolvedValue({ balanceCents: 0, remainingMinutes: 0 });

    const { getDashboardData } = await import('./dashboard');
    const data = await getDashboardData(ORG_ID, 'today');

    expect(data.recentAppointments).toEqual([
      {
        id: 'a1',
        contactName: 'Mario Rossi',
        scheduledAt: scheduled.toISOString(),
        campaignId: 'c1',
        campaignName: 'Riattivazione',
      },
    ]);
  });

  it('falls back to the contact phone when first/last name are absent', async () => {
    pushDefaultSelectResults({
      recentAppointments: [
        {
          id: 'a1',
          scheduledAt: new Date(),
          contactFirst: null,
          contactLast: null,
          contactPhone: '+390000000000',
          campaignId: null,
          campaignName: null,
        },
      ],
    });
    mockGetBalance.mockResolvedValue({ balanceCents: 0, remainingMinutes: 0 });

    const { getDashboardData } = await import('./dashboard');
    const data = await getDashboardData(ORG_ID, 'today');

    expect(data.recentAppointments[0]?.contactName).toBe('+390000000000');
    expect(data.recentAppointments[0]?.campaignName).toBe('');
    expect(data.recentAppointments[0]?.campaignId).toBe('');
  });

  it('reflects whether any campaign exists for empty-state polish', async () => {
    pushDefaultSelectResults({ hasCampaign: true });
    mockGetBalance.mockResolvedValue({ balanceCents: 0, remainingMinutes: 0 });

    const { getDashboardData } = await import('./dashboard');
    const data = await getDashboardData(ORG_ID, 'today');

    expect(data.hasAnyCampaign).toBe(true);
  });
});

function formatYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
