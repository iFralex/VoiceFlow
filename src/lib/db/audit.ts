import { db } from './client';
import { auditLog } from './schema';

type ActorType = 'user' | 'system' | 'webhook';

interface RecordAuditParams {
  orgId?: string;
  actorUserId?: string;
  actorType: ActorType;
  action: string;
  subjectType: string;
  subjectId: string;
  metadata?: Record<string, unknown>;
}

type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Inserts an entry into the append-only audit_log table.
 *
 * Must be called inside a transaction (pass `tx` from withOrgContext or
 * withSystemContext). The database-level REVOKE on UPDATE/DELETE enforces
 * immutability — this helper intentionally exposes only INSERT semantics.
 *
 * @param tx   - The transactional db client (from withOrgContext / withSystemContext)
 * @param params - Audit entry fields
 */
export async function recordAudit(tx: DbTx, params: RecordAuditParams): Promise<void> {
  const { orgId, actorUserId, actorType, action, subjectType, subjectId, metadata } = params;

  await tx.insert(auditLog).values({
    org_id: orgId ?? null,
    actor_user_id: actorUserId ?? null,
    actor_type: actorType,
    action,
    subject_type: subjectType,
    subject_id: subjectId,
    metadata: metadata ?? null,
  });
}
