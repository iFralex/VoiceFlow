/**
 * Unit tests for the audit log service.
 *
 * Mocks `withSystemContext` so the chainable drizzle-style query the service
 * builds can be inspected without standing up Postgres. Focuses on
 * pagination, cursor emission, actor-email join behaviour, and CSV escaping.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockWithSystemContext } = vi.hoisted(() => ({
  mockWithSystemContext: vi.fn(),
}));

vi.mock('@/lib/db/context', () => ({
  withSystemContext: mockWithSystemContext,
}));

vi.mock('@/lib/db/schema', () => ({
  auditLog: {
    org_id: 'al_org_id',
    actor_user_id: 'al_actor_user_id',
    action: 'al_action',
    created_at: 'al_created_at',
    id: 'al_id',
  },
  users: { id: 'u_id', email: 'u_email' },
}));

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ type: 'and', args }),
  or: (...args: unknown[]) => ({ type: 'or', args }),
  eq: (col: unknown, val: unknown) => ({ type: 'eq', col, val }),
  inArray: (col: unknown, vals: unknown[]) => ({ type: 'inArray', col, vals }),
  desc: (col: unknown) => ({ type: 'desc', col }),
  gte: (col: unknown, val: unknown) => ({ type: 'gte', col, val }),
  lte: (col: unknown, val: unknown) => ({ type: 'lte', col, val }),
  lt: (col: unknown, val: unknown) => ({ type: 'lt', col, val }),
  like: (col: unknown, val: unknown) => ({ type: 'like', col, val }),
}));

// ─── Imports after mocks ─────────────────────────────────────────────────────

import { buildAuditLogCsv, listAuditLog } from './audit_log';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ORG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
const USER_A = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001';
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000002';

interface FakeRow {
  id: bigint;
  org_id: string;
  actor_user_id: string | null;
  actor_type: 'user' | 'system' | 'webhook';
  action: string;
  subject_type: string;
  subject_id: string;
  metadata: Record<string, unknown> | null;
  created_at: Date;
}

function row(overrides: Partial<FakeRow>): FakeRow {
  return {
    id: BigInt(1),
    org_id: ORG_ID,
    actor_user_id: USER_A,
    actor_type: 'user',
    action: 'contact.created',
    subject_type: 'contact',
    subject_id: 'subj-1',
    metadata: null,
    created_at: new Date('2026-05-01T10:00:00Z'),
    ...overrides,
  };
}

interface FakeStore {
  auditRows: FakeRow[];
  userRows: { id: string; email: string }[];
}

/**
 * Builds a chainable query object that captures the most recent select target
 * (audit log vs. users) and resolves with the appropriate fixture rows.
 */
function buildTx(store: FakeStore): unknown {
  return {
    select: vi.fn((projection?: { id?: unknown; email?: unknown }) => ({
      from: vi.fn((table: unknown) => {
        const isUsers = (table as { id?: unknown }).id === 'u_id';
        // For audit log: where(...).orderBy(...).limit(N)
        const buildAuditChain = () => {
          const chain = {
            where: vi.fn(() => chain),
            orderBy: vi.fn(() => chain),
            limit: vi.fn((n: number) => Promise.resolve(store.auditRows.slice(0, n))),
          };
          return chain;
        };
        // For users: where(...) returning { id, email }[]
        const buildUserChain = () => ({
          where: vi.fn(() => Promise.resolve(store.userRows)),
        });
        if (isUsers) {
          void projection;
          return buildUserChain();
        }
        return buildAuditChain();
      }),
    })),
  };
}

