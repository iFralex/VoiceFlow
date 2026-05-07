/**
 * Compliance retention policy (plan 11 task 12).
 *
 * Encodes the data retention windows mandated by spec §12.4:
 *
 *   - Call recordings:   12 months (overrideable per-org via
 *                        `organizations.recording_retention_days`).
 *   - Transcripts:       24 months.
 *   - Audit log:         7 years (regulatory baseline; not negotiable).
 *   - Soft-deleted contacts: hard-purged 30 days after `deleted_at`.
 *   - Payments:          retained indefinitely (Italian tax law).
 *
 * The accompanying retention purge cron (task 13) consumes
 * {@link getRetentionThresholds} to compute concrete cutoff timestamps for a
 * given org. Splitting the policy from the cron keeps the policy declarative
 * and trivially testable.
 */

import { eq } from 'drizzle-orm';

import { withSystemContext, type DbTx } from '@/lib/db/context';
import { organizations } from '@/lib/db/schema';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Platform default — 12 months. May be shortened per-org. */
export const DEFAULT_RECORDING_RETENTION_DAYS = 365;

/** Fixed across all orgs — transcripts have a uniform 24-month window. */
export const TRANSCRIPT_RETENTION_DAYS = 730;

/**
 * Audit-log retention. 7 years is the baseline that satisfies both Italian
 * civil-code bookkeeping (10y for tax docs is on `payments`, not audit_log)
 * and the GDPR accountability principle.
 */
export const AUDIT_LOG_RETENTION_DAYS = 2555;

/** Grace period for soft-deleted contacts before hard purge. */
export const SOFT_DELETED_CONTACT_PURGE_DAYS = 30;

/** Lower / upper bounds enforced by the DB CHECK constraint. */
export const RECORDING_RETENTION_DAYS_MIN = 1;
export const RECORDING_RETENTION_DAYS_MAX = 3650;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The retention policy as a declarative record. `payments` is intentionally
 * absent — there is no cutoff to compute, the data is kept forever.
 */
export interface RetentionPolicy {
  recordingDays: number;
  transcriptDays: number;
  auditLogDays: number;
  softDeletedContactDays: number;
}

/**
 * Concrete cutoff timestamps for a single org at a single point in time. Any
 * row in the corresponding table older than the cutoff is past retention and
 * eligible for purge.
 */
export interface RetentionThresholds {
  orgId: string;
  policy: RetentionPolicy;
  /** Recording rows with `started_at` (or `created_at` fallback) before this are eligible for purge. */
  recordingCutoff: Date;
  /** Transcript rows with `created_at` before this are eligible for purge. */
  transcriptCutoff: Date;
  /** Audit-log rows with `created_at` before this are eligible for purge. */
  auditLogCutoff: Date;
  /** Contacts with `deleted_at` before this are eligible for hard delete. */
  softDeletedContactCutoff: Date;
}

// ---------------------------------------------------------------------------
// Policy resolution
// ---------------------------------------------------------------------------

/**
 * Clamps a per-org override to the [MIN, MAX] window, falling back to the
 * platform default when null/undefined or outside the allowed range. The DB
 * CHECK constraint normally guards this, but defensive clamping protects
 * against migrations or bypass writes.
 */
function resolveRecordingDays(orgOverride: number | null | undefined): number {
  if (orgOverride == null) return DEFAULT_RECORDING_RETENTION_DAYS;
  if (
    orgOverride < RECORDING_RETENTION_DAYS_MIN ||
    orgOverride > RECORDING_RETENTION_DAYS_MAX
  ) {
    return DEFAULT_RECORDING_RETENTION_DAYS;
  }
  return Math.floor(orgOverride);
}

/**
 * Builds the policy record for a given recording-day override. Used directly
 * by tests; production callers go through {@link getRetentionThresholds}.
 */
export function buildPolicy(orgRecordingDays: number | null | undefined): RetentionPolicy {
  return {
    recordingDays: resolveRecordingDays(orgRecordingDays),
    transcriptDays: TRANSCRIPT_RETENTION_DAYS,
    auditLogDays: AUDIT_LOG_RETENTION_DAYS,
    softDeletedContactDays: SOFT_DELETED_CONTACT_PURGE_DAYS,
  };
}

function subtractDays(from: Date, days: number): Date {
  const out = new Date(from.getTime());
  out.setUTCDate(out.getUTCDate() - days);
  return out;
}

/**
 * Computes the concrete cutoff timestamps for a policy at the given moment.
 * Pure: no DB access. Use directly when you already have the policy in hand
 * (e.g. inside a batch loop where you don't want a round-trip per org).
 */
export function policyToThresholds(
  orgId: string,
  policy: RetentionPolicy,
  now: Date = new Date(),
): RetentionThresholds {
  return {
    orgId,
    policy,
    recordingCutoff: subtractDays(now, policy.recordingDays),
    transcriptCutoff: subtractDays(now, policy.transcriptDays),
    auditLogCutoff: subtractDays(now, policy.auditLogDays),
    softDeletedContactCutoff: subtractDays(now, policy.softDeletedContactDays),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolves the retention thresholds for a single org. Reads
 * `organizations.recording_retention_days`; everything else is platform-fixed.
 *
 * Cross-org operation (called from the retention purge cron, which iterates
 * every org) — runs via `withSystemContext` unless an open `tx` is supplied.
 */
export async function getRetentionThresholds(
  orgId: string,
  options?: { now?: Date; tx?: DbTx },
): Promise<RetentionThresholds> {
  const now = options?.now ?? new Date();

  const fetchOverride = async (tx: DbTx): Promise<number | null> => {
    const rows = await tx
      .select({ recording_retention_days: organizations.recording_retention_days })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);
    if (rows.length === 0) {
      throw new Error(`Organization ${orgId} not found`);
    }
    return rows[0]!.recording_retention_days ?? null;
  };

  const override = options?.tx
    ? await fetchOverride(options.tx)
    : await withSystemContext(fetchOverride);

  return policyToThresholds(orgId, buildPolicy(override), now);
}
