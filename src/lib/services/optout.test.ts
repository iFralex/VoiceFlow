import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Hoisted mocks ───────────────────────────────────────────────────────────

const {
  mockWithOrgContext,
  mockRecordAudit,
  mockSendInngestEvents,
  mockSendInngestEvent,
} = vi.hoisted(() => ({
  mockWithOrgContext: vi.fn(),
  mockRecordAudit: vi.fn().mockResolvedValue(undefined),
  mockSendInngestEvents: vi.fn().mockResolvedValue(undefined),
  mockSendInngestEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/db/context', () => ({
  withOrgContext: mockWithOrgContext,
}));

vi.mock('@/lib/db/audit', () => ({
  recordAudit: mockRecordAudit,
}));

vi.mock('@/lib/inngest/client', () => ({
  sendInngestEvents: mockSendInngestEvents,
  sendInngestEvent: mockSendInngestEvent,
}));

vi.mock('@/lib/db/schema', () => ({
  contacts: {
    org_id: 'c_org_id',
    phone_e164: 'c_phone_e164',
    deleted_at: 'c_deleted_at',
  },
  optOutRegistry: {
    org_id: 'o_org_id',
    phone_e164: 'o_phone_e164',
    source: 'o_source',
  },
  // markOptOutInTx only references optOutSourceEnum at the type level, so the
  // runtime value can be a stub.
  optOutSourceEnum: {
    enumValues: ['call_outcome', 'dealer_input', 'gdpr_request', 'inbound_ivr', 'rpo_block'],
  },
}));

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ type: 'and', args }),
  eq: (col: unknown, val: unknown) => ({ type: 'eq', col, val }),
  inArray: (col: unknown, vals: unknown[]) => ({ type: 'inArray', col, vals }),
  isNull: (col: unknown) => ({ type: 'isNull', col }),
}));

import {
  bulkMarkOptOut,
  COMPLIANCE_OPT_OUT_REGISTERED_EVENT,
  markOptOut,
  markOptOutInTx,
  type OptOutSource,
} from './optout';

// ─── Fixture helpers ─────────────────────────────────────────────────────────

interface InsertCapture {
  values?: unknown;
  conflictBranch?: 'doNothing' | 'doUpdate';
}

interface UpdateCapture {
  setArg?: Record<string, unknown>;
}

function buildMockTx() {
  const inserts: InsertCapture[] = [];
  const updates: UpdateCapture[] = [];

  const tx = {
    _inserts: inserts,
    _updates: updates,
    insert: vi.fn(() => {
      const recorder: InsertCapture = {};
      inserts.push(recorder);
      return {
        values: (v: unknown) => {
          recorder.values = v;
          return {
            onConflictDoNothing: vi.fn(() => {
              recorder.conflictBranch = 'doNothing';
              return Promise.resolve(undefined);
            }),
            onConflictDoUpdate: vi.fn(() => {
              recorder.conflictBranch = 'doUpdate';
              return Promise.resolve(undefined);
            }),
          };
        },
      };
    }),
    update: vi.fn(() => {
      const recorder: UpdateCapture = {};
      updates.push(recorder);
      return {
        set: (s: Record<string, unknown>) => {
          recorder.setArg = s;
          return { where: vi.fn(() => Promise.resolve(undefined)) };
        },
      };
    }),
  };

  return tx;
}

// ─── Tests: markOptOutInTx ───────────────────────────────────────────────────

