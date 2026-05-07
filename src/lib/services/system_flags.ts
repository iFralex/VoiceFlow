/**
 * Cross-cutting key/value flag store backed by the `system_flags` table.
 *
 * Plan 10 task 13 introduces the SBC→Twilio fallback mechanism that lives on
 * top of these helpers. The dispatcher records every Vapi `createCall` outcome
 * via `recordSbcDispatchFailure` / `recordSbcDispatchSuccess`. When the SBC
 * trunk fails 3 consecutive times within 5 minutes, the `sbc_unhealthy` flag
 * is set and `pickCliForOrg` is asked to constrain selection to the Twilio
 * sub-pool. The flag auto-clears after 30 minutes of healthy SBC operation.
 *
 * The table is system-owned (no RLS) and every accessor wraps its query in
 * `withSystemContext`. Callers that already hold a transaction can pass it
 * through `options.tx` to share the snapshot.
 */

import { eq, sql } from 'drizzle-orm';

import { type DbTx, withSystemContext } from '@/lib/db/context';
import { systemFlags } from '@/lib/db/schema';

// ── Tunables ────────────────────────────────────────────────────────────────

/**
 * Number of consecutive failed SBC dispatches that trip the `sbc_unhealthy`
 * flag. Plan 10 task 13: 3 consecutive failures.
 */
export const SBC_FAILURE_TRIP_THRESHOLD = 3;

/**
 * Sliding window for the consecutive-failure check. Older failures fall out
 * of the streak when computing whether the threshold has been hit.
 */
export const SBC_FAILURE_TRIP_WINDOW_MS = 5 * 60 * 1000;

/**
 * Idle window (no SBC dispatch failures) after which the `sbc_unhealthy` flag
 * auto-clears on the next read or success-record. Plan 10 task 13: 30 minutes.
 */
export const SBC_HEALTHY_AUTO_CLEAR_MS = 30 * 60 * 1000;

/**
 * Key under which the SBC-health state is stored. Other flags can be added
 * with new keys (e.g. emergency campaign pause) without further migrations.
 */
export const SBC_UNHEALTHY_FLAG_KEY = 'sbc_unhealthy';

// ── Stored state shapes ─────────────────────────────────────────────────────

/**
 * Payload persisted under the `sbc_unhealthy` key while the SBC trunk is
 * considered degraded. `recentFailures` is a rolling list of recent failure
 * timestamps used to compute the consecutive-failure trip; the dispatcher
 * never reads it directly, the helpers below own the bookkeeping.
 */
export interface SbcUnhealthyValue {
  /** When the flag was first raised. */
  since: string;
  /** Last failure timestamp, used for the 30-minute auto-clear window. */
  lastFailureAt: string;
  /** Why the flag was raised — for forensics on the admin dashboard. */
  reason: string;
  /** ISO timestamps of recent SBC dispatch failures (within the trip window). */
  recentFailures: string[];
}

/**
 * Tracking state stored even while SBC is healthy: a rolling list of failure
 * timestamps the dispatcher has reported. We keep it under the same key so
 * "no row" still means "fully healthy, no recent failures".
 */
interface SbcHealthState {
  recentFailures: string[];
  /** Truthy iff the flag has been tripped (i.e. the dispatcher should route
   *  around the SBC). */
  unhealthy: boolean;
  /** Set when `unhealthy` is true. */
  since?: string | undefined;
  lastFailureAt?: string | undefined;
  reason?: string | undefined;
}

// ── Generic accessors ──────────────────────────────────────────────────────

export interface FlagOptions {
  /**
   * Run inside an existing transaction instead of opening a new
   * `withSystemContext`. Used by tests and by callers that already hold a tx.
   */
  tx?: DbTx;
}

/**
 * Returns the value stored under `key`, or `null` if the row does not exist.
 * The caller is responsible for narrowing the JSON shape — `T` is asserted,
 * not validated.
 */
export async function getFlag<T = unknown>(
  key: string,
  options: FlagOptions = {},
): Promise<T | null> {
  const run = async (tx: DbTx) => {
    const [row] = await tx
      .select({ value: systemFlags.value })
      .from(systemFlags)
      .where(eq(systemFlags.key, key))
      .limit(1);
    return row ? (row.value as T) : null;
  };
  return options.tx ? run(options.tx) : withSystemContext(run);
}

/** Upserts the row identified by `key` with the supplied value. */
export async function setFlag(
  key: string,
  value: unknown,
  options: FlagOptions = {},
): Promise<void> {
  const run = async (tx: DbTx) => {
    await tx
      .insert(systemFlags)
      .values({ key, value: value as object })
      .onConflictDoUpdate({
        target: systemFlags.key,
        set: { value: value as object, updated_at: sql`NOW()` },
      });
  };
  if (options.tx) {
    await run(options.tx);
  } else {
    await withSystemContext(run);
  }
}

