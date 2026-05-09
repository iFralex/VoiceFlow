import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── DB mock (mirrors the pattern used in campaign-results.test.ts) ───────────

let selectResults: unknown[][] = [];

function makeSelectChain(result: unknown[]) {
  const chain: Record<string, (...args: unknown[]) => typeof chain> & {
    then?: unknown;
  } = {
    from: () => chain,
    where: () => chain,
    leftJoin: () => chain,
    innerJoin: () => chain,
    groupBy: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    offset: () => chain,
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
  withOrgContext: vi.fn(
    (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(mockTx),
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
  selectResults = [];
  resetMockTx();
});

// ─── Pure helpers ─────────────────────────────────────────────────────────────

describe('maskPhoneLast4', () => {
  it('returns em-dash for null and undefined input', async () => {
    const { maskPhoneLast4 } = await import('./campaign-print-report');
    expect(maskPhoneLast4(null)).toBe('—');
    expect(maskPhoneLast4(undefined)).toBe('—');
  });

  it('keeps the last four digits and masks the rest', async () => {
    const { maskPhoneLast4 } = await import('./campaign-print-report');
    expect(maskPhoneLast4('+393331234567')).toBe('••• 4567');
    expect(maskPhoneLast4('+39 02 1234 5678')).toBe('••• 5678');
  });

  it('returns the original string when there are fewer than four digits', async () => {
    const { maskPhoneLast4 } = await import('./campaign-print-report');
    expect(maskPhoneLast4('123')).toBe('123');
    expect(maskPhoneLast4('+1')).toBe('+1');
  });
});

describe('formatBilledDuration', () => {
  it('returns 0s for non-positive input', async () => {
    const { formatBilledDuration } = await import('./campaign-print-report');
    expect(formatBilledDuration(0)).toBe('0s');
    expect(formatBilledDuration(-5)).toBe('0s');
  });

  it('omits zero parts and combines remaining ones', async () => {
    const { formatBilledDuration } = await import('./campaign-print-report');
    expect(formatBilledDuration(45)).toBe('45s');
    expect(formatBilledDuration(60)).toBe('1m');
    expect(formatBilledDuration(125)).toBe('2m 5s');
    expect(formatBilledDuration(3600)).toBe('1h');
    expect(formatBilledDuration(3725)).toBe('1h 2m 5s');
  });
});

// ─── getCampaignPrintReport ───────────────────────────────────────────────────

describe('getCampaignPrintReport', () => {
  it('returns null when the campaign is not visible to the org', async () => {
    selectResults = [
      [], // campaign row missing → caller sees null
    ];

    const { getCampaignPrintReport } = await import('./campaign-print-report');
    const out = await getCampaignPrintReport('org-1', 'camp-missing');
    expect(out).toBeNull();
  });

  it('aggregates campaign metadata, stats, and top appointments', async () => {
    selectResults = [
      // campaign row
      [
        {
          id: 'camp-1',
          name: 'Riattivazione Lead Maggio',
          status: 'completed',
          scriptName: 'Lead reactivation v2',
          createdAt: new Date('2026-05-01T08:00:00Z'),
          startedAt: new Date('2026-05-01T09:00:00Z'),
          completedAt: new Date('2026-05-01T17:30:00Z'),
        },
      ],
      // stats row
      [
        {
          campaign_id: 'camp-1',
          org_id: 'org-1',
          total_calls: 100,
          pending_calls: 0,
          dialing_calls: 0,
          in_progress_calls: 0,
          completed_calls: 80,
          failed_calls: 5,
          outcome_appointment_booked: 12,
          outcome_interested: 18,
          outcome_not_interested: 30,
          outcome_wrong_number: 2,
          outcome_callback: 6,
          outcome_voicemail: 4,
          outcome_do_not_call: 1,
          total_billed_seconds: 6400,
          total_cost_cents: 4800,
        },
      ],
      // appointments
      [
        {
          id: 'a-1',
          scheduledAt: new Date('2026-05-15T14:00:00Z'),
          notes: 'Richiamare mattino',
          firstName: 'Anna',
          lastName: 'Bianchi',
          phoneE164: '+393331111111',
        },
        {
          id: 'a-2',
          scheduledAt: new Date('2026-05-12T11:00:00Z'),
          notes: null,
          firstName: null,
          lastName: null,
          phoneE164: '+393332222222',
        },
      ],
    ];

    const { getCampaignPrintReport } = await import('./campaign-print-report');
    const out = await getCampaignPrintReport('org-1', 'camp-1');

    expect(out).not.toBeNull();
    expect(out?.campaign).toMatchObject({
      id: 'camp-1',
      name: 'Riattivazione Lead Maggio',
      status: 'completed',
      scriptName: 'Lead reactivation v2',
    });
    expect(out?.totals).toMatchObject({
      totalCalls: 100,
      completedCalls: 80,
      failedCalls: 5,
      qualifiedLeads: 30, // interested (18) + appointment_booked (12)
      appointmentsBooked: 12,
      totalBilledSeconds: 6400,
      totalCostCents: 4800,
    });
    expect(out?.outcomes).toEqual({
      appointmentBooked: 12,
      interested: 18,
      notInterested: 30,
      callback: 6,
      voicemail: 4,
      wrongNumber: 2,
      doNotCall: 1,
    });
    expect(out?.topAppointments).toHaveLength(2);
    expect(out?.topAppointments[0]).toMatchObject({
      id: 'a-1',
      contactName: 'Anna Bianchi',
      phoneE164: '+393331111111',
    });
    // Falls back to phone when contact name is missing
    expect(out?.topAppointments[1]).toMatchObject({
      id: 'a-2',
      contactName: '+393332222222',
    });
  });

  it('returns zeroed totals when no stats row exists yet', async () => {
    selectResults = [
      [
        {
          id: 'camp-1',
          name: 'New campaign',
          status: 'draft',
          scriptName: null,
          createdAt: new Date('2026-05-09T08:00:00Z'),
          startedAt: null,
          completedAt: null,
        },
      ],
      [], // no stats row
      [], // no appointments
    ];

    const { getCampaignPrintReport } = await import('./campaign-print-report');
    const out = await getCampaignPrintReport('org-1', 'camp-1');

    expect(out?.totals.totalCalls).toBe(0);
    expect(out?.totals.qualifiedLeads).toBe(0);
    expect(out?.outcomes).toEqual({
      appointmentBooked: 0,
      interested: 0,
      notInterested: 0,
      callback: 0,
      voicemail: 0,
      wrongNumber: 0,
      doNotCall: 0,
    });
    expect(out?.topAppointments).toEqual([]);
  });
});
