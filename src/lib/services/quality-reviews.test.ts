/**
 * Unit tests for quality-reviews service — plan 14 task 16.
 *
 * DB context is mocked so tests focus on the sampling math and aggregation
 * logic without standing up Postgres. Integration tests would cover the SQL
 * queries; these tests verify the in-process bookkeeping.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { QaChecklist } from '@/lib/db/schema/qa_reviews';

// ── mock db/context ────────────────────────────────────────────────────────────

type TxFn<T> = (tx: typeof mockTx) => Promise<T>;

vi.mock('@/lib/db/context', () => ({
  withSystemContext: vi.fn((fn: TxFn<unknown>) => fn(mockTx)),
}));

// ── mock db/schema/qa_reviews ──────────────────────────────────────────────────
vi.mock('@/lib/db/schema/qa_reviews', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/db/schema/qa_reviews')>();
  return {
    ...real,
    qaReviews: { id: {}, call_id: {}, org_id: {}, status: {}, checklist: {}, sampled_at: {} },
  };
});

// ── mock db/schema/calls ────────────────────────────────────────────────────────
vi.mock('@/lib/db/schema/calls', () => ({
  calls: { id: {}, org_id: {}, campaign_id: {}, status: {}, created_at: {} },
}));

// ── mock drizzle-orm helpers ───────────────────────────────────────────────────
vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ and: args })),
  desc: vi.fn((col: unknown) => ({ desc: col })),
  eq: vi.fn((col: unknown, val: unknown) => ({ eq: [col, val] })),
  gte: vi.fn((col: unknown, val: unknown) => ({ gte: [col, val] })),
  lt: vi.fn((col: unknown, val: unknown) => ({ lt: [col, val] })),
  isNull: vi.fn((col: unknown) => ({ isNull: col })),
}));

// ── in-memory mock tx ──────────────────────────────────────────────────────────

let _eligibleRows: { id: string; org_id: string; campaign_id: string | null }[] = [];
let _insertedValues: unknown[] = [];
let _statsRows: { status: string; checklist: QaChecklist | null }[] = [];

const mockTx = {
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      leftJoin: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve(_eligibleRows)),
      })),
      where: vi.fn(() => Promise.resolve(_statsRows)),
    })),
  })),
  insert: vi.fn(() => ({
    values: vi.fn((rows: unknown[]) => {
      _insertedValues.push(...rows);
      const inserted = rows.map((_, i) => ({ id: BigInt(i) }));
      return {
        onConflictDoNothing: vi.fn(() => ({
          returning: vi.fn(() => Promise.resolve(inserted)),
        })),
      };
    }),
  })),
  update: vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve([])),
    })),
  })),
  innerJoin: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })),
};

beforeEach(() => {
  _eligibleRows = [];
  _insertedValues = [];
  _statsRows = [];
  vi.clearAllMocks();
  // Re-attach cleared mocks to preserved mockTx references
  mockTx.select.mockReturnValue({
    from: vi.fn(() => ({
      leftJoin: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve(_eligibleRows)),
      })),
      where: vi.fn(() => Promise.resolve(_statsRows)),
    })),
  });
  mockTx.insert.mockReturnValue({
    values: vi.fn((rows: unknown[]) => {
      _insertedValues.push(...rows);
      const inserted = rows.map((_, i) => ({ id: BigInt(i) }));
      return {
        onConflictDoNothing: vi.fn(() => ({
          returning: vi.fn(() => Promise.resolve(inserted)),
        })),
      };
    }),
  });
});

import { isQaReviewStatus, sampleCallsForQa, getWeeklyStats } from './quality-reviews';

// ── isQaReviewStatus ───────────────────────────────────────────────────────────

describe('isQaReviewStatus', () => {
  it('returns true for valid statuses', () => {
    expect(isQaReviewStatus('pending_review')).toBe(true);
    expect(isQaReviewStatus('ok')).toBe(true);
    expect(isQaReviewStatus('needs_improvement')).toBe(true);
  });

  it('returns false for invalid values', () => {
    expect(isQaReviewStatus('unknown')).toBe(false);
    expect(isQaReviewStatus(null)).toBe(false);
    expect(isQaReviewStatus(undefined)).toBe(false);
    expect(isQaReviewStatus('')).toBe(false);
    expect(isQaReviewStatus(42)).toBe(false);
  });
});

// ── sampleCallsForQa ───────────────────────────────────────────────────────────

describe('sampleCallsForQa', () => {
  it('returns 0 when no eligible calls exist', async () => {
    _eligibleRows = [];
    const count = await sampleCallsForQa(new Date('2026-05-10T00:00:00Z'));
    expect(count).toBe(0);
  });

  it('samples at least 1 call even when 1% rounds to 0', async () => {
    _eligibleRows = [
      { id: 'call-1', org_id: 'org-1', campaign_id: null },
      { id: 'call-2', org_id: 'org-1', campaign_id: null },
    ];
    const count = await sampleCallsForQa(new Date('2026-05-10T00:00:00Z'));
    expect(count).toBeGreaterThanOrEqual(1);
    expect(_insertedValues.length).toBeGreaterThanOrEqual(1);
  });

  it('samples exactly ceil(n * 0.01) calls for a large pool', async () => {
    _eligibleRows = Array.from({ length: 500 }, (_, i) => ({
      id: `call-${i}`,
      org_id: 'org-1',
      campaign_id: null,
    }));
    const count = await sampleCallsForQa(new Date('2026-05-10T00:00:00Z'));
    expect(count).toBe(Math.ceil(500 * 0.01)); // 5
    expect(_insertedValues).toHaveLength(5);
  });

  it('never samples more calls than are eligible', async () => {
    _eligibleRows = [{ id: 'call-single', org_id: 'org-1', campaign_id: null }];
    const count = await sampleCallsForQa(new Date('2026-05-10T00:00:00Z'));
    expect(count).toBeLessThanOrEqual(1);
  });

  it('inserts qa_review rows with pending_review status', async () => {
    _eligibleRows = [
      { id: 'call-a', org_id: 'org-x', campaign_id: 'camp-y' },
      { id: 'call-b', org_id: 'org-x', campaign_id: null },
    ];
    await sampleCallsForQa(new Date('2026-05-10T00:00:00Z'));
    for (const inserted of _insertedValues as { status: string }[]) {
      expect(inserted.status).toBe('pending_review');
    }
  });
});

// ── getWeeklyStats ─────────────────────────────────────────────────────────────

describe('getWeeklyStats', () => {
  it('returns zeros when no reviews exist', async () => {
    _statsRows = [];
    const stats = await getWeeklyStats();
    expect(stats.total).toBe(0);
    expect(stats.pending).toBe(0);
    expect(stats.ok).toBe(0);
    expect(stats.needsImprovement).toBe(0);
  });

  it('correctly counts status buckets', async () => {
    _statsRows = [
      { status: 'pending_review', checklist: null },
      { status: 'pending_review', checklist: null },
      { status: 'ok', checklist: null },
      { status: 'needs_improvement', checklist: null },
    ];
    const stats = await getWeeklyStats();
    expect(stats.total).toBe(4);
    expect(stats.pending).toBe(2);
    expect(stats.ok).toBe(1);
    expect(stats.needsImprovement).toBe(1);
  });

  it('aggregates checklist pass/fail counts', async () => {
    _statsRows = [
      {
        status: 'ok',
        checklist: {
          disclosure_verified: true,
          transcript_readable: true,
          outcome_correct: false,
          no_offensive: true,
          no_privacy_leak: null,
        },
      },
      {
        status: 'needs_improvement',
        checklist: {
          disclosure_verified: false,
          transcript_readable: true,
          outcome_correct: false,
          no_offensive: null,
          no_privacy_leak: false,
        },
      },
    ];
    const stats = await getWeeklyStats();
    expect(stats.checklistStats.disclosure_verified.pass).toBe(1);
    expect(stats.checklistStats.disclosure_verified.fail).toBe(1);
    expect(stats.checklistStats.transcript_readable.pass).toBe(2);
    expect(stats.checklistStats.transcript_readable.fail).toBe(0);
    expect(stats.checklistStats.outcome_correct.pass).toBe(0);
    expect(stats.checklistStats.outcome_correct.fail).toBe(2);
    // null values are ignored in aggregation
    expect(stats.checklistStats.no_offensive.pass).toBe(1);
    expect(stats.checklistStats.no_offensive.fail).toBe(0);
    expect(stats.checklistStats.no_privacy_leak.pass).toBe(0);
    expect(stats.checklistStats.no_privacy_leak.fail).toBe(1);
  });

  it('ignores null checklist rows in aggregation', async () => {
    _statsRows = [
      { status: 'pending_review', checklist: null },
      { status: 'pending_review', checklist: null },
    ];
    const stats = await getWeeklyStats();
    for (const key of Object.keys(stats.checklistStats) as Array<keyof typeof stats.checklistStats>) {
      expect(stats.checklistStats[key].pass).toBe(0);
      expect(stats.checklistStats[key].fail).toBe(0);
    }
  });
});