/** Deletes the row identified by `key`. No-op when the row is absent. */
export async function clearFlag(key: string, options: FlagOptions = {}): Promise<void> {
  const run = async (tx: DbTx) => {
    await tx.delete(systemFlags).where(eq(systemFlags.key, key));
  };
  if (options.tx) {
    await run(options.tx);
  } else {
    await withSystemContext(run);
  }
}

// ── SBC health bookkeeping ─────────────────────────────────────────────────

interface SbcHealthOptions extends FlagOptions {
  /** Override "now" for deterministic tests. */
  now?: Date;
}

function emptyState(): SbcHealthState {
  return { recentFailures: [], unhealthy: false };
}

function trimToTripWindow(timestamps: string[], now: Date): string[] {
  const cutoff = now.getTime() - SBC_FAILURE_TRIP_WINDOW_MS;
  return timestamps.filter((ts) => Date.parse(ts) >= cutoff);
}

function readState(value: unknown): SbcHealthState {
  if (!value || typeof value !== 'object') return emptyState();
  const v = value as Record<string, unknown>;
  const recentFailures = Array.isArray(v['recentFailures'])
    ? (v['recentFailures'] as unknown[]).filter(
        (x): x is string => typeof x === 'string',
      )
    : [];
  const unhealthy = v['unhealthy'] === true;
  return {
    recentFailures,
    unhealthy,
    since: typeof v['since'] === 'string' ? v['since'] : undefined,
    lastFailureAt:
      typeof v['lastFailureAt'] === 'string' ? v['lastFailureAt'] : undefined,
    reason: typeof v['reason'] === 'string' ? v['reason'] : undefined,
  };
}

function persistState(state: SbcHealthState, tx: DbTx): Promise<void> {
  // When fully healthy with no recent failures we delete the row so the absence
  // of data unambiguously means "no recent activity to track".
  if (!state.unhealthy && state.recentFailures.length === 0) {
    return clearFlag(SBC_UNHEALTHY_FLAG_KEY, { tx });
  }
  const value: Record<string, unknown> = {
    unhealthy: state.unhealthy,
    recentFailures: state.recentFailures,
  };
  if (state.unhealthy) {
    value['since'] = state.since;
    value['lastFailureAt'] = state.lastFailureAt;
    value['reason'] = state.reason;
  }
  return setFlag(SBC_UNHEALTHY_FLAG_KEY, value, { tx });
}

/**
 * Stable advisory-lock key used to serialise concurrent SBC-health bookkeeping
 * transactions. `recordSbcDispatchFailure`/`recordSbcDispatchSuccess` perform a
 * read-modify-write on the same `system_flags` row; without serialisation two
 * concurrent failures can both read the pre-update state and the second write
 * clobbers the first, dropping a failure timestamp and breaking the trip
 * threshold. We pick a fixed bigint per key — pg_advisory_xact_lock is
 * released automatically at the end of the surrounding transaction.
 */
const SBC_UNHEALTHY_FLAG_LOCK_KEY = 7_283_419_521;

/**
 * Records an SBC dispatch failure. When the rolling count of failures within
 * the trip window reaches `SBC_FAILURE_TRIP_THRESHOLD`, the `sbc_unhealthy`
 * flag is set so the picker excludes SBC providers on subsequent picks.
 *
 * Returns the resulting state — useful for tests and observability.
 */
export async function recordSbcDispatchFailure(
  reason: string,
  options: SbcHealthOptions = {},
): Promise<SbcHealthState> {
  const now = options.now ?? new Date();
  const run = async (tx: DbTx): Promise<SbcHealthState> => {
    // Serialise concurrent updaters: without this, two simultaneous failures
    // both read the same `recentFailures` array, both push their timestamp,
    // and the second `setFlag` overwrites the first — losing a failure event
    // and potentially preventing the trip threshold from firing.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${SBC_UNHEALTHY_FLAG_LOCK_KEY})`);

    const stored = await getFlag<unknown>(SBC_UNHEALTHY_FLAG_KEY, { tx });
    const state = readState(stored);

    const trimmed = trimToTripWindow(state.recentFailures, now);
    trimmed.push(now.toISOString());
    state.recentFailures = trimmed;
    state.lastFailureAt = now.toISOString();

    if (!state.unhealthy && trimmed.length >= SBC_FAILURE_TRIP_THRESHOLD) {
      state.unhealthy = true;
      state.since = now.toISOString();
      state.reason = reason;
    } else if (state.unhealthy) {
      // Already unhealthy: keep the original `since` but refresh `reason` so
      // the latest cause is visible on the admin dashboard.
      state.reason = reason;
    }

    await persistState(state, tx);
    return state;
  };
  return options.tx ? run(options.tx) : withSystemContext(run);
}

/**
 * Records a healthy SBC dispatch. Trims the failure streak (so a healthy
 * dispatch breaks the consecutive-failure run) and, if the flag was raised
 * but the last failure is older than `SBC_HEALTHY_AUTO_CLEAR_MS`, clears the
 * flag so the dispatcher returns to the SBC pool.
 */
