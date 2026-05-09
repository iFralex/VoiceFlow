import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── DB mock ─────────────────────────────────────────────────────────────────

let selectResults: unknown[][] = [];
const selectChainCalls: { method: string; args: unknown[] }[] = [];

function makeSelectChain(result: unknown[]) {
  const chain: Record<string, (...args: unknown[]) => typeof chain> & {
    then?: unknown;
  } = {
    from: (...args) => {
      selectChainCalls.push({ method: 'from', args });
      return chain;
    },
    where: (...args) => {
      selectChainCalls.push({ method: 'where', args });
      return chain;
    },
    leftJoin: (...args) => {
      selectChainCalls.push({ method: 'leftJoin', args });
      return chain;
    },
    innerJoin: (...args) => {
      selectChainCalls.push({ method: 'innerJoin', args });
      return chain;
    },
    groupBy: (...args) => {
      selectChainCalls.push({ method: 'groupBy', args });
      return chain;
    },
    orderBy: (...args) => {
      selectChainCalls.push({ method: 'orderBy', args });
      return chain;
    },
    limit: (...args) => {
      selectChainCalls.push({ method: 'limit', args });
      return chain;
    },
    offset: (...args) => {
      selectChainCalls.push({ method: 'offset', args });
      return chain;
    },
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
  selectChainCalls.length = 0;
  resetMockTx();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('listCampaignResults', () => {
  function pushResult(opts: { rows?: unknown[]; total?: number }) {
    // listCampaignResults runs two queries via Promise.all: rows first, then total.
    // Promise.all kicks them off in source order so the rows query is registered first.
    selectResults.push(opts.rows ?? []);
    selectResults.push([{ cnt: opts.total ?? (opts.rows?.length ?? 0) }]);
  }

  it('returns serialized rows and total count', async () => {
    pushResult({
      rows: [
        {
          id: 'call-1',
          contactId: 'contact-1',
          status: 'completed',
          outcome: 'appointment_booked',
          billableSeconds: 120,
          costCents: 50,
          startedAt: new Date('2026-05-09T10:00:00Z'),
          endedAt: new Date('2026-05-09T10:02:00Z'),
          createdAt: new Date('2026-05-09T09:59:00Z'),
          firstName: 'Mario',
          lastName: 'Rossi',
          phoneE164: '+393331234567',
        },
        {
          id: 'call-2',
          contactId: 'contact-2',
          status: 'no_answer',
          outcome: null,
          billableSeconds: null,
          costCents: null,
          startedAt: null,
          endedAt: null,
          createdAt: new Date('2026-05-09T09:00:00Z'),
          firstName: null,
          lastName: null,
          phoneE164: '+393339999999',
        },
      ],
      total: 25,
    });

    const { listCampaignResults } = await import('./campaign-results');
    const out = await listCampaignResults(
      'org-1',
      'camp-1',
      {},
      { page: 0, pageSize: 20 },
    );

    expect(out.total).toBe(25);
    expect(out.rows).toHaveLength(2);
    expect(out.rows[0]).toMatchObject({
      id: 'call-1',
      contactName: 'Mario Rossi',
      phoneE164: '+393331234567',
      status: 'completed',
      outcome: 'appointment_booked',
      billableSeconds: 120,
      costCents: 50,
      startedAtIso: '2026-05-09T10:00:00.000Z',
      endedAtIso: '2026-05-09T10:02:00.000Z',
    });
    expect(out.rows[1]).toMatchObject({
      id: 'call-2',
      contactName: '+393339999999', // falls back to phone when no name
      status: 'no_answer',
      outcome: null,
      billableSeconds: null,
      costCents: null,
      startedAtIso: null,
    });
  });

  it('returns empty result with zero total', async () => {
    pushResult({ rows: [], total: 0 });

    const { listCampaignResults } = await import('./campaign-results');
    const out = await listCampaignResults(
      'org-1',
      'camp-1',
      {},
      { page: 0, pageSize: 20 },
    );

    expect(out.rows).toEqual([]);
    expect(out.total).toBe(0);
  });

  it('applies LIMIT and OFFSET based on page/pageSize', async () => {
    pushResult({ rows: [], total: 0 });

    const { listCampaignResults } = await import('./campaign-results');
    await listCampaignResults('org-1', 'camp-1', {}, { page: 2, pageSize: 50 });

    const limitCall = selectChainCalls.find((c) => c.method === 'limit');
    const offsetCall = selectChainCalls.find((c) => c.method === 'offset');

    expect(limitCall?.args[0]).toBe(50);
    expect(offsetCall?.args[0]).toBe(100); // page 2 * 50
  });

  it('caps pageSize at MAX_PAGE_SIZE', async () => {
    pushResult({ rows: [], total: 0 });

    const { listCampaignResults } = await import('./campaign-results');
    await listCampaignResults('org-1', 'camp-1', {}, { page: 0, pageSize: 9999 });

    const limitCall = selectChainCalls.find((c) => c.method === 'limit');
    expect(limitCall?.args[0]).toBe(200);
  });

  it('handles large page numbers without negative offsets', async () => {
    pushResult({ rows: [], total: 0 });

    const { listCampaignResults } = await import('./campaign-results');
    await listCampaignResults('org-1', 'camp-1', {}, { page: -1, pageSize: 20 });

    const offsetCall = selectChainCalls.find((c) => c.method === 'offset');
    expect(offsetCall?.args[0]).toBe(0);
  });
});

describe('collectCampaignResultsForExport', () => {
  function pushResult(opts: { rows?: unknown[]; total?: number }) {
    // Same Promise.all order as listCampaignResults: rows then total.
    selectResults.push(opts.rows ?? []);
    selectResults.push([{ cnt: opts.total ?? (opts.rows?.length ?? 0) }]);
  }

  it('returns rows joined with appointment scheduled_at and the total count', async () => {
    pushResult({
      rows: [
        {
          id: 'call-1',
          contactId: 'contact-1',
          status: 'completed',
          outcome: 'appointment_booked',
          billableSeconds: 90,
          costCents: 75,
          startedAt: new Date('2026-05-09T10:00:00Z'),
          endedAt: new Date('2026-05-09T10:01:30Z'),
          createdAt: new Date('2026-05-09T09:59:00Z'),
          firstName: 'Anna',
          lastName: 'Bianchi',
          phoneE164: '+393331111111',
          appointmentScheduledAt: new Date('2026-05-15T14:00:00Z'),
        },
      ],
      total: 1,
    });

    const { collectCampaignResultsForExport } = await import('./campaign-results');
    const out = await collectCampaignResultsForExport('org-1', 'camp-1', {}, 5000);

    expect(out.total).toBe(1);
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]).toMatchObject({
      id: 'call-1',
      contactName: 'Anna Bianchi',
      appointmentScheduledAtIso: '2026-05-15T14:00:00.000Z',
    });

    // The export query joins both contacts and appointments
    const joins = selectChainCalls.filter((c) => c.method === 'leftJoin');
    expect(joins.length).toBeGreaterThanOrEqual(2);
  });

  it('applies the requested cap as the LIMIT', async () => {
    pushResult({ rows: [], total: 0 });

    const { collectCampaignResultsForExport } = await import('./campaign-results');
    await collectCampaignResultsForExport('org-1', 'camp-1', {}, 5000);

    const limitCall = selectChainCalls.find((c) => c.method === 'limit');
    expect(limitCall?.args[0]).toBe(5000);
  });

  it('reports total separately from the row cap', async () => {
    pushResult({ rows: [], total: 12_500 });

    const { collectCampaignResultsForExport } = await import('./campaign-results');
    const out = await collectCampaignResultsForExport('org-1', 'camp-1', {}, 5000);

    expect(out.total).toBe(12_500);
    expect(out.rows).toHaveLength(0);
  });
});

