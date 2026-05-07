import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockWithSystemContext,
  mockGetRetentionThresholds,
  mockRecordAudit,
  mockStorageRemove,
  mockEnv,
} = vi.hoisted(() => {
  const mockStorageRemove = vi.fn();
  return {
    mockWithSystemContext: vi.fn(),
    mockGetRetentionThresholds: vi.fn(),
    mockRecordAudit: vi.fn().mockResolvedValue(undefined),
    mockStorageRemove,
    mockEnv: { CRON_SECRET: 'test-cron-secret-16chars' },
  };
});

vi.mock('@/lib/db/context', () => ({
  withSystemContext: mockWithSystemContext,
}));

vi.mock('@/lib/db/audit', () => ({
  recordAudit: mockRecordAudit,
}));

vi.mock('@/lib/compliance/retention', () => ({
  getRetentionThresholds: mockGetRetentionThresholds,
}));

vi.mock('@/lib/env', () => ({
  env: mockEnv,
}));

vi.mock('@/lib/voice/persistence', () => ({
  CALL_MEDIA_BUCKET: 'call-media',
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    storage: {
      from: vi.fn(() => ({
        remove: mockStorageRemove,
      })),
    },
  },
}));

vi.mock('@/lib/db/schema', () => ({
  organizations: { id: 'o_id', deleted_at: 'o_deleted_at' },
  calls: {
    id: 'c_id',
    org_id: 'c_org_id',
    contact_id: 'c_contact_id',
    recording_path: 'c_recording_path',
    transcript_path: 'c_transcript_path',
    created_at: 'c_created_at',
  },
  contacts: {
    id: 'k_id',
    org_id: 'k_org_id',
    deleted_at: 'k_deleted_at',
    legal_hold_until: 'k_legal_hold_until',
  },
}));

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ type: 'and', args: args.filter((a) => a !== undefined) }),
  eq: (col: unknown, val: unknown) => ({ type: 'eq', col, val }),
  gt: (col: unknown, val: unknown) => ({ type: 'gt', col, val }),
  inArray: (col: unknown, vals: unknown[]) => ({ type: 'inArray', col, vals }),
  isNull: (col: unknown) => ({ type: 'isNull', col }),
  isNotNull: (col: unknown) => ({ type: 'isNotNull', col }),
  lt: (col: unknown, val: unknown) => ({ type: 'lt', col, val }),
  notInArray: (col: unknown, vals: unknown[]) => ({ type: 'notInArray', col, vals }),
  or: (...args: unknown[]) => ({ type: 'or', args: args.filter((a) => a !== undefined) }),
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { GET, runRetentionPurge } from './route';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CRON_SECRET = 'test-cron-secret-16chars';
const NOW = new Date('2026-05-08T03:00:00.000Z');
const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
const ORG_B = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002';

const RECORDING_CUTOFF = new Date('2025-05-08T03:00:00.000Z');
const TRANSCRIPT_CUTOFF = new Date('2024-05-08T03:00:00.000Z');
const SOFT_DELETED_CONTACT_CUTOFF = new Date('2026-04-08T03:00:00.000Z');

// ---------------------------------------------------------------------------
// Helpers — tx builders
// ---------------------------------------------------------------------------

interface UpdateRecorder {
  setArg?: Record<string, unknown>;
  whereArg?: unknown;
  returningRows: unknown[];
}

interface DeleteRecorder {
  whereArg?: unknown;
  returningRows: unknown[];
}

interface SelectRecorder {
  whereArg?: unknown;
}

interface SelectResult {
  rows: unknown[];
}

interface TxPlan {
  select?: SelectResult; // generic select-from-where(-limit)
  update?: { rows: unknown[] };
  delete?: { rows: unknown[] };
}

interface Captured {
  inserts: unknown[];
  selects: SelectRecorder[];
  updates: UpdateRecorder[];
  deletes: DeleteRecorder[];
}