export async function recordSbcDispatchSuccess(
  options: SbcHealthOptions = {},
): Promise<SbcHealthState> {
  const now = options.now ?? new Date();
  const run = async (tx: DbTx): Promise<SbcHealthState> => {
    // Same advisory lock as the failure path: a success interleaved with a
    // failure must not lose either side's bookkeeping.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${SBC_UNHEALTHY_FLAG_LOCK_KEY})`);

    const stored = await getFlag<unknown>(SBC_UNHEALTHY_FLAG_KEY, { tx });
    const state = readState(stored);

    // A healthy dispatch breaks the streak — reset the failure list.
    state.recentFailures = [];

    if (state.unhealthy && state.lastFailureAt) {
      const elapsed = now.getTime() - Date.parse(state.lastFailureAt);
      if (elapsed >= SBC_HEALTHY_AUTO_CLEAR_MS) {
        state.unhealthy = false;
        state.since = undefined;
        state.lastFailureAt = undefined;
        state.reason = undefined;
      }
    }

    await persistState(state, tx);
    return state;
  };
  return options.tx ? run(options.tx) : withSystemContext(run);
}

/**
 * Returns true if the SBC trunk is currently considered unhealthy.
 *
 * Lazily garbage-collects a stale flag whose `lastFailureAt` is older than
 * `SBC_HEALTHY_AUTO_CLEAR_MS`. This is the only reliable auto-clear path:
 * once the flag is raised, the picker constrains all dispatches to Twilio,
 * so `recordSbcDispatchSuccess` is never called and the success-driven clear
 * cannot fire. Without this lazy sweep the flag would stay raised until the
 * next daily watchdog cron run — contradicting the "30 minutes of healthy
 * operation" guarantee in plan 10 task 13. We accept the extra round-trip on
 * the rare reads that need to clear because the alternative is locking
 * dispatch onto the Twilio fallback for up to ~24 h.
 */
export async function isSbcUnhealthy(options: SbcHealthOptions = {}): Promise<boolean> {
  const stored = await getFlag<unknown>(SBC_UNHEALTHY_FLAG_KEY, options);
  const state = readState(stored);
  if (!state.unhealthy) return false;
  if (state.lastFailureAt) {
    const now = options.now ?? new Date();
    const elapsed = now.getTime() - Date.parse(state.lastFailureAt);
    if (elapsed >= SBC_HEALTHY_AUTO_CLEAR_MS) {
      // Best-effort lazy clear; if the sweep itself fails we still return the
      // current (raised) state so the caller routes to the fallback pool.
      try {
        const cleared = await clearStaleSbcUnhealthyFlag(options);
        if (cleared) return false;
      } catch (err) {
        console.error('[system_flags] Lazy stale-flag clear failed', err);
      }
    }
  }
  return state.unhealthy;
}

/**
 * Clears the `sbc_unhealthy` flag if its last failure is older than the
 * 30-minute auto-clear window. Idempotent and safe to run from a cron.
 *
 * Returns true if the flag was cleared by this call (state changed).
 */
export async function clearStaleSbcUnhealthyFlag(
  options: SbcHealthOptions = {},
): Promise<boolean> {
  const now = options.now ?? new Date();
  const run = async (tx: DbTx): Promise<boolean> => {
    // Take the same advisory lock the record-* helpers use so a stale-flag
    // sweep cannot interleave with a concurrent failure/success update.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${SBC_UNHEALTHY_FLAG_LOCK_KEY})`);
    const stored = await getFlag<unknown>(SBC_UNHEALTHY_FLAG_KEY, { tx });
    const state = readState(stored);
    if (!state.unhealthy) return false;
    if (!state.lastFailureAt) return false;
    const elapsed = now.getTime() - Date.parse(state.lastFailureAt);
    if (elapsed < SBC_HEALTHY_AUTO_CLEAR_MS) return false;

    state.unhealthy = false;
    state.since = undefined;
    state.lastFailureAt = undefined;
    state.reason = undefined;
    state.recentFailures = [];
    await persistState(state, tx);
    return true;
  };
  return options.tx ? run(options.tx) : withSystemContext(run);
}

/**
 * Returns the full SBC-health snapshot — used by the founder admin dashboard
 * (`/admin/cli-pool`) and by tests asserting on bookkeeping internals. May
 * return `null` if no failures have ever been recorded.
 */
export async function getSbcHealthSnapshot(
  options: FlagOptions = {},
): Promise<SbcUnhealthyValue | null> {
  const stored = await getFlag<unknown>(SBC_UNHEALTHY_FLAG_KEY, options);
  const state = readState(stored);
  if (!state.unhealthy || !state.since || !state.lastFailureAt || !state.reason) {
    return null;
  }
  return {
    since: state.since,
    lastFailureAt: state.lastFailureAt,
    reason: state.reason,
    recentFailures: state.recentFailures,
  };
}