describe('campaignResultsToCsv', () => {
  it('produces a CSV with the expected header columns', async () => {
    const { campaignResultsToCsv } = await import('./campaign-results');
    const csv = campaignResultsToCsv([
      {
        id: 'c1',
        contactId: null,
        contactName: '',
        phoneE164: null,
        status: 'completed',
        outcome: null,
        billableSeconds: null,
        costCents: null,
        startedAtIso: null,
        endedAtIso: null,
        createdAtIso: '2026-05-09T09:00:00.000Z',
        appointmentScheduledAtIso: null,
      },
    ]);
    expect(csv.split('\r\n')[0] ?? csv.split('\n')[0]).toBe(
      'contatto,telefono,stato,esito,durata_secondi,costo_eur,ora_chiamata,appuntamento_fissato_per',
    );
  });

  it('returns an empty string when given no rows', async () => {
    const { campaignResultsToCsv } = await import('./campaign-results');
    expect(campaignResultsToCsv([])).toBe('');
  });

  it('serialises a row with formatted euro currency and ISO timestamps', async () => {
    const { campaignResultsToCsv } = await import('./campaign-results');
    const csv = campaignResultsToCsv([
      {
        id: 'c1',
        contactId: 'k1',
        contactName: 'Mario Rossi',
        phoneE164: '+393331234567',
        status: 'completed',
        outcome: 'appointment_booked',
        billableSeconds: 120,
        costCents: 175,
        startedAtIso: '2026-05-09T10:00:00.000Z',
        endedAtIso: '2026-05-09T10:02:00.000Z',
        createdAtIso: '2026-05-09T09:59:00.000Z',
        appointmentScheduledAtIso: '2026-05-15T14:00:00.000Z',
      },
    ]);

    const lines = csv.trim().split('\n');
    expect(lines).toHaveLength(2);
    // costCents 175 → "1.75" in EUR
    expect(lines[1]).toContain('1.75');
    expect(lines[1]).toContain('+393331234567');
    expect(lines[1]).toContain('Mario Rossi');
    expect(lines[1]).toContain('2026-05-15T14:00:00.000Z');
  });

  it('serialises null fields as empty strings', async () => {
    const { campaignResultsToCsv } = await import('./campaign-results');
    const csv = campaignResultsToCsv([
      {
        id: 'c1',
        contactId: null,
        contactName: '',
        phoneE164: null,
        status: 'no_answer',
        outcome: null,
        billableSeconds: null,
        costCents: null,
        startedAtIso: null,
        endedAtIso: null,
        createdAtIso: '2026-05-09T09:00:00.000Z',
        appointmentScheduledAtIso: null,
      },
    ]);

    // Empty fields render as just commas
    const dataRow = csv.trim().split('\n')[1] ?? '';
    expect(dataRow).toContain(',,no_answer,,,,2026-05-09T09:00:00.000Z,');
  });
});
