import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockWithSystemContext, mockRecordAudit } = vi.hoisted(() => ({
  mockWithSystemContext: vi.fn(),
  mockRecordAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/db/context', () => ({
  withSystemContext: mockWithSystemContext,
}));

vi.mock('@/lib/db/audit', () => ({
  recordAudit: mockRecordAudit,
}));

vi.mock('@/lib/db/schema', () => ({
  auditLog: {
    id: 'k_id',
    org_id: 'k_org_id',
    actor_user_id: 'k_actor_user_id',
    action: 'k_action',
    metadata: 'k_metadata',
    created_at: 'k_created_at',
  },
}));

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ type: 'and', args }),
  eq: (col: unknown, val: unknown) => ({ type: 'eq', col, val }),
  desc: (col: unknown) => ({ type: 'desc', col }),
}));

import {
  CURRENT_DPA_VERSION,
  DPA_ACCEPTED_ACTION,
  getDpaStatus,
  getLatestDpaAcceptance,
  recordDpaAcceptance,
} from './dpa';

const ORG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
const USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001';

interface SelectChain {
  rows: Array<{
    created_at: Date;
    actor_user_id: string | null;
    metadata: Record<string, unknown> | null;
  }>;
}

function buildTx(chain: SelectChain) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue(chain.rows),
          })),
        })),
      })),
    })),
  };
}

beforeEach(() => {
  mockWithSystemContext.mockReset();
  mockRecordAudit.mockReset();
  mockRecordAudit.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// recordDpaAcceptance
// ---------------------------------------------------------------------------

describe('recordDpaAcceptance', () => {
  it('writes a compliance.dpa_accepted audit row with the current version, ip and user-agent', async () => {
    const captured: { tx: unknown }[] = [];
    mockWithSystemContext.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = { tag: 'system-tx' };
      captured.push({ tx });
      return fn(tx);
    });

    const result = await recordDpaAcceptance({
      orgId: ORG_ID,
      userId: USER_ID,
      ip: '203.0.113.1',
      userAgent: 'Mozilla/5.0',
    });

    expect(result.version).toBe(CURRENT_DPA_VERSION);
    expect(result.ip).toBe('203.0.113.1');
    expect(result.user_agent).toBe('Mozilla/5.0');
    expect(result.accepted_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    expect(mockRecordAudit).toHaveBeenCalledOnce();
    expect(mockRecordAudit).toHaveBeenCalledWith(
      captured[0]!.tx,
      expect.objectContaining({
        orgId: ORG_ID,
        actorUserId: USER_ID,
        actorType: 'user',
        action: DPA_ACCEPTED_ACTION,
        subjectType: 'organization',
        subjectId: ORG_ID,
        metadata: expect.objectContaining({
          version: CURRENT_DPA_VERSION,
          ip: '203.0.113.1',
          user_agent: 'Mozilla/5.0',
        }),
      }),
    );
  });

  it('uses the supplied transaction when provided (no fresh withSystemContext)', async () => {
    const tx = { tag: 'caller-tx' };
    await recordDpaAcceptance({
      orgId: ORG_ID,
      userId: USER_ID,
      ip: null,
      userAgent: null,
      tx: tx as never,
    });

    expect(mockWithSystemContext).not.toHaveBeenCalled();
    expect(mockRecordAudit).toHaveBeenCalledWith(tx, expect.anything());
  });

  it('honors a custom version when supplied', async () => {
    mockWithSystemContext.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({}),
    );

    const result = await recordDpaAcceptance({
      orgId: ORG_ID,
      userId: USER_ID,
      ip: null,
      userAgent: null,
      version: '2027-06-01',
    });

    expect(result.version).toBe('2027-06-01');
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        metadata: expect.objectContaining({ version: '2027-06-01' }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// getLatestDpaAcceptance
// ---------------------------------------------------------------------------

describe('getLatestDpaAcceptance', () => {
  it('returns null when there is no acceptance row', async () => {
    mockWithSystemContext.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(buildTx({ rows: [] })),
    );

    const result = await getLatestDpaAcceptance(ORG_ID);
    expect(result).toBeNull();
  });

  it('returns the most recent acceptance with parsed metadata', async () => {
    const createdAt = new Date('2026-04-01T10:00:00.000Z');
    mockWithSystemContext.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(
        buildTx({
          rows: [
            {
              created_at: createdAt,
              actor_user_id: USER_ID,
              metadata: {
                version: '2026-01-01',
                accepted_at: '2026-04-01T10:00:00.000Z',
                ip: '203.0.113.5',
                user_agent: 'Test UA',
              },
            },
          ],
        }),
      ),
    );

    const result = await getLatestDpaAcceptance(ORG_ID);
    expect(result).toEqual({
      acceptedAt: createdAt.toISOString(),
      version: '2026-01-01',
      acceptedByUserId: USER_ID,
      ip: '203.0.113.5',
      userAgent: 'Test UA',
    });
  });

  it('falls back to "unknown" version when metadata.version is missing', async () => {
    mockWithSystemContext.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(
        buildTx({
          rows: [
            {
              created_at: new Date('2026-04-01T10:00:00.000Z'),
              actor_user_id: USER_ID,
              metadata: {},
            },
          ],
        }),
      ),
    );

    const result = await getLatestDpaAcceptance(ORG_ID);
    expect(result?.version).toBe('unknown');
    expect(result?.ip).toBeNull();
    expect(result?.userAgent).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getDpaStatus
// ---------------------------------------------------------------------------

describe('getDpaStatus', () => {
  it('returns never_accepted when no row exists', async () => {
    mockWithSystemContext.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(buildTx({ rows: [] })),
    );

    const status = await getDpaStatus(ORG_ID);
    expect(status).toEqual({ state: 'never_accepted', currentVersion: CURRENT_DPA_VERSION });
  });

  it('returns current when latest version matches CURRENT_DPA_VERSION', async () => {
    mockWithSystemContext.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(
        buildTx({
          rows: [
            {
              created_at: new Date('2026-04-01T10:00:00.000Z'),
              actor_user_id: USER_ID,
              metadata: { version: CURRENT_DPA_VERSION },
            },
          ],
        }),
      ),
    );

    const status = await getDpaStatus(ORG_ID);
    expect(status.state).toBe('current');
  });

  it('returns outdated when latest version differs from CURRENT_DPA_VERSION', async () => {
    mockWithSystemContext.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(
        buildTx({
          rows: [
            {
              created_at: new Date('2025-12-01T10:00:00.000Z'),
              actor_user_id: USER_ID,
              metadata: { version: '2024-01-01' },
            },
          ],
        }),
      ),
    );

    const status = await getDpaStatus(ORG_ID);
    expect(status.state).toBe('outdated');
    if (status.state === 'outdated') {
      expect(status.currentVersion).toBe(CURRENT_DPA_VERSION);
      expect(status.record.version).toBe('2024-01-01');
    }
  });
});
