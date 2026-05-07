import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Hoisted mocks ───────────────────────────────────────────────────────────

const {
  mockWithOrgContext,
  mockRecordAudit,
  mockMarkOptOutInTx,
  mockSendInngestEvents,
  mockSupabaseAdmin,
  mockRemove,
} = vi.hoisted(() => {
  const mockRemove = vi.fn();
  const mockSupabaseAdmin = {
    storage: {
      from: vi.fn(() => ({ remove: mockRemove })),
    },
  };
  return {
    mockWithOrgContext: vi.fn(),
    mockRecordAudit: vi.fn().mockResolvedValue(undefined),
    mockMarkOptOutInTx: vi.fn().mockResolvedValue([]),
    mockSendInngestEvents: vi.fn().mockResolvedValue(undefined),
    mockSupabaseAdmin,
    mockRemove,
  };
});

vi.mock('@/lib/db/context', () => ({
  withOrgContext: mockWithOrgContext,
}));

vi.mock('@/lib/db/audit', () => ({
  recordAudit: mockRecordAudit,
}));

vi.mock('@/lib/services/optout', () => ({
  markOptOutInTx: mockMarkOptOutInTx,
}));

vi.mock('@/lib/inngest/client', () => ({
  sendInngestEvents: mockSendInngestEvents,
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: mockSupabaseAdmin,
}));

vi.mock('@/lib/voice/persistence', () => ({
  CALL_MEDIA_BUCKET: 'call-media',
}));

vi.mock('@/lib/db/schema', () => ({
  contacts: {
    org_id: 'c_org_id',
    id: 'c_id',
    phone_e164: 'c_phone_e164',
    email: 'c_email',
    deleted_at: 'c_deleted_at',
  },
  calls: {
    org_id: 'l_org_id',
    contact_id: 'l_contact_id',
    id: 'l_id',
    recording_path: 'l_recording_path',
    transcript_path: 'l_transcript_path',
  },
}));

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ type: 'and', args }),
  or: (...args: unknown[]) => ({ type: 'or', args }),
  eq: (col: unknown, val: unknown) => ({ type: 'eq', col, val }),
  isNull: (col: unknown) => ({ type: 'isNull', col }),
}));

// ─── Imports after mocks ─────────────────────────────────────────────────────

import {
  COMPLIANCE_GDPR_ERASURE_EVENT,
  eraseSubject,
  SubjectErasureConfirmationError,
  SubjectNotFoundError,
} from './erase';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ORG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
const CONTACT_ID = 'cccccccc-cccc-4ccc-8ccc-000000000001';
const CALL_ID = 'dddddddd-dddd-4ddd-8ddd-000000000001';
const PHONE = '+393331234567';
const USER_ID = 'user-1';

interface FakeContact {
  id: string;
  org_id: string;
  phone_e164: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  metadata: Record<string, unknown> | null;
  deleted_at: Date | null;
}

interface FakeCallRow {
  id: string;
  recording_path: string | null;
  transcript_path: string | null;
}

interface TxState {
  contact: FakeContact | null;
  callRows: FakeCallRow[];
  contactUpdates: Array<{ set: Record<string, unknown> }>;
  callUpdates: Array<{ set: Record<string, unknown> }>;
}

function buildTx(state: TxState): unknown {
  return {
    select: vi.fn((columns?: unknown) => {
      // Two select shapes:
      //   tx.select() — used to read the contact row (no columns arg)
      //   tx.select({...}) — used to read the call rows
      const isCallRowQuery = columns !== undefined;
      return {
        from: vi.fn((table: unknown) => {
          const tableId = (table as { org_id?: string }).org_id;
          const where = vi.fn(() => {
            if (isCallRowQuery && tableId === 'l_org_id') {
              return Promise.resolve(state.callRows);
            }
            // Contact lookup uses .where(...).limit(1)
            const limit = vi.fn(() =>
              Promise.resolve(state.contact ? [state.contact] : []),
            );
            return { limit };
          });
          return { where };
        }),
      };
    }),
    update: vi.fn((table: unknown) => {
      const tableId = (table as { org_id?: string }).org_id;
      return {
        set: (s: Record<string, unknown>) => {
          if (tableId === 'c_org_id') state.contactUpdates.push({ set: s });
          else if (tableId === 'l_org_id') state.callUpdates.push({ set: s });
          return { where: vi.fn(() => Promise.resolve(undefined)) };
        },
      };
    }),
  };
}