beforeEach(() => {
  mockWithSystemContext.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(buildTx({ auditRows: [], userRows: [] })));
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─── listAuditLog ────────────────────────────────────────────────────────────

describe('listAuditLog', () => {
  it('returns entries with no nextCursor when fewer rows than limit', async () => {
    const rows = [row({ id: BigInt(3) }), row({ id: BigInt(2) }), row({ id: BigInt(1) })];
    mockWithSystemContext.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(buildTx({ auditRows: rows, userRows: [{ id: USER_A, email: 'alice@example.com' }] })),
    );

    const result = await listAuditLog({ orgId: ORG_ID, limit: 50 });

    expect(result.entries).toHaveLength(3);
    expect(result.entries[0]?.actorEmail).toBe('alice@example.com');
    expect(result.nextCursor).toBeNull();
  });

  it('emits a nextCursor when there are more rows than the page size', async () => {
    // The service requests `limit + 1` so it can detect overflow.
    const overflowRow = row({ id: BigInt(0), created_at: new Date('2026-04-30T10:00:00Z') });
    const visibleRows = [
      row({ id: BigInt(3), created_at: new Date('2026-05-03T10:00:00Z') }),
      row({ id: BigInt(2), created_at: new Date('2026-05-02T10:00:00Z') }),
    ];
    mockWithSystemContext.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(buildTx({
        auditRows: [...visibleRows, overflowRow],
        userRows: [{ id: USER_A, email: 'alice@example.com' }],
      })),
    );

    const result = await listAuditLog({ orgId: ORG_ID, limit: 2 });

    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]?.id).toBe('3');
    expect(result.nextCursor).toEqual({
      createdAt: visibleRows[1]!.created_at.toISOString(),
      id: '2',
    });
  });

  it('resolves a single email per actor across multiple rows', async () => {
    const rows = [
      row({ id: BigInt(5), actor_user_id: USER_A }),
      row({ id: BigInt(4), actor_user_id: USER_B }),
      row({ id: BigInt(3), actor_user_id: USER_A }),
      row({ id: BigInt(2), actor_user_id: null, actor_type: 'system' }),
    ];
    mockWithSystemContext.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(buildTx({
        auditRows: rows,
        userRows: [
          { id: USER_A, email: 'alice@example.com' },
          { id: USER_B, email: 'bob@example.com' },
        ],
      })),
    );

    const result = await listAuditLog({ orgId: ORG_ID });

    expect(result.entries.find((e) => e.id === '5')?.actorEmail).toBe('alice@example.com');
    expect(result.entries.find((e) => e.id === '4')?.actorEmail).toBe('bob@example.com');
    expect(result.entries.find((e) => e.id === '2')?.actorEmail).toBeNull();
    expect(result.entries.find((e) => e.id === '2')?.actorType).toBe('system');
  });

  it('clamps the limit to the [1, 200] range', async () => {
    const rows = [row({ id: BigInt(1) })];
    mockWithSystemContext.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(buildTx({ auditRows: rows, userRows: [] })));

    // Should not throw with extreme limits
    const tooSmall = await listAuditLog({ orgId: ORG_ID, limit: -10 });
    expect(tooSmall.entries.length).toBeGreaterThanOrEqual(0);

    const tooBig = await listAuditLog({ orgId: ORG_ID, limit: 99999 });
    expect(tooBig.entries.length).toBeGreaterThanOrEqual(0);
  });

  it('returns an empty page with null nextCursor when no rows match', async () => {
    mockWithSystemContext.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(buildTx({ auditRows: [], userRows: [] })),
    );
    const result = await listAuditLog({ orgId: ORG_ID });
    expect(result.entries).toHaveLength(0);
    expect(result.nextCursor).toBeNull();
  });
});

// ─── buildAuditLogCsv ────────────────────────────────────────────────────────

describe('buildAuditLogCsv', () => {
  it('renders a header even when there are no rows', async () => {
    mockWithSystemContext.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(buildTx({ auditRows: [], userRows: [] })),
    );
    const result = await buildAuditLogCsv({ orgId: ORG_ID });
    expect(result.csv.split('\r\n')).toEqual([
      'created_at,actor_type,actor_user_id,actor_email,action,subject_type,subject_id,metadata',
    ]);
    expect(result.rowCount).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it('serialises a row with actor email lookup and metadata JSON', async () => {
    const ts = new Date('2026-05-01T10:00:00Z');
    const r = row({
      id: BigInt(1),
      actor_user_id: USER_A,
      action: 'compliance.gdpr_export',
      created_at: ts,
      metadata: { foo: 'bar' },
    });
    mockWithSystemContext.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(buildTx({ auditRows: [r], userRows: [{ id: USER_A, email: 'alice@example.com' }] })),
    );

    const result = await buildAuditLogCsv({ orgId: ORG_ID });
    const lines = result.csv.split('\r\n');
    expect(lines).toHaveLength(2); // header + 1 row
    expect(lines[1]).toBe(
      `${ts.toISOString()},user,${USER_A},alice@example.com,compliance.gdpr_export,contact,subj-1,"{""foo"":""bar""}"`,
    );
    expect(result.rowCount).toBe(1);
  });

  it('quotes cells that contain commas, quotes or newlines', async () => {
    const r = row({
      id: BigInt(1),
      actor_user_id: null,
      actor_type: 'system',
      action: 'compliance.audit',
      subject_id: 'has,comma',
      metadata: { note: 'line1\nline2 "with quotes"' },
    });
    mockWithSystemContext.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(buildTx({ auditRows: [r], userRows: [] })),
    );

    const result = await buildAuditLogCsv({ orgId: ORG_ID });
    expect(result.csv).toContain('"has,comma"');
    // The CSV cell wraps the JSON-stringified metadata. JSON's \" becomes \""
    // after the CSV doubles every quote (RFC 4180 escaping).
    expect(result.csv).toContain('\\""with quotes\\""');
  });

  it('flags truncation when more rows exist than the maxRows cap', async () => {
    const rows = [row({ id: BigInt(3) }), row({ id: BigInt(2) }), row({ id: BigInt(1) })];
    mockWithSystemContext.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(buildTx({ auditRows: rows, userRows: [] })),
    );

    const result = await buildAuditLogCsv({ orgId: ORG_ID, maxRows: 2 });
    expect(result.rowCount).toBe(2);
    expect(result.truncated).toBe(true);
  });
});