describe('markOptOutInTx', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts into opt_out_registry with onConflictDoNothing for idempotency', async () => {
    const tx = buildMockTx();

    await markOptOutInTx(tx as never, {
      orgId: 'org-1',
      phoneE164: '+393331234567',
      source: 'dealer_input',
    });

    expect(tx._inserts).toHaveLength(1);
    expect(tx._inserts[0]?.values).toMatchObject({
      org_id: 'org-1',
      phone_e164: '+393331234567',
      source: 'dealer_input',
    });
    expect(tx._inserts[0]?.conflictBranch).toBe('doNothing');
  });

  it('updates contacts with opt_out=true and opt_out_reason=source', async () => {
    const tx = buildMockTx();

    await markOptOutInTx(tx as never, {
      orgId: 'org-1',
      phoneE164: '+393331234567',
      source: 'gdpr_request',
    });

    expect(tx._updates).toHaveLength(1);
    expect(tx._updates[0]?.setArg).toEqual({
      opt_out: true,
      opt_out_reason: 'gdpr_request',
    });
  });

  it('writes an opt_out.recorded audit entry with the source in metadata', async () => {
    const tx = buildMockTx();

    await markOptOutInTx(tx as never, {
      orgId: 'org-1',
      phoneE164: '+393331234567',
      source: 'call_outcome',
      callId: 'call-9',
      reason: 'cliente non interessato',
      actorUserId: 'user-1',
    });

    expect(mockRecordAudit).toHaveBeenCalledOnce();
    const auditCall = mockRecordAudit.mock.calls[0]!;
    expect(auditCall[1]).toEqual(
      expect.objectContaining({
        orgId: 'org-1',
        actorUserId: 'user-1',
        actorType: 'webhook',
        action: 'opt_out.recorded',
        subjectType: 'phone_number',
        subjectId: '+393331234567',
        metadata: expect.objectContaining({
          source: 'call_outcome',
          reason: 'cliente non interessato',
          callId: 'call-9',
        }),
      }),
    );
  });

  it('returns one compliance/opt-out-registered event with deterministic id', async () => {
    const tx = buildMockTx();

    const events = await markOptOutInTx(tx as never, {
      orgId: 'org-1',
      phoneE164: '+393331234567',
      source: 'inbound_ivr',
    });

    expect(events).toHaveLength(1);
    expect(events[0]!.name).toBe(COMPLIANCE_OPT_OUT_REGISTERED_EVENT);
    expect(events[0]!.id).toBe('opt-out-org-1-+393331234567-inbound_ivr');
    expect(events[0]!.data).toMatchObject({
      orgId: 'org-1',
      phoneE164: '+393331234567',
      source: 'inbound_ivr',
    });
    expect(typeof (events[0]!.data as { recordedAt: string }).recordedAt).toBe('string');
  });

  it('infers actorType=system for rpo_block source', async () => {
    const tx = buildMockTx();
    await markOptOutInTx(tx as never, {
      orgId: 'org-1',
      phoneE164: '+393331234567',
      source: 'rpo_block',
    });
    expect(mockRecordAudit.mock.calls[0]?.[1]).toMatchObject({ actorType: 'system' });
  });

  it('infers actorType=user for dealer_input/gdpr_request sources', async () => {
    for (const source of ['dealer_input', 'gdpr_request'] as const) {
      mockRecordAudit.mockClear();
      const tx = buildMockTx();
      await markOptOutInTx(tx as never, {
        orgId: 'org-1',
        phoneE164: '+393331234567',
        source,
      });
      expect(mockRecordAudit.mock.calls[0]?.[1]).toMatchObject({ actorType: 'user' });
    }
  });

  it('respects an explicit actorType override', async () => {
    const tx = buildMockTx();
    await markOptOutInTx(tx as never, {
      orgId: 'org-1',
      phoneE164: '+393331234567',
      source: 'dealer_input',
      actorType: 'system',
    });
    expect(mockRecordAudit.mock.calls[0]?.[1]).toMatchObject({ actorType: 'system' });
  });

  it('is idempotent — repeated calls write the same registry insert with onConflictDoNothing', async () => {
    const tx = buildMockTx();
    await markOptOutInTx(tx as never, {
      orgId: 'org-1',
      phoneE164: '+393331234567',
      source: 'inbound_ivr',
    });
    await markOptOutInTx(tx as never, {
      orgId: 'org-1',
      phoneE164: '+393331234567',
      source: 'inbound_ivr',
    });
    expect(tx._inserts).toHaveLength(2);
    expect(tx._inserts.every((i) => i.conflictBranch === 'doNothing')).toBe(true);
    // Audit fires both times for traceability per Task 5 spec
    expect(mockRecordAudit).toHaveBeenCalledTimes(2);
  });
});

// ─── Tests: markOptOut (transaction-managing wrapper) ────────────────────────

describe('markOptOut', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWithOrgContext.mockImplementation((_orgId: string, fn: (tx: unknown) => unknown) =>
      fn(buildMockTx()),
    );
  });

  it('runs inside withOrgContext and emits the returned events', async () => {
    await markOptOut('org-1', '+393331234567', 'dealer_input');

    expect(mockWithOrgContext).toHaveBeenCalledWith('org-1', expect.any(Function));
    expect(mockSendInngestEvents).toHaveBeenCalledOnce();
    const sent = mockSendInngestEvents.mock.calls[0]?.[0] as Array<{ name: string }>;
    expect(sent).toHaveLength(1);
    expect(sent[0]?.name).toBe(COMPLIANCE_OPT_OUT_REGISTERED_EVENT);

    expect(mockSendInngestEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'webhook/emit',
        data: expect.objectContaining({ eventType: 'contact.opted_out' }),
      }),
    );
  });

  it('forwards optional fields through to the audit + event', async () => {
    await markOptOut('org-1', '+393331234567', 'call_outcome', {
      reason: 'manual review',
      actorUserId: 'user-1',
      callId: 'call-9',
    });

    const auditCall = mockRecordAudit.mock.calls[0]!;
    expect(auditCall[1]).toMatchObject({
      actorUserId: 'user-1',
      metadata: expect.objectContaining({ reason: 'manual review', callId: 'call-9' }),
    });

    const sent = mockSendInngestEvents.mock.calls[0]?.[0] as Array<{
      data: Record<string, unknown>;
    }>;
    expect(sent[0]?.data).toMatchObject({
      reason: 'manual review',
      actorUserId: 'user-1',
      callId: 'call-9',
    });
  });
});

