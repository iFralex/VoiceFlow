import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockWithSystemContext,
  mockBulkCheck,
  mockGetRpoClient,
  mockRecordAudit,
  mockSendInngestEvents,
  mockEnv,
} = vi.hoisted(() => {
  const mockBulkCheck = vi.fn();
  const mockGetRpoClient = vi.fn(() => ({ bulkCheck: mockBulkCheck, singleCheck: vi.fn() }));
  const mockWithSystemContext = vi.fn();
  const mockRecordAudit = vi.fn().mockResolvedValue(undefined);
  const mockSendInngestEvents = vi.fn().mockResolvedValue(undefined);
  const mockEnv = { CRON_SECRET: 'test-cron-secret-16chars' };
  return {
    mockWithSystemContext,
    mockBulkCheck,
    mockGetRpoClient,
    mockRecordAudit,
    mockSendInngestEvents,
    mockEnv,
  };
});

vi.mock('@/lib/db/context', () => ({
  withSystemContext: mockWithSystemContext,
}));

vi.mock('@/lib/db/audit', () => ({
  recordAudit: mockRecordAudit,
}));

vi.mock('@/lib/inngest/client', () => ({
  sendInngestEvents: mockSendInngestEvents,
}));

vi.mock('@/lib/compliance/rpo/client', () => ({
  getRpoClient: mockGetRpoClient,
}));

vi.mock('@/lib/env', () => ({
  env: mockEnv,
}));

vi.mock('@/lib/db/schema', () => ({
  contacts: {
    id: 'c_id',
    org_id: 'c_org_id',
    phone_e164: 'c_phone_e164',
    contact_type: 'c_contact_type',
    rpo_status: 'c_rpo_status',
    rpo_checked_at: 'c_rpo_checked_at',
    opt_out: 'c_opt_out',
    opt_out_reason: 'c_opt_out_reason',
    deleted_at: 'c_deleted_at',
  },
  rpoSnapshots: {
    phone_e164: 's_phone_e164',
    is_blocked: 's_is_blocked',
    last_checked_at: 's_last_checked_at',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown) => ({ type: 'eq', col, val }),
  and: (...args: unknown[]) => ({ type: 'and', args: args.filter((a) => a !== undefined) }),
  or: (...args: unknown[]) => ({ type: 'or', args: args.filter((a) => a !== undefined) }),
  lt: (col: unknown, val: unknown) => ({ type: 'lt', col, val }),
  gt: (col: unknown, val: unknown) => ({ type: 'gt', col, val }),
  isNull: (col: unknown) => ({ type: 'isNull', col }),
  inArray: (col: unknown, vals: unknown[]) => ({ type: 'inArray', col, vals }),
  sql: Object.assign(
    (strings: TemplateStringsArray) => ({ type: 'sql', text: strings.join('') }),
    { raw: (s: string) => s },
  ),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { GET, RPO_BLOCK_DETECTED_EVENT, runRpoSnapshot } from './route';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CRON_SECRET = 'test-cron-secret-16chars';
const ORG_ID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
const ORG_ID_B = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002';
const CONTACT_ID_1 = 'cccccccc-cccc-4ccc-8ccc-000000000001';
const CONTACT_ID_2 = 'cccccccc-cccc-4ccc-8ccc-000000000002';
const PHONE_BLOCKED = '+393331112222';
const PHONE_CLEAR = '+393331113333';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(secret?: string): Request {
  return new Request('http://localhost/api/cron/rpo-snapshot', {
    method: 'GET',
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });
}

interface UpdateRecorder {
  setArg?: Record<string, unknown>;
  whereArg?: unknown;
  returningRows: unknown[];
}

interface InsertRecorder {
  values?: unknown;
  conflict?: { target?: unknown; set?: unknown };
}

interface ChunkPlan {
  candidates?: string[];
  prior?: Array<{ phone_e164: string; is_blocked: boolean }>;
  affectedAfterUpdate?: Array<{ id: string; org_id: string; phone_e164: string }>;
  contactsUpdateRows?: { clear: string[]; blocked: string[] };
}

function buildTx(plan: ChunkPlan, captured: { inserts: InsertRecorder[]; updates: UpdateRecorder[] }): unknown {
  return {
    selectDistinct: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue(
              (plan.candidates ?? []).map((p) => ({ phone_e164: p })),
            ),
          })),
        })),
      })),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue(plan.prior ?? plan.affectedAfterUpdate ?? []),
      })),
    })),
    insert: vi.fn(() => {
      const recorder: InsertRecorder = {};
      captured.inserts.push(recorder);
      return {
        values: (v: unknown) => {
          recorder.values = v;
          return {
            onConflictDoUpdate: (cfg: { target: unknown; set: unknown }) => {
              recorder.conflict = cfg;
              return Promise.resolve(undefined);
            },
          };
        },
      };
    }),
    update: vi.fn(() => {
      const recorder: UpdateRecorder = { returningRows: [] };
      captured.updates.push(recorder);
      return {
        set: (s: Record<string, unknown>) => {
          recorder.setArg = s;
          return {
            where: (w: unknown) => {
              recorder.whereArg = w;
              const isBlockedUpdate =
                (s.rpo_status as unknown) === 'blocked' ||
                (typeof s.opt_out !== 'undefined');
              const rows = isBlockedUpdate
                ? (plan.contactsUpdateRows?.blocked ?? []).map((id) => ({ id }))
                : (plan.contactsUpdateRows?.clear ?? []).map((id) => ({ id }));
              recorder.returningRows = rows;
              return {
                returning: () => Promise.resolve(rows),
              };
            },
          };
        },
      };
    }),
    insertAudit: undefined,
  };
}

