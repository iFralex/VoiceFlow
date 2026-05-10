/**
 * Disclosure-failure triage helpers (plan 11 task 8).
 *
 * Backs the hidden `/admin/disclosure-failures` dashboard. The classifier
 * (src/lib/inngest/voice/classify.ts) marks calls whose transcript first 30s
 * does not contain the AI Act disclosure phrase by writing
 * `metadata.disclosure_verified = false` and emitting `quality/disclosure-missing`.
 *
 * Triage state is layered on the same jsonb so we don't need a migration. The
 * runbook (`docs/runbooks/aiact-disclosure-failure.md`) defines the lifecycle:
 *   pending → reviewed | refunded | escalated → resolved
 */

import { and, desc, eq, or, sql } from 'drizzle-orm';

import { recordAudit } from '@/lib/db/audit';
import { withSystemContext } from '@/lib/db/context';
import { calls } from '@/lib/db/schema';

export const DISCLOSURE_TRIAGE_STATUSES = [
  'pending',
  'reviewed',
  'refunded',
  'escalated',
  'resolved',
] as const;

export type DisclosureTriageStatus = (typeof DISCLOSURE_TRIAGE_STATUSES)[number];

export function isDisclosureTriageStatus(v: unknown): v is DisclosureTriageStatus {
  return typeof v === 'string' && (DISCLOSURE_TRIAGE_STATUSES as readonly string[]).includes(v);
}

export interface DisclosureFailureRow {
  callId: string;
  orgId: string;
  campaignId: string | null;
  contactId: string | null;
  createdAt: Date;
  costCents: number | null;
  outcome: string | null;
  recordingPath: string | null;
  transcriptPath: string | null;
  triageStatus: DisclosureTriageStatus;
  triageNote: string | null;
  triagedAt: Date | null;
  triagedBy: string | null;
}

export interface ListDisclosureFailuresOptions {
  /** When provided, only rows whose triage status equals this value are returned. */
  status?: DisclosureTriageStatus;
  /** Hard cap on returned rows. */
  limit?: number;
}

/**
 * Returns calls with `metadata.disclosure_verified = false`, newest first.
 * Crosses org boundaries: this is admin-only tooling, not user-facing.
 */
export async function listDisclosureFailures(
  opts: ListDisclosureFailuresOptions = {},
): Promise<DisclosureFailureRow[]> {
  const limit = opts.limit ?? 200;

  const statusCondition = opts.status
    ? opts.status === 'pending'
      ? or(
          sql`${calls.metadata}->>'disclosure_triage_status' = 'pending'`,
          sql`${calls.metadata}->>'disclosure_triage_status' IS NULL`,
        )
      : sql`${calls.metadata}->>'disclosure_triage_status' = ${opts.status}`
    : undefined;

  const rows = await withSystemContext((tx) =>
    tx
      .select({
        id: calls.id,
        org_id: calls.org_id,
        campaign_id: calls.campaign_id,
        contact_id: calls.contact_id,
        created_at: calls.created_at,
        cost_cents: calls.cost_cents,
        outcome: calls.outcome,
        recording_path: calls.recording_path,
        transcript_path: calls.transcript_path,
        metadata: calls.metadata,
      })
      .from(calls)
      .where(
        statusCondition
          ? and(sql`${calls.metadata}->>'disclosure_verified' = 'false'`, statusCondition)
          : sql`${calls.metadata}->>'disclosure_verified' = 'false'`,
      )
      .orderBy(desc(calls.created_at))
      .limit(limit),
  );

  return rows.map((r): DisclosureFailureRow => {
    const meta = (r.metadata as Record<string, unknown> | null) ?? null;
    const rawStatus = meta?.['disclosure_triage_status'];
    const status: DisclosureTriageStatus = isDisclosureTriageStatus(rawStatus)
      ? rawStatus
      : 'pending';
    const note = typeof meta?.['disclosure_triage_note'] === 'string'
      ? (meta['disclosure_triage_note'] as string)
      : null;
    const triagedAtRaw = meta?.['disclosure_triaged_at'];
    const triagedAt = typeof triagedAtRaw === 'string' ? new Date(triagedAtRaw) : null;
    const triagedBy = typeof meta?.['disclosure_triaged_by'] === 'string'
      ? (meta['disclosure_triaged_by'] as string)
      : null;

    return {
      callId: r.id,
      orgId: r.org_id,
      campaignId: r.campaign_id ?? null,
      contactId: r.contact_id ?? null,
      createdAt: r.created_at,
      costCents: r.cost_cents ?? null,
      outcome: r.outcome ?? null,
      recordingPath: r.recording_path ?? null,
      transcriptPath: r.transcript_path ?? null,
      triageStatus: status,
      triageNote: note,
      triagedAt,
      triagedBy,
    };
  });
}

export interface UpdateDisclosureTriageInput {
  callId: string;
  status: DisclosureTriageStatus;
  note?: string | null;
  /** Free-form actor identifier (e.g. founder email). Persisted verbatim in
   *  metadata for audit-trail continuity. */
  actor?: string | null;
}

/**
 * Records a triage state transition for a single disclosure-failure row.
 *
 * Merges new triage fields into `calls.metadata` (preserving any unrelated
 * keys) and writes a `compliance.disclosure_triaged` audit_log entry. Both
 * happen in the same transaction so the ledger and the row state can never
 * disagree.
 */
export async function updateDisclosureTriage(
  input: UpdateDisclosureTriageInput,
): Promise<{ ok: true; orgId: string } | { ok: false; reason: 'not_found' }> {
  const { callId, status } = input;
  const note = input.note?.trim() || null;
  const actor = input.actor?.trim() || null;
  const now = new Date();
  const nowIso = now.toISOString();

  const patch: Record<string, unknown> = {
    disclosure_triage_status: status,
    disclosure_triaged_at: nowIso,
  };
  patch['disclosure_triage_note'] = note;
  patch['disclosure_triaged_by'] = actor;

  const patchJson = JSON.stringify(patch);

  return withSystemContext(async (tx) => {
    const [row] = await tx
      .select({ org_id: calls.org_id, metadata: calls.metadata })
      .from(calls)
      .where(eq(calls.id, callId))
      .limit(1);

    if (!row) return { ok: false as const, reason: 'not_found' as const };

    const existingMeta = (row.metadata as Record<string, unknown> | null) ?? null;
    if (existingMeta?.['disclosure_verified'] !== false) {
      return { ok: false as const, reason: 'not_found' as const };
    }

    await tx
      .update(calls)
      .set({
        metadata: sql`COALESCE(${calls.metadata}, '{}'::jsonb) || ${patchJson}::jsonb`,
      })
      .where(and(eq(calls.id, callId), eq(calls.org_id, row.org_id)));

    await recordAudit(tx, {
      orgId: row.org_id,
      actorType: 'system',
      action: 'compliance.disclosure_triaged',
      subjectType: 'call',
      subjectId: callId,
      metadata: {
        status,
        note,
        actor,
      },
    });

    return { ok: true as const, orgId: row.org_id };
  });
}