// ─── Tests: bulkMarkOptOut ───────────────────────────────────────────────────

describe('bulkMarkOptOut', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('no-ops on empty list', async () => {
    await bulkMarkOptOut('org-1', [], 'dealer_input');
    expect(mockWithOrgContext).not.toHaveBeenCalled();
    expect(mockSendInngestEvents).not.toHaveBeenCalled();
  });

  it('inserts every phone in one batch and emits one event per phone', async () => {
    const txs: ReturnType<typeof buildMockTx>[] = [];
    mockWithOrgContext.mockImplementation((_orgId: string, fn: (tx: unknown) => unknown) => {
      const tx = buildMockTx();
      txs.push(tx);
      return fn(tx);
    });

    const phones = ['+393331111111', '+393332222222', '+393333333333'];
    await bulkMarkOptOut('org-1', phones, 'dealer_input', { actorUserId: 'user-1' });

    // Single batch (all under 500 phones)
    expect(txs).toHaveLength(1);
    expect(txs[0]?._inserts).toHaveLength(1);
    expect(txs[0]?._inserts[0]?.values).toEqual(
      phones.map((p) => ({ org_id: 'org-1', phone_e164: p, source: 'dealer_input' })),
    );
    expect(txs[0]?._inserts[0]?.conflictBranch).toBe('doNothing');
    expect(txs[0]?._updates).toHaveLength(1);
    expect(txs[0]?._updates[0]?.setArg).toEqual({
      opt_out: true,
      opt_out_reason: 'dealer_input',
    });

    // Aggregate audit row (one per batch)
    expect(mockRecordAudit).toHaveBeenCalledOnce();
    expect(mockRecordAudit.mock.calls[0]?.[1]).toMatchObject({
      action: 'opt_out.recorded',
      actorUserId: 'user-1',
      metadata: expect.objectContaining({
        source: 'dealer_input',
        count: phones.length,
        bulk: true,
      }),
    });

    // Two sendInngestEvents calls: one for compliance events, one for webhook emit events
    expect(mockSendInngestEvents).toHaveBeenCalledTimes(2);
    const complianceSent = mockSendInngestEvents.mock.calls[0]?.[0] as Array<{
      data: { phoneE164: string; source: OptOutSource };
    }>;
    expect(complianceSent).toHaveLength(phones.length);
    expect(complianceSent.every((e) => e.data.source === 'dealer_input')).toBe(true);
    expect(complianceSent.map((e) => e.data.phoneE164).sort()).toEqual([...phones].sort());

    const webhookSent = mockSendInngestEvents.mock.calls[1]?.[0] as Array<{
      name: string;
      data: { eventType: string; orgId: string };
    }>;
    expect(webhookSent).toHaveLength(phones.length);
    expect(webhookSent.every((e) => e.name === 'webhook/emit')).toBe(true);
    expect(webhookSent.every((e) => e.data.eventType === 'contact.opted_out')).toBe(true);
  });

  it('chunks bulk inserts at 500 phones per batch', async () => {
    const txs: ReturnType<typeof buildMockTx>[] = [];
    mockWithOrgContext.mockImplementation((_orgId: string, fn: (tx: unknown) => unknown) => {
      const tx = buildMockTx();
      txs.push(tx);
      return fn(tx);
    });

    const phones = Array.from({ length: 1200 }, (_, i) =>
      `+39333${String(i).padStart(7, '0')}`,
    );
    await bulkMarkOptOut('org-1', phones, 'dealer_input');

    // 500 + 500 + 200 = 3 batches
    expect(txs).toHaveLength(3);
    // First call = compliance events (1200 events), second call = webhook emit events
    expect(mockSendInngestEvents).toHaveBeenCalledTimes(2);
    const complianceSent = mockSendInngestEvents.mock.calls[0]?.[0] as Array<unknown>;
    expect(complianceSent).toHaveLength(1200);
    const webhookSent = mockSendInngestEvents.mock.calls[1]?.[0] as Array<unknown>;
    expect(webhookSent).toHaveLength(1200);
  });
});
