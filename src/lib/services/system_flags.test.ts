/**
 * Unit tests for the system_flags service.
 *
 * The DB context is mocked so these tests focus on the bookkeeping logic of
 * the SBC failure / success accounting without standing up Postgres. The
 * integration test (`system_flags.integration.test.ts`) covers the SQL upsert
 * and the picker-side consequences.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory store backing the mocked tx so the helpers can read back what they
// just wrote. Keyed by the system_flags `key` column.
const store = new Map<string, unknown>();

vi.mock('@/lib/db/context', () => ({
  withSystemContext: vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn(mockTx)),
}));

vi.mock('@/lib/db/schema', () => ({
  systemFlags: { key: { name: 'key' }, value: { name: 'value' } },
}));

// Track which key the most recent select / update / delete chain targets so
// the chainable mocks below can resolve against the in-memory store.
let pendingSelectKey: string | null = null;
let pendingDeleteKey: string | null = null;
let pendingInsertValues: { key?: string; value?: unknown } | null = null;

function makeWhereChain(target: 'select' | 'delete') {
  return vi.fn((cond: unknown) => {
    // The drizzle eq() helper produces an opaque object; for our mock we
    // rely on the call order — every accessor passes through this chain
    // exactly once per query, and we extract the key from a shared closure.
    void cond;
    if (target === 'select') {
      const result =
        pendingSelectKey !== null && store.has(pendingSelectKey)
          ? [{ value: store.get(pendingSelectKey) }]
          : [];
      const limited = {
        limit: vi.fn(() => Promise.resolve(result)),
      };
      return limited;
    }
    if (target === 'delete') {
      if (pendingDeleteKey !== null) store.delete(pendingDeleteKey);
      return Promise.resolve([]);
    }
    return Promise.resolve([]);
  });
}

const mockTx = {
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: makeWhereChain('select'),
    })),
  })),
  insert: vi.fn(() => ({
    values: vi.fn((v: { key?: string; value?: unknown }) => {
      pendingInsertValues = v;
      return {
        onConflictDoUpdate: vi.fn(({ set }: { set: { value: unknown } }) => {
          if (pendingInsertValues?.key !== undefined) {
            // For our in-memory mock, `set.value` may be a SQL ref-like; tests
            // exercising bookkeeping assert on the value passed to the FIRST
            // insert so we use that value directly.
            store.set(pendingInsertValues.key, pendingInsertValues.value ?? set.value);
          }
          return Promise.resolve([]);
        }),
      };
    }),
  })),
  delete: vi.fn(() => ({
    where: makeWhereChain('delete'),
  })),
  // pg_advisory_xact_lock is a no-op in this in-memory mock — the unit tests
  // exercise the bookkeeping math, not the concurrency contract (which is
  // covered by `system_flags.integration.test.ts`).
  execute: vi.fn(() => Promise.resolve([])),
};

// Capture the key argument out-of-band — drizzle eq() is opaque inside the
// mock. The helpers in system_flags.ts always read/write the same key for a
// given test, so a sentinel set just before the call is sufficient.
function withKey<T>(key: string, fn: () => Promise<T>): Promise<T> {
  pendingSelectKey = key;
  pendingDeleteKey = key;
  return fn();
}

import {
  clearStaleSbcUnhealthyFlag,
  getSbcHealthSnapshot,
  isSbcUnhealthy,
  recordSbcDispatchFailure,
  recordSbcDispatchSuccess,
  SBC_FAILURE_TRIP_THRESHOLD,
  SBC_FAILURE_TRIP_WINDOW_MS,
  SBC_HEALTHY_AUTO_CLEAR_MS,
  SBC_UNHEALTHY_FLAG_KEY,
} from './system_flags';

beforeEach(() => {
  store.clear();
  pendingSelectKey = null;
  pendingDeleteKey = null;
  pendingInsertValues = null;
  vi.clearAllMocks();
});

describe('SBC dispatch failure bookkeeping', () => {
  it('does not raise the flag on a single failure', async () => {
    const now = new Date('2026-05-06T10:00:00Z');
    const state = await withKey(SBC_UNHEALTHY_FLAG_KEY, () =>
      recordSbcDispatchFailure('vapi: 502', { now }),
    );
    expect(state.unhealthy).toBe(false);
    expect(state.recentFailures).toHaveLength(1);

    const unhealthy = await withKey(SBC_UNHEALTHY_FLAG_KEY, () => isSbcUnhealthy());
    expect(unhealthy).toBe(false);
  });

  it('raises the flag on the third consecutive failure within the window', async () => {
    const t0 = new Date('2026-05-06T10:00:00Z');
    const t1 = new Date('2026-05-06T10:01:00Z');
    const t2 = new Date('2026-05-06T10:02:00Z');

    await withKey(SBC_UNHEALTHY_FLAG_KEY, () =>
      recordSbcDispatchFailure('a', { now: t0 }),
    );
    await withKey(SBC_UNHEALTHY_FLAG_KEY, () =>
      recordSbcDispatchFailure('b', { now: t1 }),
    );
    const tripped = await withKey(SBC_UNHEALTHY_FLAG_KEY, () =>
      recordSbcDispatchFailure('c', { now: t2 }),
    );

    expect(tripped.unhealthy).toBe(true);
    expect(tripped.since).toBe(t2.toISOString());
    expect(tripped.lastFailureAt).toBe(t2.toISOString());
    expect(tripped.reason).toBe('c');
  });

  it('does not raise the flag when failures are outside the trip window', async () => {
    const t0 = new Date('2026-05-06T10:00:00Z');
    const t1 = new Date(t0.getTime() + SBC_FAILURE_TRIP_WINDOW_MS + 1);
    const t2 = new Date(t1.getTime() + 1000);

    await withKey(SBC_UNHEALTHY_FLAG_KEY, () =>
      recordSbcDispatchFailure('a', { now: t0 }),
    );
    await withKey(SBC_UNHEALTHY_FLAG_KEY, () =>
      recordSbcDispatchFailure('b', { now: t1 }),
    );
    const state = await withKey(SBC_UNHEALTHY_FLAG_KEY, () =>
      recordSbcDispatchFailure('c', { now: t2 }),
    );

    // First failure aged out of the trip window before t1 was recorded; only
    // b and c remain in the rolling list, so the threshold of 3 isn't met.
    expect(state.unhealthy).toBe(false);
    expect(state.recentFailures.length).toBeLessThan(SBC_FAILURE_TRIP_THRESHOLD);
  });

  it('breaks the streak on a healthy success but does not clear the flag prematurely', async () => {
    const t0 = new Date('2026-05-06T10:00:00Z');
    await withKey(SBC_UNHEALTHY_FLAG_KEY, () =>
      recordSbcDispatchFailure('a', { now: t0 }),
    );
    await withKey(SBC_UNHEALTHY_FLAG_KEY, () =>
      recordSbcDispatchFailure('b', { now: new Date(t0.getTime() + 1000) }),
    );

    // One success between the second and third failure resets the streak —
    // a third subsequent failure should NOT trip the flag because the rolling
    // list was reset to empty by the success.
    await withKey(SBC_UNHEALTHY_FLAG_KEY, () =>
      recordSbcDispatchSuccess({ now: new Date(t0.getTime() + 2000) }),
    );
    const next = await withKey(SBC_UNHEALTHY_FLAG_KEY, () =>
      recordSbcDispatchFailure('c', { now: new Date(t0.getTime() + 3000) }),
    );
    expect(next.unhealthy).toBe(false);
    expect(next.recentFailures).toHaveLength(1);
  });

  it('refreshes `reason` while keeping `since` once the flag is already tripped', async () => {
    const t0 = new Date('2026-05-06T10:00:00Z');
    for (const i of [0, 1, 2]) {
      await withKey(SBC_UNHEALTHY_FLAG_KEY, () =>
        recordSbcDispatchFailure(`first-${i}`, {
          now: new Date(t0.getTime() + i * 1000),
        }),
      );
    }
    const after = await withKey(SBC_UNHEALTHY_FLAG_KEY, () =>
      recordSbcDispatchFailure('newer', {
        now: new Date(t0.getTime() + 4000),
      }),
    );
    expect(after.unhealthy).toBe(true);
    expect(after.reason).toBe('newer');
    // `since` was set at the trip moment (i=2) and must remain stable.
    expect(after.since).toBe(new Date(t0.getTime() + 2000).toISOString());
  });
});

describe('SBC auto-clear', () => {
  it('clears the flag on the first healthy dispatch after the 30-min window', async () => {
    const t0 = new Date('2026-05-06T10:00:00Z');
    for (const i of [0, 1, 2]) {
      await withKey(SBC_UNHEALTHY_FLAG_KEY, () =>
        recordSbcDispatchFailure('x', {
          now: new Date(t0.getTime() + i * 1000),
        }),
      );
    }
    expect(
      await withKey(SBC_UNHEALTHY_FLAG_KEY, () => isSbcUnhealthy()),
    ).toBe(true);

    // The 3rd failure was at t0+2s, so we need wellAfter > lastFailureAt + 30 min.
    const wellAfter = new Date(t0.getTime() + 2_000 + SBC_HEALTHY_AUTO_CLEAR_MS + 1_000);
    const cleared = await withKey(SBC_UNHEALTHY_FLAG_KEY, () =>
      recordSbcDispatchSuccess({ now: wellAfter }),
    );
    expect(cleared.unhealthy).toBe(false);

    expect(
      await withKey(SBC_UNHEALTHY_FLAG_KEY, () => isSbcUnhealthy()),
    ).toBe(false);
  });

  it('does not clear the flag on a healthy dispatch within the 30-min window', async () => {
    const t0 = new Date('2026-05-06T10:00:00Z');
    for (const i of [0, 1, 2]) {
      await withKey(SBC_UNHEALTHY_FLAG_KEY, () =>
        recordSbcDispatchFailure('x', {
          now: new Date(t0.getTime() + i * 1000),
        }),
      );
    }

    const justAfter = new Date(t0.getTime() + 5 * 60 * 1000); // 5 min, well under 30
    const state = await withKey(SBC_UNHEALTHY_FLAG_KEY, () =>
      recordSbcDispatchSuccess({ now: justAfter }),
    );
    expect(state.unhealthy).toBe(true);
  });

  it('clearStaleSbcUnhealthyFlag is a no-op when SBC is healthy', async () => {
    const cleared = await withKey(SBC_UNHEALTHY_FLAG_KEY, () =>
      clearStaleSbcUnhealthyFlag(),
    );
    expect(cleared).toBe(false);
  });

  it('clearStaleSbcUnhealthyFlag clears a flag that has not auto-cleared', async () => {
    const t0 = new Date('2026-05-06T10:00:00Z');
    for (const i of [0, 1, 2]) {
      await withKey(SBC_UNHEALTHY_FLAG_KEY, () =>
        recordSbcDispatchFailure('x', {
          now: new Date(t0.getTime() + i * 1000),
        }),
      );
    }
    const stale = new Date(t0.getTime() + SBC_HEALTHY_AUTO_CLEAR_MS + 60_000);
    const cleared = await withKey(SBC_UNHEALTHY_FLAG_KEY, () =>
      clearStaleSbcUnhealthyFlag({ now: stale }),
    );
    expect(cleared).toBe(true);
    expect(
      await withKey(SBC_UNHEALTHY_FLAG_KEY, () => isSbcUnhealthy()),
    ).toBe(false);
  });
});

describe('getSbcHealthSnapshot', () => {
  it('returns null when SBC is healthy', async () => {
    const snap = await withKey(SBC_UNHEALTHY_FLAG_KEY, () =>
      getSbcHealthSnapshot(),
    );
    expect(snap).toBeNull();
  });

  it('returns the snapshot when the flag is raised', async () => {
    const t0 = new Date('2026-05-06T10:00:00Z');
    for (const i of [0, 1, 2]) {
      await withKey(SBC_UNHEALTHY_FLAG_KEY, () =>
        recordSbcDispatchFailure('vapi 502', {
          now: new Date(t0.getTime() + i * 1000),
        }),
      );
    }
    const snap = await withKey(SBC_UNHEALTHY_FLAG_KEY, () =>
      getSbcHealthSnapshot(),
    );
    expect(snap).not.toBeNull();
    expect(snap!.reason).toBe('vapi 502');
    expect(snap!.recentFailures.length).toBe(SBC_FAILURE_TRIP_THRESHOLD);
  });
});
