import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockWithSystemContext } = vi.hoisted(() => ({
  mockWithSystemContext: vi.fn(),
}));

vi.mock('@/lib/db/context', () => ({
  withSystemContext: mockWithSystemContext,
}));

vi.mock('@/lib/db/schema', () => ({
  organizations: {
    id: 'o_id',
    recording_retention_days: 'o_retention',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown) => ({ type: 'eq', col, val }),
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import {
  AUDIT_LOG_RETENTION_DAYS,
  buildPolicy,
  DEFAULT_RECORDING_RETENTION_DAYS,
  getRetentionThresholds,
  policyToThresholds,
  RECORDING_RETENTION_DAYS_MAX,
  RECORDING_RETENTION_DAYS_MIN,
  SOFT_DELETED_CONTACT_PURGE_DAYS,
  TRANSCRIPT_RETENTION_DAYS,
} from './retention';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ORG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
const NOW = new Date('2026-05-08T10:00:00.000Z');

function buildTx(retentionDays: number | null, found = true) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () =>
            found ? [{ recording_retention_days: retentionDays }] : [],
          ),
        })),
      })),
    })),
  };
}

beforeEach(() => {
  mockWithSystemContext.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('retention constants', () => {
  it('matches spec §12.4 windows', () => {
    expect(DEFAULT_RECORDING_RETENTION_DAYS).toBe(365);
    expect(TRANSCRIPT_RETENTION_DAYS).toBe(730);
    expect(AUDIT_LOG_RETENTION_DAYS).toBe(2555);
    expect(SOFT_DELETED_CONTACT_PURGE_DAYS).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// buildPolicy
// ---------------------------------------------------------------------------

describe('buildPolicy', () => {
  it('returns the platform default when no override is provided', () => {
    expect(buildPolicy(null).recordingDays).toBe(DEFAULT_RECORDING_RETENTION_DAYS);
    expect(buildPolicy(undefined).recordingDays).toBe(DEFAULT_RECORDING_RETENTION_DAYS);
  });

  it('respects a valid per-org override', () => {
    expect(buildPolicy(90).recordingDays).toBe(90);
    expect(buildPolicy(180).recordingDays).toBe(180);
  });

  it('clamps to the platform default when the override is outside the allowed range', () => {
    expect(buildPolicy(0).recordingDays).toBe(DEFAULT_RECORDING_RETENTION_DAYS);
    expect(buildPolicy(-5).recordingDays).toBe(DEFAULT_RECORDING_RETENTION_DAYS);
    expect(
      buildPolicy(RECORDING_RETENTION_DAYS_MAX + 1).recordingDays,
    ).toBe(DEFAULT_RECORDING_RETENTION_DAYS);
  });

  it('accepts the boundary values', () => {
    expect(buildPolicy(RECORDING_RETENTION_DAYS_MIN).recordingDays).toBe(
      RECORDING_RETENTION_DAYS_MIN,
    );
    expect(buildPolicy(RECORDING_RETENTION_DAYS_MAX).recordingDays).toBe(
      RECORDING_RETENTION_DAYS_MAX,
    );
  });

  it('floors fractional inputs', () => {
    expect(buildPolicy(120.7).recordingDays).toBe(120);
  });

  it('always returns the platform-fixed values for non-recording windows', () => {
    const policy = buildPolicy(42);
    expect(policy.transcriptDays).toBe(TRANSCRIPT_RETENTION_DAYS);
    expect(policy.auditLogDays).toBe(AUDIT_LOG_RETENTION_DAYS);
    expect(policy.softDeletedContactDays).toBe(SOFT_DELETED_CONTACT_PURGE_DAYS);
  });
});

// ---------------------------------------------------------------------------
// policyToThresholds
// ---------------------------------------------------------------------------

describe('policyToThresholds', () => {
  it('subtracts the policy windows from `now` to compute cutoffs', () => {
    const policy = buildPolicy(null);
    const t = policyToThresholds(ORG_ID, policy, NOW);

    expect(t.orgId).toBe(ORG_ID);
    expect(t.policy).toBe(policy);

    const oneDay = 24 * 60 * 60 * 1000;
    expect(NOW.getTime() - t.recordingCutoff.getTime()).toBe(
      DEFAULT_RECORDING_RETENTION_DAYS * oneDay,
    );
    expect(NOW.getTime() - t.transcriptCutoff.getTime()).toBe(
      TRANSCRIPT_RETENTION_DAYS * oneDay,
    );
    expect(NOW.getTime() - t.auditLogCutoff.getTime()).toBe(
      AUDIT_LOG_RETENTION_DAYS * oneDay,
    );
    expect(NOW.getTime() - t.softDeletedContactCutoff.getTime()).toBe(
      SOFT_DELETED_CONTACT_PURGE_DAYS * oneDay,
    );
  });

  it('uses the per-org override when present', () => {
    const policy = buildPolicy(60);
    const t = policyToThresholds(ORG_ID, policy, NOW);
    const oneDay = 24 * 60 * 60 * 1000;
    expect(NOW.getTime() - t.recordingCutoff.getTime()).toBe(60 * oneDay);
  });

  it('defaults `now` to the current time when omitted', () => {
    const before = Date.now();
    const t = policyToThresholds(ORG_ID, buildPolicy(null));
    const after = Date.now();
    const recordingMs =
      DEFAULT_RECORDING_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    expect(t.recordingCutoff.getTime()).toBeGreaterThanOrEqual(before - recordingMs);
    expect(t.recordingCutoff.getTime()).toBeLessThanOrEqual(after - recordingMs);
  });
});

// ---------------------------------------------------------------------------
// getRetentionThresholds
// ---------------------------------------------------------------------------

describe('getRetentionThresholds', () => {
  it('reads the per-org override via withSystemContext when no tx is provided', async () => {
    mockWithSystemContext.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(buildTx(90)),
    );

    const t = await getRetentionThresholds(ORG_ID, { now: NOW });

    expect(mockWithSystemContext).toHaveBeenCalledTimes(1);
    expect(t.policy.recordingDays).toBe(90);
    const oneDay = 24 * 60 * 60 * 1000;
    expect(NOW.getTime() - t.recordingCutoff.getTime()).toBe(90 * oneDay);
  });

  it('falls back to the platform default when override is null', async () => {
    mockWithSystemContext.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(buildTx(null)),
    );

    const t = await getRetentionThresholds(ORG_ID, { now: NOW });
    expect(t.policy.recordingDays).toBe(DEFAULT_RECORDING_RETENTION_DAYS);
  });

  it('uses the supplied tx without opening a new system context', async () => {
    const tx = buildTx(120);
    const t = await getRetentionThresholds(ORG_ID, {
      now: NOW,
      tx: tx as unknown as Parameters<typeof getRetentionThresholds>[1] extends
        | { tx?: infer T }
        | undefined
        ? T
        : never,
    });

    expect(mockWithSystemContext).not.toHaveBeenCalled();
    expect(t.policy.recordingDays).toBe(120);
  });

  it('throws when the org row is missing', async () => {
    mockWithSystemContext.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(buildTx(null, /* found */ false)),
    );
    await expect(getRetentionThresholds(ORG_ID)).rejects.toThrow(/not found/);
  });
});
