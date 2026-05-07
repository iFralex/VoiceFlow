import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockWithSystemContext, mockRecordAudit } = vi.hoisted(() => {
  const mockWithSystemContext = vi.fn();
  const mockRecordAudit = vi.fn();
  return { mockWithSystemContext, mockRecordAudit };
});

vi.mock('@/lib/db/context', () => ({
  withSystemContext: mockWithSystemContext,
}));

vi.mock('@/lib/db/audit', () => ({
  recordAudit: mockRecordAudit,
}));

vi.mock('@/lib/db/schema', () => ({
  calls: {
    id: 'c_id',
    org_id: 'c_org_id',
    campaign_id: 'c_campaign_id',
    contact_id: 'c_contact_id',
    created_at: 'c_created_at',
    cost_cents: 'c_cost_cents',
    outcome: 'c_outcome',
    recording_path: 'c_recording_path',
    transcript_path: 'c_transcript_path',
    metadata: 'c_metadata',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown) => ({ type: 'eq', col, val }),
  and: (...args: unknown[]) => ({ type: 'and', args: args.filter((a) => a !== undefined) }),
  desc: (col: unknown) => ({ type: 'desc', col }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({
      type: 'sql',
      strings: Array.from(strings),
      values,
    }),
    { raw: (s: string) => s },
  ),
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import {
  DISCLOSURE_TRIAGE_STATUSES,
  isDisclosureTriageStatus,
  listDisclosureFailures,
  updateDisclosureTriage,
} from './triage';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const ORG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
const CALL_ID = 'cccccccc-cccc-4ccc-8ccc-000000000001';

interface FailureRow {
  id: string;
  org_id: string;
  campaign_id: string | null;
  contact_id: string | null;
  created_at: Date;
  cost_cents: number | null;
  outcome: string | null;
  recording_path: string | null;
  transcript_path: string | null;
  metadata: Record<string, unknown> | null;
}

function buildListTx(rows: FailureRow[]): unknown {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue(rows),
          })),
        })),
      })),
    })),
  };
}

function makeRow(overrides: Partial<FailureRow> = {}): FailureRow {
  return {
    id: CALL_ID,
    org_id: ORG_ID,
    campaign_id: null,
    contact_id: null,
    created_at: new Date('2026-05-01T12:00:00Z'),
    cost_cents: 250,
    outcome: 'not_interested',
    recording_path: `recordings/${ORG_ID}/${CALL_ID}.mp3`,
    transcript_path: `transcripts/${ORG_ID}/${CALL_ID}.json`,
    metadata: { disclosure_verified: false },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('isDisclosureTriageStatus', () => {
  it('accepts every value in DISCLOSURE_TRIAGE_STATUSES', () => {
    for (const s of DISCLOSURE_TRIAGE_STATUSES) {
      expect(isDisclosureTriageStatus(s)).toBe(true);
    }
  });

  it('rejects unknown strings', () => {
    expect(isDisclosureTriageStatus('open')).toBe(false);
    expect(isDisclosureTriageStatus('')).toBe(false);
    expect(isDisclosureTriageStatus(undefined)).toBe(false);
    expect(isDisclosureTriageStatus(null)).toBe(false);
    expect(isDisclosureTriageStatus(42)).toBe(false);
  });
});

describe('listDisclosureFailures', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns mapped rows with default triage status pending when not yet set', async () => {
    mockWithSystemContext.mockImplementationOnce(
      async (fn: (tx: unknown) => Promise<unknown>) => fn(buildListTx([makeRow()])),
    );

    const rows = await listDisclosureFailures();

    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row).toBeDefined();
    if (!row) throw new Error('row is undefined');
    expect(row.callId).toBe(CALL_ID);
    expect(row.orgId).toBe(ORG_ID);
    expect(row.triageStatus).toBe('pending');
    expect(row.triageNote).toBeNull();
    expect(row.triagedAt).toBeNull();
    expect(row.triagedBy).toBeNull();
    expect(row.recordingPath).toBe(`recordings/${ORG_ID}/${CALL_ID}.mp3`);
    expect(row.transcriptPath).toBe(`transcripts/${ORG_ID}/${CALL_ID}.json`);
  });

  it('parses existing triage metadata correctly', async () => {
    mockWithSystemContext.mockImplementationOnce(
      async (fn: (tx: unknown) => Promise<unknown>) =>
        fn(
          buildListTx([
            makeRow({
              metadata: {
                disclosure_verified: false,
                disclosure_triage_status: 'refunded',
                disclosure_triage_note: 'Refunded — call abc',
                disclosure_triaged_at: '2026-05-02T08:30:00.000Z',
                disclosure_triaged_by: 'founder@voxauto.it',
              },
            }),
          ]),
        ),
    );

    const [row] = await listDisclosureFailures();
    expect(row).toBeDefined();
    if (!row) throw new Error('row is undefined');
    expect(row.triageStatus).toBe('refunded');
    expect(row.triageNote).toBe('Refunded — call abc');
    expect(row.triagedAt?.toISOString()).toBe('2026-05-02T08:30:00.000Z');
    expect(row.triagedBy).toBe('founder@voxauto.it');
  });

  it('falls back to pending when disclosure_triage_status is malformed', async () => {
    mockWithSystemContext.mockImplementationOnce(
      async (fn: (tx: unknown) => Promise<unknown>) =>
        fn(
          buildListTx([
            makeRow({
              metadata: {
                disclosure_verified: false,
                disclosure_triage_status: 'archived',
              },
            }),
          ]),
        ),
    );

    const [row] = await listDisclosureFailures();
    expect(row?.triageStatus).toBe('pending');
  });

  it('filters by triage status in JS after fetching', async () => {
    mockWithSystemContext.mockImplementationOnce(
      async (fn: (tx: unknown) => Promise<unknown>) =>
        fn(
          buildListTx([
            makeRow({
              id: 'c1',
              metadata: { disclosure_verified: false, disclosure_triage_status: 'pending' },
            }),
            makeRow({
              id: 'c2',
              metadata: { disclosure_verified: false, disclosure_triage_status: 'refunded' },
            }),
            makeRow({
              id: 'c3',
              metadata: { disclosure_verified: false, disclosure_triage_status: 'pending' },
            }),
          ]),
        ),
    );

    const rows = await listDisclosureFailures({ status: 'pending' });
    expect(rows.map((r) => r.callId)).toEqual(['c1', 'c3']);
  });
});

