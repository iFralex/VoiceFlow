/**
 * DPA (Data Processing Agreement) acceptance helpers (plan 11 task 16).
 *
 * Each organization must accept the platform DPA before it can be used. The
 * acceptance is recorded as an immutable `compliance.dpa_accepted` row in
 * `audit_log` (subject_type='organization', subject_id=orgId) and includes the
 * DPA version, the requesting user's IP and user agent.
 *
 * On a DPA version bump (changing {@link CURRENT_DPA_VERSION} below), every
 * org whose latest acceptance row references an older version sees a banner
 * on the next session load (rendered by `DpaBanner` in the app shell) and
 * must re-accept via `acceptCurrentDpaVersion`.
 */

import { and, desc, eq } from 'drizzle-orm';

import { recordAudit } from '@/lib/db/audit';
import { withSystemContext, type DbTx } from '@/lib/db/context';
import { auditLog } from '@/lib/db/schema';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Current canonical DPA version. Bump this string whenever the DPA document
 * is materially updated (changes that require re-acceptance under GDPR Art.
 * 28). The format is `YYYY-MM-DD` matching the document's effective date.
 */
export const CURRENT_DPA_VERSION = '2026-01-01';

/** Audit-log action used for both initial acceptance and re-acceptance. */
export const DPA_ACCEPTED_ACTION = 'compliance.dpa_accepted';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DpaAcceptanceRecord {
  /** ISO timestamp of the acceptance. */
  acceptedAt: string;
  version: string;
  acceptedByUserId: string | null;
  ip: string | null;
  userAgent: string | null;
}

export interface DpaAcceptanceMetadata {
  version: string;
  accepted_at: string;
  ip: string | null;
  user_agent: string | null;
}

// ---------------------------------------------------------------------------
// Acceptance recording
// ---------------------------------------------------------------------------

export interface RecordDpaAcceptanceInput {
  orgId: string;
  userId: string;
  ip: string | null;
  userAgent: string | null;
  version?: string;
  /** Optional open transaction; otherwise a fresh `withSystemContext` is opened. */
  tx?: DbTx;
}

export async function recordDpaAcceptance(
  input: RecordDpaAcceptanceInput,
): Promise<DpaAcceptanceMetadata> {
  const version = input.version ?? CURRENT_DPA_VERSION;
  const metadata: DpaAcceptanceMetadata = {
    version,
    accepted_at: new Date().toISOString(),
    ip: input.ip,
    user_agent: input.userAgent,
  };

  const insert = (tx: DbTx) =>
    recordAudit(tx, {
      orgId: input.orgId,
      actorUserId: input.userId,
      actorType: 'user',
      action: DPA_ACCEPTED_ACTION,
      subjectType: 'organization',
      subjectId: input.orgId,
      metadata: metadata as unknown as Record<string, unknown>,
    });

  if (input.tx) {
    await insert(input.tx);
  } else {
    await withSystemContext(insert);
  }

  return metadata;
}

// ---------------------------------------------------------------------------
// Acceptance lookup
// ---------------------------------------------------------------------------

/**
 * Returns the most recent DPA acceptance row for an org, or `null` if none
 * exists (e.g. org pre-dates the DPA gate). Reads from the system-owned
 * `audit_log` via {@link withSystemContext}.
 */
export async function getLatestDpaAcceptance(
  orgId: string,
): Promise<DpaAcceptanceRecord | null> {
  return withSystemContext(async (tx) => {
    const rows = await tx
      .select({
        created_at: auditLog.created_at,
        actor_user_id: auditLog.actor_user_id,
        metadata: auditLog.metadata,
      })
      .from(auditLog)
      .where(and(eq(auditLog.org_id, orgId), eq(auditLog.action, DPA_ACCEPTED_ACTION)))
      .orderBy(desc(auditLog.created_at), desc(auditLog.id))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    const metadata = (row.metadata ?? {}) as Partial<DpaAcceptanceMetadata>;
    return {
      acceptedAt: row.created_at.toISOString(),
      version: typeof metadata.version === 'string' ? metadata.version : 'unknown',
      acceptedByUserId: row.actor_user_id,
      ip: typeof metadata.ip === 'string' ? metadata.ip : null,
      userAgent: typeof metadata.user_agent === 'string' ? metadata.user_agent : null,
    };
  });
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export type DpaStatus =
  | { state: 'current'; record: DpaAcceptanceRecord }
  | { state: 'outdated'; record: DpaAcceptanceRecord; currentVersion: string }
  | { state: 'never_accepted'; currentVersion: string };

/**
 * Resolves whether the latest accepted DPA version for an org matches
 * {@link CURRENT_DPA_VERSION}. Used by the in-app banner.
 */
export async function getDpaStatus(orgId: string): Promise<DpaStatus> {
  const record = await getLatestDpaAcceptance(orgId);
  if (!record) {
    return { state: 'never_accepted', currentVersion: CURRENT_DPA_VERSION };
  }
  if (record.version === CURRENT_DPA_VERSION) {
    return { state: 'current', record };
  }
  return { state: 'outdated', record, currentVersion: CURRENT_DPA_VERSION };
}
