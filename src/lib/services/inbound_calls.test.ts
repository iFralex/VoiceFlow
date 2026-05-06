/**
 * Unit tests for the inbound IVR call service (plan 10 task 11).
 *
 * Covers the orchestration logic (when to insert, when to dedupe orgs, how
 * many opt-outs / audits to write) by mocking `withOrgContext`,
 * `withSystemContext`, and `findRecentOutboundCallsToNumber`. Real Postgres
 * semantics (the join in the lookup, the unique constraint on opt_out_registry,
 * RLS scoping of the inserts) are covered by the integration tests for the
 * underlying primitives.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockWithOrgContext,
  mockWithSystemContext,
  mockFindRecent,
  mockRecordAudit,
} = vi.hoisted(() => {
  return {
    mockWithOrgContext: vi.fn(),
    mockWithSystemContext: vi.fn(),
    mockFindRecent: vi.fn(),
    mockRecordAudit: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('@/lib/db/context', () => ({
  withOrgContext: mockWithOrgContext,
  withSystemContext: mockWithSystemContext,
}));

vi.mock('@/lib/db/audit', () => ({
  recordAudit: mockRecordAudit,
}));

vi.mock('@/lib/voice/inbound/lookup', () => ({
  findRecentOutboundCallsToNumber: mockFindRecent,
}));

vi.mock('@/lib/db/schema', () => ({
  calls: { id: 'c_id', org_id: 'c_org_id', direction: 'c_direction', provider_call_id: 'c_pcid', created_at: 'c_created_at' },
  optOutRegistry: {},
}));

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ type: 'and', args }),
  desc: (col: unknown) => ({ type: 'desc', col }),
  eq: (col: unknown, val: unknown) => ({ type: 'eq', col, val }),
}));

import {
  recordInboundCallEnded,
  recordInboundCallStarted,
  recordInboundOptout,
} from './inbound_calls';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

interface CallRow {
  id: string;
  org_id: string;
  provider_call_id?: string;
  direction?: 'inbound' | 'outbound';
}

function makeSelectChain(rows: unknown[]) {
  // build a chain that responds to .from().where().limit() and .from().where().orderBy().limit()
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(() => Promise.resolve(rows)),
  };
  return chain;
}

function makeInsertChain(returning: unknown[]) {
  const chain = {
    values: vi.fn(() => chain),
    onConflictDoNothing: vi.fn(() => chain),
    returning: vi.fn(() => Promise.resolve(returning)),
  };
  return chain;
}

function makeUpdateChain() {
  const chain = {
    set: vi.fn(() => chain),
    where: vi.fn(() => Promise.resolve(undefined)),
  };
  return chain;
}

interface MockTx {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
}

function makeTx(opts: {
  selectRows?: unknown[][];
  insertResults?: unknown[][];
}): MockTx {
  const selectRowsQueue = [...(opts.selectRows ?? [])];
  const insertResultsQueue = [...(opts.insertResults ?? [])];
  return {
    select: vi.fn(() => makeSelectChain(selectRowsQueue.shift() ?? [])),
    insert: vi.fn(() => makeInsertChain(insertResultsQueue.shift() ?? [])),
    update: vi.fn(() => makeUpdateChain()),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('recordInboundCallStarted', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns existing row when one already exists for provider_call_id (idempotent)', async () => {
    const existing: CallRow = { id: 'inb-1', org_id: 'org-1' };
    const sysTx = makeTx({ selectRows: [[existing]] });
    mockWithSystemContext.mockImplementationOnce((fn) => fn(sysTx));

    const result = await recordInboundCallStarted({
      providerCallId: 'vapi-1',
      callerNumber: '+393401111111',
      toNumber: '+390212345678',
    });

    expect(result).toEqual(existing);
    expect(mockFindRecent).not.toHaveBeenCalled();
    expect(mockWithOrgContext).not.toHaveBeenCalled();
  });

  it('returns null when no recent calling org exists', async () => {
    const sysTx = makeTx({ selectRows: [[]] });
    mockWithSystemContext.mockImplementationOnce((fn) => fn(sysTx));
    mockFindRecent.mockResolvedValueOnce([]);

    const result = await recordInboundCallStarted({
      providerCallId: 'vapi-2',
      callerNumber: '+393402222222',
      toNumber: '+390212345678',
    });

    expect(result).toBeNull();
    expect(mockWithOrgContext).not.toHaveBeenCalled();
  });

  it('inserts an inbound row scoped to the most recent calling org', async () => {
    const sysTx = makeTx({ selectRows: [[]] });
    mockWithSystemContext.mockImplementationOnce((fn) => fn(sysTx));
    mockFindRecent.mockResolvedValueOnce([
      { orgId: 'org-newest', callId: 'c-1', contactId: 'k-1', dialedAt: new Date() },
      { orgId: 'org-older', callId: 'c-2', contactId: 'k-2', dialedAt: new Date(0) },
    ]);

    const inserted = { id: 'inb-99', org_id: 'org-newest', direction: 'inbound' };
    const orgTx = makeTx({ insertResults: [[inserted]] });
    mockWithOrgContext.mockImplementationOnce((orgId, fn) => {
      expect(orgId).toBe('org-newest');
      return fn(orgTx);
    });

    const result = await recordInboundCallStarted({
      providerCallId: 'vapi-3',
      callerNumber: '+393403333333',
      toNumber: '+390212345678',
    });

    expect(result).toEqual(inserted);
    expect(orgTx.insert).toHaveBeenCalled();
    expect(mockRecordAudit).toHaveBeenCalledWith(
      orgTx,
      expect.objectContaining({
        action: 'inbound_call.received',
        actorType: 'webhook',
        orgId: 'org-newest',
      }),
    );
  });
});

describe('recordInboundCallEnded', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is a no-op when no inbound row matches the provider_call_id', async () => {
    const sysTx = makeTx({ selectRows: [[]] });
    mockWithSystemContext.mockImplementationOnce((fn) => fn(sysTx));

    await recordInboundCallEnded({
      providerCallId: 'vapi-missing',
      durationSeconds: 30,
      endedReason: 'hangup',
    });

    expect(mockWithOrgContext).not.toHaveBeenCalled();
  });

  it('updates the inbound row and writes an audit record when found', async () => {
    const sysTx = makeTx({ selectRows: [[{ id: 'inb-1', org_id: 'org-1' }]] });
    mockWithSystemContext.mockImplementationOnce((fn) => fn(sysTx));

    const orgTx = makeTx({});
    mockWithOrgContext.mockImplementationOnce((orgId, fn) => {
      expect(orgId).toBe('org-1');
      return fn(orgTx);
    });

    await recordInboundCallEnded({
      providerCallId: 'vapi-1',
      durationSeconds: 42,
      endedReason: 'hangup',
      recordingUrl: 'https://cdn/r.mp3',
    });

    expect(orgTx.update).toHaveBeenCalled();
    expect(mockRecordAudit).toHaveBeenCalledWith(
      orgTx,
      expect.objectContaining({
        action: 'inbound_call.ended',
        actorType: 'webhook',
        subjectId: 'inb-1',
        metadata: expect.objectContaining({ durationSeconds: 42, endedReason: 'hangup' }),
      }),
    );
  });
});

describe('recordInboundOptout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns an empty enroled-orgs list when no recent caller exists', async () => {
    mockFindRecent.mockResolvedValueOnce([]);
    const sysTx = makeTx({ selectRows: [[]] });
    mockWithSystemContext.mockImplementationOnce((fn) => fn(sysTx));

    const result = await recordInboundOptout({
      providerCallId: 'vapi-no-history',
      callerNumber: '+393401234567',
    });

    expect(result.enroledOrgIds).toEqual([]);
    expect(mockWithOrgContext).not.toHaveBeenCalled();
  });

  it('dedupes by org and writes one opt_out + one audit per unique org', async () => {
    // ORG_A appears twice (two recent campaigns to the same number) — should only
    // produce a single insert + audit pair.
    mockFindRecent.mockResolvedValueOnce([
      { orgId: 'org-A', callId: 'c1', contactId: 'k1', dialedAt: new Date() },
      { orgId: 'org-A', callId: 'c2', contactId: 'k2', dialedAt: new Date(0) },
      { orgId: 'org-B', callId: 'c3', contactId: 'k3', dialedAt: new Date() },
    ]);

    const orgTxs: MockTx[] = [];
    mockWithOrgContext.mockImplementation((orgId, fn) => {
      const tx = makeTx({});
      orgTxs.push(tx);
      // Tag tx with orgId for assertions
      (tx as unknown as Record<string, unknown>)['__orgId'] = orgId;
      return fn(tx);
    });

    // After per-org writes, the service looks up the inbound row to mark its
    // outcome. Return none so the trailing update path is skipped.
    const sysTx = makeTx({ selectRows: [[]] });
    mockWithSystemContext.mockImplementationOnce((fn) => fn(sysTx));

    const result = await recordInboundOptout({
      providerCallId: 'vapi-optout',
      callerNumber: '+393401234567',
    });

    expect(result.enroledOrgIds.sort()).toEqual(['org-A', 'org-B']);
    expect(mockWithOrgContext).toHaveBeenCalledTimes(2);

    const insertCalls = orgTxs.flatMap((t) => t.insert.mock.calls);
    expect(insertCalls.length).toBe(2);

    expect(mockRecordAudit).toHaveBeenCalledTimes(2);
    const orgIds = mockRecordAudit.mock.calls.map(
      (c) => (c[1] as { orgId: string }).orgId,
    );
    expect(orgIds.sort()).toEqual(['org-A', 'org-B']);

    // Each audit row should carry source: 'inbound_ivr'
    for (const call of mockRecordAudit.mock.calls) {
      expect(call[1]).toEqual(
        expect.objectContaining({
          action: 'opt_out.recorded',
          actorType: 'webhook',
          metadata: expect.objectContaining({ source: 'inbound_ivr' }),
        }),
      );
    }
  });

  it('marks the inbound row outcome to do_not_call when it can be located', async () => {
    mockFindRecent.mockResolvedValueOnce([
      { orgId: 'org-X', callId: 'c1', contactId: 'k1', dialedAt: new Date() },
    ]);

    const orgTxs: MockTx[] = [];
    mockWithOrgContext.mockImplementation((_orgId, fn) => {
      const tx = makeTx({});
      orgTxs.push(tx);
      return fn(tx);
    });

    const sysTx = makeTx({ selectRows: [[{ id: 'inb-99', org_id: 'org-X' }]] });
    mockWithSystemContext.mockImplementationOnce((fn) => fn(sysTx));

    await recordInboundOptout({
      providerCallId: 'vapi-x',
      callerNumber: '+393409999999',
    });

    // Two withOrgContext calls: one for the per-org opt-out, one for the
    // outcome update at the end.
    expect(mockWithOrgContext).toHaveBeenCalledTimes(2);
    // The second tx should have been used for an update (outcome flip).
    const lastTx = orgTxs[1]!;
    expect(lastTx.update).toHaveBeenCalled();
  });
});