function queueChunkPlans(plans: ChunkPlan[], captured: { inserts: InsertRecorder[]; updates: UpdateRecorder[] }) {
  // Each chunk uses several withSystemContext calls. We sequence them via a
  // single tx-builder per call using captured plan state per chunk.
  // Order per chunk:
  //   1. fetchCandidatePhones      → selectDistinct
  //   2. fetchPriorBlockedMap      → select
  //   3. persistChunk              → insert + updates (single tx)
  //   4. emitRpoBlockEvents        → select
  // Final call: audit recordAudit (single tx)

  const queue: Array<(fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>> = [];

  for (const plan of plans) {
    // 1. candidates
    const candidates = plan.candidates ?? [];
    queue.push(async (fn) => fn(buildTx({ candidates }, captured)));
    if (candidates.length === 0) continue;
    // 2. prior
    queue.push(async (fn) => fn(buildTx({ prior: plan.prior ?? [] }, captured)));
    // 3. persist (insert + updates)
    queue.push(async (fn) => fn(buildTx(plan, captured)));
    // 4. emit (only when there are newly-blocked phones — runRpoSnapshot only
    //    invokes withSystemContext here when newlyBlocked.length > 0)
    if ((plan.affectedAfterUpdate ?? []).length > 0 || plan.affectedAfterUpdate !== undefined) {
      queue.push(async (fn) =>
        fn(buildTx({ affectedAfterUpdate: plan.affectedAfterUpdate ?? [] }, captured)),
      );
    }
  }

  // audit
  queue.push(async (fn) => fn(buildTx({}, captured)));

  mockWithSystemContext.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
    const handler = queue.shift();
    if (!handler) throw new Error('withSystemContext called more times than expected');
    return handler(fn);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/cron/rpo-snapshot — auth', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockEnv.CRON_SECRET = CRON_SECRET;
    mockGetRpoClient.mockReturnValue({ bulkCheck: mockBulkCheck, singleCheck: vi.fn() });
    mockBulkCheck.mockResolvedValue(new Map());
  });

  afterEach(() => {
    mockEnv.CRON_SECRET = CRON_SECRET;
  });

  it('returns 401 when Authorization header is missing', async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('Unauthorized');
  });

  it('returns 401 when bearer token does not match CRON_SECRET', async () => {
    const res = await GET(makeRequest('wrong-secret-16chars-x'));
    expect(res.status).toBe(401);
  });

  it('returns 200 and runs the snapshot on a valid request', async () => {
    queueChunkPlans([{ candidates: [] }], { inserts: [], updates: [] });
    const res = await GET(makeRequest(CRON_SECRET));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean };
    expect(json.ok).toBe(true);
  });
});

