import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn(async () => undefined),
}));

vi.mock('@/lib/db/context', () => ({
  withOrgContext: vi.fn(
    async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn({}),
  ),
  withSystemContext: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
}));

vi.mock('@/lib/db/audit', () => ({
  recordAudit: vi.fn(async () => undefined),
}));

vi.mock('@/lib/env', () => ({
  env: {
    NEXT_PUBLIC_APP_URL: 'https://app.example.com',
  },
}));

import {
  buildDailyReportData,
  computeYesterdayRange,
  type DailyReportData,
  type DailyReportRange,
  type DailyReportRecipient,
  getDailyReportRecipients,
  runDailyReport,
} from './daily-report';

const ORG_A = { id: 'org-a', name: 'Org A' };
const ORG_B = { id: 'org-b', name: 'Org B' };

function makeData(overrides: Partial<DailyReportData> = {}): DailyReportData {
  return {
    orgId: ORG_A.id,
    orgName: ORG_A.name,
    reportDate: new Date('2026-05-08T00:00:00Z'),
    totalCalls: 10,
    kpis: { callsCompleted: 9, qualifiedLeads: 4, appointmentsBooked: 2 },
    topCampaigns: [],
    recentAppointments: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('computeYesterdayRange', () => {
  it('returns a Europe/Rome calendar-day window relative to `now`', () => {
    // Pick a fixed instant in May 2026 (CEST, UTC+2). At 08:00 UTC on the 9th,
    // the Rome wall clock reads 10:00 — so "yesterday" is the 8th and the
    // window must begin at 2026-05-07T22:00Z (yesterday 00:00 Rome).
    const now = new Date('2026-05-09T08:00:00.000Z');
    const range = computeYesterdayRange(now);

    expect(range.start.toISOString()).toBe('2026-05-07T22:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-05-08T21:59:59.999Z');
    expect(range.reportDate.getTime()).toBe(range.start.getTime());
  });

  it('respects the Europe/Rome winter offset (CET, UTC+1)', () => {
    // 2026-12-15 — DST has ended, Rome is UTC+1.
    const now = new Date('2026-12-15T08:00:00.000Z');
    const range = computeYesterdayRange(now);

    expect(range.start.toISOString()).toBe('2026-12-13T23:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-12-14T22:59:59.999Z');
  });

  it('rolls back across a UTC date boundary when `now` is just past midnight Rome', () => {
    // 2026-05-09T22:30Z is 2026-05-10T00:30 in Rome → "yesterday" is the 9th,
    // not the 8th. Verifies we anchor on the Rome calendar, not the UTC one.
    const now = new Date('2026-05-09T22:30:00.000Z');
    const range = computeYesterdayRange(now);

    expect(range.start.toISOString()).toBe('2026-05-08T22:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-05-09T21:59:59.999Z');
  });
});

describe('runDailyReport', () => {
  function buildBaseDeps() {
    return {
      listActiveOrgs: vi.fn<(...args: unknown[]) => Promise<typeof ORG_A[]>>(
        async () => [ORG_A],
      ),
      buildData: vi.fn(async (orgId: string, orgName: string) =>
        makeData({ orgId, orgName }),
      ),
      listRecipients: vi.fn<
        (...args: unknown[]) => Promise<DailyReportRecipient[]>
      >(async () => [
        {
          userId: 'u1',
          email: 'owner@example.com',
          fullName: 'Owner One',
          locale: 'it',
        },
      ]),
      writeAudit: vi.fn(async () => undefined),
    };
  }

  it('skips orgs with no recipients and audits the skip', async () => {
    const deps = buildBaseDeps();
    deps.listRecipients.mockResolvedValueOnce([]);
    const mailer = vi.fn(async () => undefined);

    const result = await runDailyReport({
      now: new Date('2026-05-09T08:00:00Z'),
      ratePerSecond: 0,
      mailer,
      deps,
    });

    expect(result.orgsConsidered).toBe(1);
    expect(result.orgsSkipped).toBe(1);
    expect(result.orgsProcessed).toBe(0);
    expect(result.emailsSent).toBe(0);
    expect(mailer).not.toHaveBeenCalled();
    expect(deps.writeAudit).toHaveBeenCalledWith(
      ORG_A.id,
      'skipped_no_recipients',
      expect.objectContaining({ totalCalls: expect.any(Number) }),
    );
  });

  it('sends one email per recipient and audits success', async () => {
    const deps = buildBaseDeps();
    const recipients: DailyReportRecipient[] = [
      {
        userId: 'u1',
        email: 'mario@example.com',
        fullName: 'Mario',
        locale: 'it',
      },
      {
        userId: 'u2',
        email: 'jane@example.com',
        fullName: 'Jane',
        locale: 'en',
      },
    ];
    deps.listRecipients.mockResolvedValueOnce(recipients);
    const mailer = vi.fn<
      (params: { to: string; subject: string; html: string; text?: string }) => Promise<void>
    >(async () => undefined);

    const result = await runDailyReport({
      now: new Date('2026-05-09T08:00:00Z'),
      ratePerSecond: 0,
      mailer,
      deps,
    });

    expect(result.emailsSent).toBe(2);
    expect(result.orgsProcessed).toBe(1);
    expect(mailer).toHaveBeenCalledTimes(2);

    const firstCall = mailer.mock.calls[0]?.[0];
    expect(firstCall?.to).toBe('mario@example.com');
    expect(firstCall?.subject).toContain('Report giornaliero');
    expect(firstCall?.html).toContain('https://app.example.com/dashboard');

    const secondCall = mailer.mock.calls[1]?.[0];
    expect(secondCall?.to).toBe('jane@example.com');
    expect(secondCall?.subject).toContain('Daily report');

    expect(deps.writeAudit).toHaveBeenCalledWith(
      ORG_A.id,
      'sent',
      expect.objectContaining({ recipients: 2 }),
    );
  });

  it('records a failure and continues to the next org when the mailer throws', async () => {
    const deps = buildBaseDeps();
    deps.listActiveOrgs.mockResolvedValueOnce([ORG_A, ORG_B]);
    const mailer = vi.fn(async (params: { to: string }) => {
      if (params.to === 'first@example.com') throw new Error('smtp boom');
    });

    const firstOrgRecipients: DailyReportRecipient[] = [
      {
        userId: 'u1',
        email: 'first@example.com',
        fullName: null,
        locale: 'it',
      },
    ];
    const secondOrgRecipients: DailyReportRecipient[] = [
      {
        userId: 'u2',
        email: 'second@example.com',
        fullName: null,
        locale: 'it',
      },
    ];
    deps.listRecipients
      .mockResolvedValueOnce(firstOrgRecipients)
      .mockResolvedValueOnce(secondOrgRecipients);

    const result = await runDailyReport({
      now: new Date('2026-05-09T08:00:00Z'),
      ratePerSecond: 0,
      mailer,
      deps,
    });

    expect(result.orgsConsidered).toBe(2);
    expect(result.orgsFailed).toBe(1);
    expect(result.orgsProcessed).toBe(1);
    expect(result.emailsSent).toBe(1);

    expect(deps.writeAudit).toHaveBeenCalledWith(
      ORG_A.id,
      'failed',
      expect.objectContaining({ error: expect.stringContaining('smtp') }),
    );
    expect(deps.writeAudit).toHaveBeenCalledWith(
      ORG_B.id,
      'sent',
      expect.objectContaining({ recipients: 1 }),
    );
  });

  it('returns an empty report run when no org is active', async () => {
    const deps = buildBaseDeps();
    deps.listActiveOrgs.mockResolvedValueOnce([]);
    const mailer = vi.fn(async () => undefined);

    const result = await runDailyReport({
      now: new Date('2026-05-09T08:00:00Z'),
      ratePerSecond: 0,
      mailer,
      deps,
    });

    expect(result.orgsConsidered).toBe(0);
    expect(result.outcomes).toEqual([]);
    expect(mailer).not.toHaveBeenCalled();
    expect(deps.writeAudit).not.toHaveBeenCalled();
  });

  it('rate-limits to N emails per second by sleeping between batches', async () => {
    const deps = buildBaseDeps();
    deps.listActiveOrgs.mockResolvedValueOnce([ORG_A]);
    const manyRecipients: DailyReportRecipient[] = Array.from({ length: 25 }, (_, i) => ({
      userId: `u-${i}`,
      email: `user-${i}@example.com`,
      fullName: null,
      locale: 'it',
    }));
    deps.listRecipients.mockResolvedValueOnce(manyRecipients);
    const mailer = vi.fn(async () => undefined);
    const sleep = vi.fn(async () => undefined);

    const result = await runDailyReport({
      now: new Date('2026-05-09T08:00:00Z'),
      ratePerSecond: 10,
      mailer,
      sleep,
      deps,
    });

    expect(result.emailsSent).toBe(25);
    // 25 sends with a 10/sec cap: limiter wakes twice (after 10 and after 20).
    expect(sleep).toHaveBeenCalledTimes(2);
  });
});

// ─── buildDailyReportData ────────────────────────────────────────────────────

describe('buildDailyReportData', () => {
  it('shapes KPIs, top campaigns, and recent appointments from the tx', async () => {
    const aggregateRow = { total: 12, completed: 9, qualified: 4 };
    const apptRow = { booked: 3 };
    const topRows = [
      { id: 'c1', name: 'Riattivazione', total: 10, completed: 8, appointmentsBooked: 2 },
      { id: 'c2', name: 'Conferma', total: 5, completed: 4, appointmentsBooked: 1 },
    ];
    const apptRows = [
      {
        id: 'a1',
        scheduledAt: new Date('2026-05-12T09:00:00Z'),
        contactFirst: 'Mario',
        contactLast: 'Rossi',
        contactPhone: '+39000',
        campaignName: 'Riattivazione',
      },
      {
        id: 'a2',
        scheduledAt: new Date('2026-05-12T10:00:00Z'),
        contactFirst: null,
        contactLast: null,
        contactPhone: '+39111',
        campaignName: null,
      },
    ];

    const queueOfResults: unknown[][] = [
      [aggregateRow],
      [apptRow],
      topRows,
      apptRows,
    ];

    const tx = makeStubTx(queueOfResults);
    const dbContext = await import('@/lib/db/context');
    vi.mocked(dbContext.withOrgContext).mockImplementationOnce(async (_id, fn) =>
      fn(tx as unknown as Parameters<typeof fn>[0]),
    );

    const range: DailyReportRange = {
      start: new Date('2026-05-07T22:00:00Z'),
      end: new Date('2026-05-08T21:59:59.999Z'),
      reportDate: new Date('2026-05-07T22:00:00Z'),
    };

    const data = await buildDailyReportData('org-x', 'Org X', range);

    expect(data.kpis).toEqual({ callsCompleted: 9, qualifiedLeads: 4, appointmentsBooked: 3 });
    expect(data.totalCalls).toBe(12);
    expect(data.topCampaigns).toHaveLength(2);
    expect(data.topCampaigns[0]?.id).toBe('c1');
    expect(data.recentAppointments[0]?.contactName).toBe('Mario Rossi');
    expect(data.recentAppointments[1]?.contactName).toBe('+39111');
    expect(data.recentAppointments[1]?.campaignName).toBe('');
  });
});

// ─── getDailyReportRecipients ────────────────────────────────────────────────

describe('getDailyReportRecipients', () => {
  it('skips owners who have explicitly disabled the daily report', async () => {
    const ownerRows = [
      { userId: 'u1', email: 'in@example.com', fullName: 'Inny', locale: 'it' },
      { userId: 'u2', email: 'out@example.com', fullName: 'Outy', locale: 'it' },
      { userId: 'u3', email: 'def@example.com', fullName: 'Deffy', locale: 'en' },
    ];
    const prefRows = [
      { user_id: 'u1', daily_report: true },
      { user_id: 'u2', daily_report: false },
      // u3 has no row → defaults to true (still receives)
    ];

    const queueOfResults: unknown[][] = [ownerRows, prefRows];
    const tx = makeStubTx(queueOfResults);
    const dbContext = await import('@/lib/db/context');
    vi.mocked(dbContext.withSystemContext).mockImplementationOnce(async (fn) =>
      fn(tx as unknown as Parameters<typeof fn>[0]),
    );

    const recipients = await getDailyReportRecipients('org-z');

    expect(recipients.map((r) => r.userId)).toEqual(['u1', 'u3']);
    expect(recipients.find((r) => r.userId === 'u3')?.locale).toBe('en');
  });

  it('returns no recipients early when the org has no owners', async () => {
    const tx = makeStubTx([[]]);
    const dbContext = await import('@/lib/db/context');
    vi.mocked(dbContext.withSystemContext).mockImplementationOnce(async (fn) =>
      fn(tx as unknown as Parameters<typeof fn>[0]),
    );

    const recipients = await getDailyReportRecipients('org-empty');

    expect(recipients).toEqual([]);
    // Only the owners query should fire — no pref query when there are no owners.
    expect(tx.select).toHaveBeenCalledTimes(1);
  });
});

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeStubTx(queue: unknown[][]) {
  return {
    select: vi.fn(() => makeChain(queue.shift() ?? [])),
  };
}

function makeChain(result: unknown) {
  const chain: Record<string, () => typeof chain> & { then?: unknown } = {
    from: () => chain,
    where: () => chain,
    leftJoin: () => chain,
    innerJoin: () => chain,
    groupBy: () => chain,
    orderBy: () => chain,
    limit: () => chain,
  };
  (chain as Record<string, unknown>).then = (
    resolve: (v: unknown) => unknown,
    reject?: (e: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject);
  return chain;
}