function buildTx(plan: TxPlan, captured: Captured): unknown {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn((...args: unknown[]) => {
          captured.selects.push({ whereArg: args[0] });
          return {
            // resolves both `await chain.where(...)` and `chain.where(...).limit(N)`
            then: (resolve: (v: unknown) => void) => resolve(plan.select?.rows ?? []),
            limit: vi.fn().mockResolvedValue(plan.select?.rows ?? []),
          };
        }),
      })),
    })),
    update: vi.fn(() => {
      const recorder: UpdateRecorder = { returningRows: [] };
      captured.updates.push(recorder);
      return {
        set: (s: Record<string, unknown>) => {
          recorder.setArg = s;
          return {
            where: (w: unknown) => {
              recorder.whereArg = w;
              const rows = plan.update?.rows ?? [];
              recorder.returningRows = rows;
              return {
                returning: () => Promise.resolve(rows),
              };
            },
          };
        },
      };
    }),
    delete: vi.fn(() => {
      const recorder: DeleteRecorder = { returningRows: [] };
      captured.deletes.push(recorder);
      return {
        where: (w: unknown) => {
          recorder.whereArg = w;
          const rows = plan.delete?.rows ?? [];
          recorder.returningRows = rows;
          return {
            returning: () => Promise.resolve(rows),
          };
        },
      };
    }),
    insert: vi.fn(() => {
      captured.inserts.push({});
      return {
        values: () => Promise.resolve(undefined),
      };
    }),
  };
}

interface OrgPlan {
  orgId: string;
  /** Contact IDs returned by the held-contacts lookup (empty by default). */
  heldContactIds?: string[];
  recordings?: Array<{ id: string; path: string }>; // expired calls with recording paths
  transcripts?: Array<{ id: string; path: string }>; // expired calls with transcript paths
  recordingsClearedRows?: Array<{ id: string }>; // returning rows from update set recording_path=null
  transcriptsClearedRows?: Array<{ id: string }>; // returning rows from update set transcript_path=null
  hardDeletedContacts?: Array<{ id: string }>;
  /** When true, simulate a storage error on the recordings batch. */
  recordingsStorageError?: boolean;
  /** When true, simulate a storage error on the transcripts batch. */
  transcriptsStorageError?: boolean;
}

function queueOrgPlans(plans: OrgPlan[], captured: Captured) {
  const queue: Array<(fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>> = [];

  // 1. Initial fetchOrgIds
  queue.push(async (fn) =>
    fn(buildTx({ select: { rows: plans.map((p) => ({ id: p.orgId })) } }, captured)),
  );

  for (const plan of plans) {
    // Per-org: getRetentionThresholds is mocked at the import boundary, so it
    // does not invoke withSystemContext from inside this test's queue.
    //
    // Per-org sequence inside `purgeOrg`:
    //   held contacts:
    //     - fetchHeldContactIds (select) → always one query
    //   recordings:
    //     - fetchExpiredCalls (select) → only invoked when previous chunk == BATCH_SIZE
    //     - clearArtifactColumn (update) → only when storage delete succeeded
    //   transcripts: same pattern
    //   contacts hard-delete:
    //     - delete returning ids
    //
    // The route loops chunks until rows.length < ARTIFACT_BATCH_SIZE. Our test
    // chunks are always small (<500), so each artifact column gets exactly
    // ONE select + (optionally) ONE update per org.

    // held contacts (legal hold)
    queue.push(async (fn) =>
      fn(buildTx({ select: { rows: (plan.heldContactIds ?? []).map((id) => ({ id })) } }, captured)),
    );

    // recordings
    queue.push(async (fn) => fn(buildTx({ select: { rows: plan.recordings ?? [] } }, captured)));
    if ((plan.recordings ?? []).length > 0 && !plan.recordingsStorageError) {
      queue.push(async (fn) =>
        fn(buildTx({ update: { rows: plan.recordingsClearedRows ?? plan.recordings ?? [] } }, captured)),
      );
    }

    // transcripts
    queue.push(async (fn) => fn(buildTx({ select: { rows: plan.transcripts ?? [] } }, captured)));
    if ((plan.transcripts ?? []).length > 0 && !plan.transcriptsStorageError) {
      queue.push(async (fn) =>
        fn(
          buildTx(
            { update: { rows: plan.transcriptsClearedRows ?? plan.transcripts ?? [] } },
            captured,
          ),
        ),
      );
    }

    // contacts hard-delete
    queue.push(async (fn) =>
      fn(buildTx({ delete: { rows: plan.hardDeletedContacts ?? [] } }, captured)),
    );
  }

  // Final close-out audit
  queue.push(async (fn) => fn(buildTx({}, captured)));

  mockWithSystemContext.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
    const handler = queue.shift();
    if (!handler) {
      throw new Error('withSystemContext called more times than expected');
    }
    return handler(fn);
  });

  for (const plan of plans) {
    mockGetRetentionThresholds.mockResolvedValueOnce({
      orgId: plan.orgId,
      policy: {
        recordingDays: 365,
        transcriptDays: 730,
        auditLogDays: 2555,
        softDeletedContactDays: 30,
      },
      recordingCutoff: RECORDING_CUTOFF,
      transcriptCutoff: TRANSCRIPT_CUTOFF,
      auditLogCutoff: new Date('2019-05-08T03:00:00.000Z'),
      softDeletedContactCutoff: SOFT_DELETED_CONTACT_CUTOFF,
    });
  }
}