describe('updateDisclosureTriage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('updates metadata and writes an audit_log entry on success', async () => {
    const updateChain = {
      set: vi.fn(() => ({
        where: vi.fn().mockResolvedValue(undefined),
      })),
    };
    const tx = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue([
              { org_id: ORG_ID, metadata: { disclosure_verified: false } },
            ]),
          })),
        })),
      })),
      update: vi.fn(() => updateChain),
    };
    mockWithSystemContext.mockImplementationOnce(
      async (fn: (tx: unknown) => Promise<unknown>) => fn(tx),
    );

    const result = await updateDisclosureTriage({
      callId: CALL_ID,
      status: 'refunded',
      note: 'ledger row 42',
      actor: 'founder',
    });

    expect(result).toEqual({ ok: true, orgId: ORG_ID });
    expect(tx.update).toHaveBeenCalled();
    expect(updateChain.set).toHaveBeenCalledOnce();
    expect(mockRecordAudit).toHaveBeenCalledOnce();
    expect(mockRecordAudit).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        orgId: ORG_ID,
        actorType: 'system',
        action: 'compliance.disclosure_triaged',
        subjectType: 'call',
        subjectId: CALL_ID,
        metadata: expect.objectContaining({
          status: 'refunded',
          note: 'ledger row 42',
          actor: 'founder',
        }),
      }),
    );
  });

  it('returns not_found when the call does not exist', async () => {
    const tx = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue([]),
          })),
        })),
      })),
      update: vi.fn(),
    };
    mockWithSystemContext.mockImplementationOnce(
      async (fn: (tx: unknown) => Promise<unknown>) => fn(tx),
    );

    const result = await updateDisclosureTriage({
      callId: CALL_ID,
      status: 'reviewed',
    });

    expect(result).toEqual({ ok: false, reason: 'not_found' });
    expect(tx.update).not.toHaveBeenCalled();
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it('rejects calls that are not flagged as disclosure failures', async () => {
    const tx = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue([
              { org_id: ORG_ID, metadata: { disclosure_verified: true } },
            ]),
          })),
        })),
      })),
      update: vi.fn(),
    };
    mockWithSystemContext.mockImplementationOnce(
      async (fn: (tx: unknown) => Promise<unknown>) => fn(tx),
    );

    const result = await updateDisclosureTriage({
      callId: CALL_ID,
      status: 'reviewed',
    });

    expect(result).toEqual({ ok: false, reason: 'not_found' });
    expect(tx.update).not.toHaveBeenCalled();
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it('trims actor and note, persisting null when blank', async () => {
    const updateChain = {
      set: vi.fn(() => ({
        where: vi.fn().mockResolvedValue(undefined),
      })),
    };
    const tx = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue([
              { org_id: ORG_ID, metadata: { disclosure_verified: false } },
            ]),
          })),
        })),
      })),
      update: vi.fn(() => updateChain),
    };
    mockWithSystemContext.mockImplementationOnce(
      async (fn: (tx: unknown) => Promise<unknown>) => fn(tx),
    );

    const result = await updateDisclosureTriage({
      callId: CALL_ID,
      status: 'reviewed',
      note: '   ',
      actor: '   ',
    });

    expect(result).toEqual({ ok: true, orgId: ORG_ID });
    expect(mockRecordAudit).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        metadata: expect.objectContaining({
          status: 'reviewed',
          note: null,
          actor: null,
        }),
      }),
    );
  });
});