function makeContact(overrides: Partial<FakeContact> = {}): FakeContact {
  return {
    id: CONTACT_ID,
    org_id: ORG_ID,
    phone_e164: PHONE,
    first_name: 'Mario',
    last_name: 'Rossi',
    email: 'mario@example.com',
    metadata: { source: 'csv-upload', other: 'value' },
    deleted_at: null,
    ...overrides,
  };
}

function makeState(overrides: Partial<TxState> = {}): TxState {
  return {
    contact: makeContact(),
    callRows: [],
    contactUpdates: [],
    callUpdates: [],
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('eraseSubject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMarkOptOutInTx.mockResolvedValue([]);
    mockRemove.mockResolvedValue({ data: [], error: null });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('throws SubjectNotFoundError when no contact matches', async () => {
    const state = makeState({ contact: null });
    mockWithOrgContext.mockImplementation(
      async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(buildTx(state)),
    );

    await expect(
      eraseSubject({
        orgId: ORG_ID,
        byUserId: USER_ID,
        identifier: PHONE,
        reason: 'subject request',
        confirmPhone: PHONE,
      }),
    ).rejects.toBeInstanceOf(SubjectNotFoundError);

    expect(mockMarkOptOutInTx).not.toHaveBeenCalled();
    expect(mockRecordAudit).not.toHaveBeenCalled();
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('throws SubjectErasureConfirmationError when confirmPhone does not match the contact phone', async () => {
    const state = makeState();
    mockWithOrgContext.mockImplementation(
      async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(buildTx(state)),
    );

    await expect(
      eraseSubject({
        orgId: ORG_ID,
        byUserId: USER_ID,
        identifier: PHONE,
        reason: 'subject request',
        confirmPhone: '+390000000000',
      }),
    ).rejects.toBeInstanceOf(SubjectErasureConfirmationError);

    expect(state.contactUpdates).toHaveLength(0);
    expect(state.callUpdates).toHaveLength(0);
    expect(mockMarkOptOutInTx).not.toHaveBeenCalled();
  });

  it('scrubs the contact: nulls PII, sets deleted_at, stamps metadata.erased_at', async () => {
    const state = makeState();
    mockWithOrgContext.mockImplementation(
      async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(buildTx(state)),
    );

    await eraseSubject({
      orgId: ORG_ID,
      byUserId: USER_ID,
      identifier: PHONE,
      reason: 'subject request',
      confirmPhone: PHONE,
    });

    expect(state.contactUpdates).toHaveLength(1);
    const update = state.contactUpdates[0]!.set;
    expect(update['first_name']).toBeNull();
    expect(update['last_name']).toBeNull();
    expect(update['email']).toBeNull();
    expect(update['deleted_at']).toBeInstanceOf(Date);
    const meta = update['metadata'] as Record<string, unknown>;
    expect(meta['gdpr_erasure']).toBe(true);
    expect(typeof meta['erased_at']).toBe('string');
    expect(meta['erasure_reason']).toBe('subject request');
    // Existing metadata fields preserved (proves we merged rather than wiped)
    expect(meta['source']).toBe('csv-upload');
  });

  it('preserves phone_e164 on the contact row so opt_out_registry stays joinable', async () => {
    const state = makeState();
    mockWithOrgContext.mockImplementation(
      async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(buildTx(state)),
    );

    await eraseSubject({
      orgId: ORG_ID,
      byUserId: USER_ID,
      identifier: PHONE,
      reason: 'subject request',
      confirmPhone: PHONE,
    });

    const update = state.contactUpdates[0]!.set;
    expect(update).not.toHaveProperty('phone_e164');
  });

  it('tombstones every call.metadata referencing the contact', async () => {
    const state = makeState({
      callRows: [
        {
          id: CALL_ID,
          recording_path: `recordings/${ORG_ID}/${CALL_ID}.mp3`,
          transcript_path: `transcripts/${ORG_ID}/${CALL_ID}.json`,
        },
      ],
    });
    mockWithOrgContext.mockImplementation(
      async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(buildTx(state)),
    );

    await eraseSubject({
      orgId: ORG_ID,
      byUserId: USER_ID,
      identifier: PHONE,
      reason: 'subject request',
      confirmPhone: PHONE,
    });

    expect(state.callUpdates).toHaveLength(1);
    const meta = state.callUpdates[0]!.set['metadata'] as Record<string, unknown>;
    expect(meta['gdpr_erasure']).toBe(true);
    expect(typeof meta['erased_at']).toBe('string');
  });

  it('does not run a calls update when the contact has no calls', async () => {
    const state = makeState({ callRows: [] });
    mockWithOrgContext.mockImplementation(
      async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(buildTx(state)),
    );

    await eraseSubject({
      orgId: ORG_ID,
      byUserId: USER_ID,
      identifier: PHONE,
      reason: 'subject request',
      confirmPhone: PHONE,
    });

    expect(state.callUpdates).toHaveLength(0);
  });

  it('records the org-wide opt-out via markOptOutInTx with source gdpr_request', async () => {
    const state = makeState();
    mockWithOrgContext.mockImplementation(
      async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(buildTx(state)),
    );

    await eraseSubject({
      orgId: ORG_ID,
      byUserId: USER_ID,
      identifier: PHONE,
      reason: 'subject request',
      confirmPhone: PHONE,
    });

    expect(mockMarkOptOutInTx).toHaveBeenCalledTimes(1);
    expect(mockMarkOptOutInTx.mock.calls[0]?.[1]).toMatchObject({
      orgId: ORG_ID,
      phoneE164: PHONE,
      source: 'gdpr_request',
      actorUserId: USER_ID,
      actorType: 'user',
      reason: 'subject request',
    });
  });

  it('writes a compliance.gdpr_erasure audit entry with totals and identifier', async () => {
    const state = makeState({
      callRows: [
        { id: CALL_ID, recording_path: null, transcript_path: null },
      ],
    });
    mockWithOrgContext.mockImplementation(
      async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(buildTx(state)),
    );

    await eraseSubject({
      orgId: ORG_ID,
      byUserId: USER_ID,
      identifier: PHONE,
      reason: 'subject request',
      confirmPhone: PHONE,
    });

    expect(mockRecordAudit).toHaveBeenCalledTimes(1);
    const args = mockRecordAudit.mock.calls[0]?.[1] as {
      action: string;
      subjectType: string;
      subjectId: string;
      actorUserId: string;
      actorType: string;
      orgId: string;
      metadata: Record<string, unknown>;
    };
    expect(args.action).toBe('compliance.gdpr_erasure');
    expect(args.subjectType).toBe('contact');
    expect(args.subjectId).toBe(CONTACT_ID);
    expect(args.actorUserId).toBe(USER_ID);
    expect(args.actorType).toBe('user');
    expect(args.orgId).toBe(ORG_ID);
    expect(args.metadata['identifier']).toBe(PHONE);
    expect(args.metadata['reason']).toBe('subject request');
    expect(args.metadata['phoneE164']).toBe(PHONE);
    expect(args.metadata['callCount']).toBe(1);
  });

  it('deletes recording and transcript storage objects after the DB tx commits', async () => {
    const state = makeState({
      callRows: [
        {
          id: CALL_ID,
          recording_path: `recordings/${ORG_ID}/${CALL_ID}.mp3`,
          transcript_path: `transcripts/${ORG_ID}/${CALL_ID}.json`,
        },
        {
          id: 'second-call',
          recording_path: `recordings/${ORG_ID}/second-call.mp3`,
          transcript_path: null,
        },
      ],
    });
    mockWithOrgContext.mockImplementation(
      async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(buildTx(state)),
    );
    mockRemove
      .mockResolvedValueOnce({ data: [{ name: 'a' }, { name: 'b' }], error: null })
      .mockResolvedValueOnce({ data: [{ name: 'c' }], error: null });

    const result = await eraseSubject({
      orgId: ORG_ID,
      byUserId: USER_ID,
      identifier: PHONE,
      reason: 'subject request',
      confirmPhone: PHONE,
    });

    expect(mockRemove).toHaveBeenCalledTimes(2);
    expect(mockRemove.mock.calls[0]?.[0]).toEqual([
      `recordings/${ORG_ID}/${CALL_ID}.mp3`,
      `recordings/${ORG_ID}/second-call.mp3`,
    ]);
    expect(mockRemove.mock.calls[1]?.[0]).toEqual([
      `transcripts/${ORG_ID}/${CALL_ID}.json`,
    ]);
    expect(result.totals).toEqual({
      callsScrubbed: 2,
      recordingsDeleted: 2,
      transcriptsDeleted: 1,
      storageErrors: 0,
    });
  });

  it('counts storage errors but does not throw when storage delete fails', async () => {
    const state = makeState({
      callRows: [
        {
          id: CALL_ID,
          recording_path: `recordings/${ORG_ID}/${CALL_ID}.mp3`,
          transcript_path: `transcripts/${ORG_ID}/${CALL_ID}.json`,
        },
      ],
    });
    mockWithOrgContext.mockImplementation(
      async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(buildTx(state)),
    );
    mockRemove
      .mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
      .mockResolvedValueOnce({ data: [{ name: 't' }], error: null });

    const result = await eraseSubject({
      orgId: ORG_ID,
      byUserId: USER_ID,
      identifier: PHONE,
      reason: 'subject request',
      confirmPhone: PHONE,
    });

    expect(result.totals.recordingsDeleted).toBe(0);
    expect(result.totals.transcriptsDeleted).toBe(1);
    expect(result.totals.storageErrors).toBe(1);
  });

  it('emits the optOutInTx events and the compliance/gdpr-erasure event after commit', async () => {
    const state = makeState();
    mockWithOrgContext.mockImplementation(
      async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(buildTx(state)),
    );
    const optOutEvent = {
      name: 'compliance/opt-out-registered',
      data: { orgId: ORG_ID, phoneE164: PHONE, source: 'gdpr_request' },
      id: 'opt-out-x',
    };
    mockMarkOptOutInTx.mockResolvedValue([optOutEvent]);

    await eraseSubject({
      orgId: ORG_ID,
      byUserId: USER_ID,
      identifier: PHONE,
      reason: 'subject request',
      confirmPhone: PHONE,
    });

    expect(mockSendInngestEvents).toHaveBeenCalledTimes(1);
    const sent = mockSendInngestEvents.mock.calls[0]?.[0] as Array<{
      name: string;
      id?: string;
      data: Record<string, unknown>;
    }>;
    expect(sent).toHaveLength(2);
    expect(sent[0]).toEqual(optOutEvent);
    expect(sent[1]?.name).toBe(COMPLIANCE_GDPR_ERASURE_EVENT);
    expect(sent[1]?.id).toBe(`gdpr-erasure-${ORG_ID}-${CONTACT_ID}`);
    expect(sent[1]?.data).toMatchObject({
      orgId: ORG_ID,
      contactId: CONTACT_ID,
      phoneE164: PHONE,
      byUserId: USER_ID,
      reason: 'subject request',
    });
  });

  it('looks up by email when identifier contains @', async () => {
    let capturedConditions: unknown = null;
    const contact = makeContact({ email: 'mario@example.com' });
    mockWithOrgContext.mockImplementation(
      async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          select: vi.fn((columns?: unknown) => {
            const isCallRowQuery = columns !== undefined;
            return {
              from: vi.fn(() => {
                const where = vi.fn((cond: unknown) => {
                  if (!isCallRowQuery) {
                    capturedConditions = cond;
                    return { limit: vi.fn(() => Promise.resolve([contact])) };
                  }
                  return Promise.resolve([]);
                });
                return { where };
              }),
            };
          }),
          update: vi.fn(() => ({
            set: () => ({ where: vi.fn(() => Promise.resolve(undefined)) }),
          })),
        };
        return fn(tx);
      },
    );

    await eraseSubject({
      orgId: ORG_ID,
      byUserId: USER_ID,
      identifier: 'mario@example.com',
      reason: 'subject request',
      confirmPhone: PHONE,
    });

    const cond = capturedConditions as { type: string; args: Array<unknown> };
    expect(cond.type).toBe('or');
    expect(cond.args).toHaveLength(2);
  });
});