function makeRequest(secret?: string): Request {
  return new Request('http://localhost/api/cron/retention-purge', {
    method: 'GET',
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mockEnv.CRON_SECRET = CRON_SECRET;
  mockStorageRemove.mockResolvedValue({ data: [], error: null });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

describe('GET /api/cron/retention-purge — auth', () => {
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

  it('returns 200 and runs the purge on a valid request', async () => {
    queueOrgPlans([], { inserts: [], selects: [], updates: [], deletes: [] });
    const res = await GET(makeRequest(CRON_SECRET));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean };
    expect(json.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// runRetentionPurge
// ---------------------------------------------------------------------------

describe('runRetentionPurge', () => {
  it('returns zeros and writes an audit entry when no orgs exist', async () => {
    queueOrgPlans([], { inserts: [], selects: [], updates: [], deletes: [] });

    const result = await runRetentionPurge(NOW);

    expect(result).toEqual({
      orgsProcessed: 0,
      totalRecordingsDeleted: 0,
      totalTranscriptsDeleted: 0,
      totalStorageErrors: 0,
      totalContactsHardDeleted: 0,
      errors: 0,
    });
    expect(mockStorageRemove).not.toHaveBeenCalled();
    expect(mockRecordAudit).toHaveBeenCalledOnce();
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorType: 'system',
        action: 'compliance.retention_purge_completed',
        subjectType: 'retention',
        subjectId: 'daily',
        metadata: expect.objectContaining({
          orgsProcessed: 0,
          totalRecordingsDeleted: 0,
          totalTranscriptsDeleted: 0,
          totalContactsHardDeleted: 0,
          errors: 0,
        }),
      }),
    );
  });

  it('purges expired recordings and transcripts and clears their columns', async () => {
    const captured: Captured = { inserts: [], selects: [], updates: [], deletes: [] };
    queueOrgPlans(
      [
        {
          orgId: ORG_A,
          recordings: [
            { id: 'call-1', path: 'recordings/aaa/call-1.mp3' },
            { id: 'call-2', path: 'recordings/aaa/call-2.mp3' },
          ],
          transcripts: [{ id: 'call-3', path: 'transcripts/aaa/call-3.json' }],
          hardDeletedContacts: [],
        },
      ],
      captured,
    );

    const result = await runRetentionPurge(NOW);

    expect(result.orgsProcessed).toBe(1);
    expect(result.totalRecordingsDeleted).toBe(2);
    expect(result.totalTranscriptsDeleted).toBe(1);
    expect(result.totalStorageErrors).toBe(0);
    expect(result.totalContactsHardDeleted).toBe(0);
    expect(result.errors).toBe(0);

    // Two storage.remove calls (one per artifact column).
    expect(mockStorageRemove).toHaveBeenCalledTimes(2);
    expect(mockStorageRemove).toHaveBeenNthCalledWith(1, [
      'recordings/aaa/call-1.mp3',
      'recordings/aaa/call-2.mp3',
    ]);
    expect(mockStorageRemove).toHaveBeenNthCalledWith(2, ['transcripts/aaa/call-3.json']);

    // Two updates: one nulling recording_path, one nulling transcript_path.
    expect(captured.updates).toHaveLength(2);
    const recordingClear = captured.updates.find(
      (u) => (u.setArg as { recording_path?: unknown }).recording_path === null,
    );
    const transcriptClear = captured.updates.find(
      (u) => (u.setArg as { transcript_path?: unknown }).transcript_path === null,
    );
    expect(recordingClear).toBeDefined();
    expect(transcriptClear).toBeDefined();
  });

  it('counts storage errors and skips DB clear when storage delete fails', async () => {
    const captured: Captured = { inserts: [], selects: [], updates: [], deletes: [] };
    queueOrgPlans(
      [
        {
          orgId: ORG_A,
          recordings: [{ id: 'call-1', path: 'recordings/aaa/call-1.mp3' }],
          recordingsStorageError: true,
          transcripts: [],
          hardDeletedContacts: [],
        },
      ],
      captured,
    );

    // First call (recordings) errors; second call would be transcripts (none).
    mockStorageRemove
      .mockResolvedValueOnce({ data: null, error: { message: 'simulated' } });

    const result = await runRetentionPurge(NOW);

    expect(result.totalRecordingsDeleted).toBe(0);
    expect(result.totalStorageErrors).toBe(1);
    expect(result.errors).toBe(0); // org-level success — only chunk-level storage failed
    // No DB clear update for recordings (storage failed).
    expect(
      captured.updates.find(
        (u) => (u.setArg as { recording_path?: unknown }).recording_path === null,
      ),
    ).toBeUndefined();
  });

  it('hard-deletes soft-deleted contacts past the grace period', async () => {
    const captured: Captured = { inserts: [], selects: [], updates: [], deletes: [] };
    queueOrgPlans(
      [
        {
          orgId: ORG_A,
          recordings: [],
          transcripts: [],
          hardDeletedContacts: [{ id: 'contact-1' }, { id: 'contact-2' }],
        },
      ],
      captured,
    );

    const result = await runRetentionPurge(NOW);

    expect(result.totalContactsHardDeleted).toBe(2);
    expect(captured.deletes).toHaveLength(1);
  });

  it('processes multiple orgs and aggregates totals', async () => {
    const captured: Captured = { inserts: [], selects: [], updates: [], deletes: [] };
    queueOrgPlans(
      [
        {
          orgId: ORG_A,
          recordings: [{ id: 'a1', path: 'recordings/a/a1.mp3' }],
          transcripts: [],
          hardDeletedContacts: [{ id: 'kc-a' }],
        },
        {
          orgId: ORG_B,
          recordings: [],
          transcripts: [{ id: 'b1', path: 'transcripts/b/b1.json' }],
          hardDeletedContacts: [{ id: 'kc-b1' }, { id: 'kc-b2' }],
        },
      ],
      captured,
    );

    const result = await runRetentionPurge(NOW);

    expect(result.orgsProcessed).toBe(2);
    expect(result.totalRecordingsDeleted).toBe(1);
    expect(result.totalTranscriptsDeleted).toBe(1);
    expect(result.totalContactsHardDeleted).toBe(3);
    expect(result.errors).toBe(0);
  });

  it('counts an org-level error and continues with the other orgs', async () => {
    const captured: Captured = { inserts: [], selects: [], updates: [], deletes: [] };
    queueOrgPlans(
      [
        { orgId: ORG_A }, // baseline (will succeed)
        { orgId: ORG_B, hardDeletedContacts: [{ id: 'kc-b' }] },
      ],
      captured,
    );

    // Make ORG_A blow up by rejecting its retention-thresholds lookup.
    mockGetRetentionThresholds.mockReset();
    mockGetRetentionThresholds.mockRejectedValueOnce(new Error('threshold lookup down'));
    mockGetRetentionThresholds.mockResolvedValueOnce({
      orgId: ORG_B,
      policy: {
        recordingDays: 365,
        transcriptDays: 730,
        auditLogDays: 2555,
        softDeletedContactDays: 30,
      },
      recordingCutoff: RECORDING_CUTOFF,
      transcriptCutoff: TRANSCRIPT_CUTOFF,
      auditLogCutoff: new Date('2019-05-08T03:00:00.000Z'),
      softDeletedContactCutoff: SOFT_DELETED_CONTACT_CUTOFF,
    });

    // The first org throws, so it consumes only the initial fetchOrgIds slot.
    // We need to drain the queue manually for this scenario — rebuild it with
    // only ORG_B's tx plan after the org list.
    const queue: Array<(fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>> = [];
    queue.push(async (fn) =>
      fn(buildTx({ select: { rows: [{ id: ORG_A }, { id: ORG_B }] } }, captured)),
    );
    // ORG_B: held contacts (empty), recordings (empty), transcripts (empty), hard-delete (1)
    queue.push(async (fn) => fn(buildTx({ select: { rows: [] } }, captured)));
    queue.push(async (fn) => fn(buildTx({ select: { rows: [] } }, captured)));
    queue.push(async (fn) => fn(buildTx({ select: { rows: [] } }, captured)));
    queue.push(async (fn) =>
      fn(buildTx({ delete: { rows: [{ id: 'kc-b' }] } }, captured)),
    );
    // Close-out audit
    queue.push(async (fn) => fn(buildTx({}, captured)));

    mockWithSystemContext.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const handler = queue.shift();
      if (!handler) {
        throw new Error('withSystemContext called more times than expected');
      }
      return handler(fn);
    });

    const result = await runRetentionPurge(NOW);

    expect(result.orgsProcessed).toBe(1);
    expect(result.totalContactsHardDeleted).toBe(1);
    expect(result.errors).toBe(1);
    // Audit still recorded with the partial totals.
    expect(mockRecordAudit).toHaveBeenCalledOnce();
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        metadata: expect.objectContaining({
          orgsProcessed: 1,
          totalContactsHardDeleted: 1,
          errors: 1,
        }),
      }),
    );
  });

  it('passes held contact ids through every artifact and contact query', async () => {
    const captured: Captured = { inserts: [], selects: [], updates: [], deletes: [] };
    queueOrgPlans(
      [
        {
          orgId: ORG_A,
          // Two contacts under active legal hold for this org.
          heldContactIds: ['held-contact-1', 'held-contact-2'],
          // The DB filter is what enforces the skip; here we verify the
          // exclusion clauses are wired into every where() invocation.
          recordings: [],
          transcripts: [],
          hardDeletedContacts: [],
        },
      ],
      captured,
    );

    await runRetentionPurge(NOW);

    // Exactly one delete (the hard-purge of soft-deleted contacts) and its
    // where() must include a `notInArray` clause excluding the held ids.
    expect(captured.deletes).toHaveLength(1);
    const deleteWhere = captured.deletes[0]!.whereArg as {
      type: string;
      args: Array<{ type: string; col?: unknown; vals?: unknown[] }>;
    };
    const deleteNotIn = deleteWhere.args.find((arg) => arg.type === 'notInArray');
    expect(deleteNotIn).toBeDefined();
    expect(deleteNotIn?.vals).toEqual(['held-contact-1', 'held-contact-2']);

    // Recordings and transcripts selects must each include the
    // `or(isNull(contact_id), notInArray(contact_id, [...heldIds]))` clause
    // that lets inbound IVR rows (no contact) purge while excluding any call
    // attached to a held contact.
    interface SelectAndArg {
      type: string;
      args: Array<{ type: string; args?: Array<{ type: string; vals?: unknown[] }> }>;
    }
    const artifactSelects = captured.selects
      .map((s) => s.whereArg as SelectAndArg)
      .filter((w) => w?.type === 'and');
    // Two artifact selects per org (recordings, transcripts) + the
    // hard-delete soft-deleted-contacts where (delete, captured separately).
    // The held-contacts and org-list selects use simpler where shapes.
    const artifactSelectsWithExclusion = artifactSelects.filter((sel) =>
      sel.args.some(
        (arg) => arg.type === 'or' && arg.args?.some((sub) => sub.type === 'notInArray'),
      ),
    );
    expect(artifactSelectsWithExclusion.length).toBeGreaterThanOrEqual(2);
  });
});