describe('runRpoSnapshot', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockEnv.CRON_SECRET = CRON_SECRET;
    mockGetRpoClient.mockReturnValue({ bulkCheck: mockBulkCheck, singleCheck: vi.fn() });
  });

  it('returns zeros and writes an audit entry when no candidates exist', async () => {
    queueChunkPlans([{ candidates: [] }], { inserts: [], updates: [] });

    const result = await runRpoSnapshot();

    expect(result).toEqual({
      chunks: 0,
      totalChecked: 0,
      totalBlocked: 0,
      totalContactsUpdated: 0,
      totalNewlyBlockedContacts: 0,
      errors: 0,
    });
    expect(mockBulkCheck).not.toHaveBeenCalled();
    expect(mockSendInngestEvents).not.toHaveBeenCalled();
    expect(mockRecordAudit).toHaveBeenCalledOnce();
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorType: 'system',
        action: 'compliance.rpo_snapshot_completed',
        subjectType: 'rpo',
        subjectId: 'daily',
      }),
    );
  });

  it('updates contacts to clear when bulkCheck returns is_blocked=false', async () => {
    const captured = { inserts: [] as InsertRecorder[], updates: [] as UpdateRecorder[] };
    queueChunkPlans(
      [
        {
          candidates: [PHONE_CLEAR],
          prior: [],
          contactsUpdateRows: { clear: [CONTACT_ID_1], blocked: [] },
        },
      ],
      captured,
    );
    mockBulkCheck.mockResolvedValueOnce(new Map([[PHONE_CLEAR, false]]));

    const result = await runRpoSnapshot();

    expect(result.totalChecked).toBe(1);
    expect(result.totalBlocked).toBe(0);
    expect(result.totalContactsUpdated).toBe(1);
    expect(result.totalNewlyBlockedContacts).toBe(0);
    expect(mockSendInngestEvents).not.toHaveBeenCalled();
    // Insert recorded into rpo_snapshots with is_blocked=false
    expect(captured.inserts).toHaveLength(1);
    expect(captured.inserts[0]?.values).toEqual([
      expect.objectContaining({ phone_e164: PHONE_CLEAR, is_blocked: false }),
    ]);
    // Update payload: clear + rpo_checked_at; no opt_out fields touched
    const clearUpdate = captured.updates.find(
      (u) => (u.setArg as { rpo_status?: string } | undefined)?.rpo_status === 'clear',
    );
    expect(clearUpdate).toBeDefined();
    expect(clearUpdate?.setArg).toMatchObject({ rpo_status: 'clear' });
    expect(clearUpdate?.setArg).not.toHaveProperty('opt_out');
  });

  it('flags newly-blocked contacts and emits one event per affected contact', async () => {
    const captured = { inserts: [] as InsertRecorder[], updates: [] as UpdateRecorder[] };
    queueChunkPlans(
      [
        {
          candidates: [PHONE_BLOCKED],
          prior: [], // no previous snapshot → unchecked → blocked is a transition
          contactsUpdateRows: { clear: [], blocked: [CONTACT_ID_1, CONTACT_ID_2] },
          affectedAfterUpdate: [
            { id: CONTACT_ID_1, org_id: ORG_ID_A, phone_e164: PHONE_BLOCKED },
            { id: CONTACT_ID_2, org_id: ORG_ID_B, phone_e164: PHONE_BLOCKED },
          ],
        },
      ],
      captured,
    );
    mockBulkCheck.mockResolvedValueOnce(new Map([[PHONE_BLOCKED, true]]));

    const result = await runRpoSnapshot();

    expect(result.totalChecked).toBe(1);
    expect(result.totalBlocked).toBe(1);
    expect(result.totalContactsUpdated).toBe(2);
    expect(result.totalNewlyBlockedContacts).toBe(2);

    // contacts.update sets opt_out=true and reason rpo_block
    const blockedUpdate = captured.updates.find(
      (u) => (u.setArg as { rpo_status?: string } | undefined)?.rpo_status === 'blocked',
    );
    expect(blockedUpdate?.setArg).toMatchObject({
      rpo_status: 'blocked',
      opt_out: true,
      opt_out_reason: 'rpo_block',
    });

    expect(mockSendInngestEvents).toHaveBeenCalledOnce();
    const events = mockSendInngestEvents.mock.calls[0]?.[0] as Array<{
      name: string;
      data: { orgId: string; contactId: string; phoneE164: string };
      id?: string;
    }>;
    expect(events).toHaveLength(2);
    expect(events[0]?.name).toBe(RPO_BLOCK_DETECTED_EVENT);
    expect(events.map((e) => e.data.orgId).sort()).toEqual([ORG_ID_A, ORG_ID_B].sort());
    expect(events.every((e) => e.data.phoneE164 === PHONE_BLOCKED)).toBe(true);
    expect(events.every((e) => typeof e.id === 'string' && e.id!.startsWith('rpo-block-'))).toBe(true);
  });

  it('does NOT emit a transition event when the prior snapshot is already blocked', async () => {
    const captured = { inserts: [] as InsertRecorder[], updates: [] as UpdateRecorder[] };
    queueChunkPlans(
      [
        {
          candidates: [PHONE_BLOCKED],
          prior: [{ phone_e164: PHONE_BLOCKED, is_blocked: true }],
          contactsUpdateRows: { clear: [], blocked: [CONTACT_ID_1] },
        },
      ],
      captured,
    );
    mockBulkCheck.mockResolvedValueOnce(new Map([[PHONE_BLOCKED, true]]));

    const result = await runRpoSnapshot();

    expect(result.totalBlocked).toBe(1);
    expect(result.totalNewlyBlockedContacts).toBe(0);
    expect(mockSendInngestEvents).not.toHaveBeenCalled();
  });

  it('counts a chunk error and continues without crashing', async () => {
    const captured = { inserts: [] as InsertRecorder[], updates: [] as UpdateRecorder[] };
    queueChunkPlans(
      [
        {
          candidates: [PHONE_CLEAR],
          prior: [],
          contactsUpdateRows: { clear: [CONTACT_ID_1], blocked: [] },
        },
      ],
      captured,
    );
    mockBulkCheck.mockRejectedValueOnce(new Error('intermediary down'));

    const result = await runRpoSnapshot();

    expect(result.errors).toBe(1);
    expect(result.totalChecked).toBe(0);
    // Audit still recorded
    expect(mockRecordAudit).toHaveBeenCalledOnce();
  });

  it('uses the injected RpoClient instead of the env-based factory', async () => {
    const captured = { inserts: [] as InsertRecorder[], updates: [] as UpdateRecorder[] };
    queueChunkPlans(
      [
        {
          candidates: [PHONE_CLEAR],
          prior: [],
          contactsUpdateRows: { clear: [CONTACT_ID_1], blocked: [] },
        },
      ],
      captured,
    );
    const injected = {
      bulkCheck: vi.fn().mockResolvedValue(new Map([[PHONE_CLEAR, false]])),
      singleCheck: vi.fn(),
    };

    await runRpoSnapshot(injected);

    expect(injected.bulkCheck).toHaveBeenCalledOnce();
    expect(mockGetRpoClient).not.toHaveBeenCalled();
  });
});
