/**
 * Opt-out registry service (plan 11 task 5).
 *
 * Single entry point for every code path that opts a phone number out of
 * outbound calls. The five sources defined by spec §12 are:
 *
 *   - `call_outcome` — LLM tool `register_opt_out` during a live call
 *   - `dealer_input` — manual upload (DNC CSV) or per-row UI action
 *   - `gdpr_request` — GDPR Article 17 erasure flow
 *   - `inbound_ivr` — caller pressed 1 on the inbound IVR
 *   - `rpo_block`   — RPO snapshot transitioned a number to blocked
 *
 * `markOptOut` runs four steps inside a single transaction:
 *   1. UPSERT into `opt_out_registry` (idempotent on the
 *      `(org_id, phone_e164)` unique constraint).
 *   2. UPDATE matching live `contacts` rows: opt_out=true, opt_out_reason=source.
 *   3. INSERT an `audit_log` entry with full context.
 *   4. Return the `compliance/opt-out-registered` event payload to be sent
 *      after the transaction commits.
 *
 * Idempotency: re-marking the same (org, phone) is a no-op for the registry
 * thanks to ON CONFLICT DO NOTHING. The audit log still records the duplicate
 * attempt for traceability. The Inngest event id is keyed on
 * `(orgId, phoneE164, source)` so plan 13's notifier dedupes naturally per
 * source — a number opted out via call_outcome and again via dealer_input
 * produces two events because the dealer flow is a meaningful distinct signal.
 *
 * Two API shapes:
 *   - `markOptOut(orgId, phone, source, opts?)` manages its own per-org
 *     transaction and emits the event after commit. Use from request handlers,
 *     server actions, and crons.
 *   - `markOptOutInTx(tx, params)` runs inside an existing transaction (e.g.
 *     the voice-tool side-effect handler that needs the opt-out and the
 *     `calls.outcome` flip to commit atomically) and returns the events the
 *     caller must emit after the transaction commits.
 */

import { and, eq, inArray, isNull } from 'drizzle-orm';

import { recordAudit } from '@/lib/db/audit';
import type { DbTx } from '@/lib/db/context';
import { withOrgContext } from '@/lib/db/context';
import { contacts, optOutRegistry, optOutSourceEnum } from '@/lib/db/schema';
import type { InngestEventPayload } from '@/lib/inngest/client';
import { sendInngestEvent, sendInngestEvents } from '@/lib/inngest/client';

export type OptOutSource = (typeof optOutSourceEnum.enumValues)[number];

export const COMPLIANCE_OPT_OUT_REGISTERED_EVENT =
  'compliance/opt-out-registered' as const;

export interface ComplianceOptOutRegisteredData {
  orgId: string;
  phoneE164: string;
  source: OptOutSource;
  reason?: string;
  actorUserId?: string;
  callId?: string;
  recordedAt: string;
}

export interface MarkOptOutOptions {
  /**
   * Free-form supplementary reason. Persisted in the audit log metadata and
   * forwarded on the Inngest event; not stored on `contacts.opt_out_reason`,
   * which always carries the source enum value for analytical queries.
   */
  reason?: string;
  actorUserId?: string;
  /** Defaults are inferred from the source — see {@link defaultActorType}. */
  actorType?: 'user' | 'system' | 'webhook';
  /** Related call id, for audit context. */
  callId?: string;
  /** Extra audit metadata merged into the entry. */
  metadata?: Record<string, unknown>;
}

interface MarkOptOutInTxParams extends MarkOptOutOptions {
  orgId: string;
  phoneE164: string;
  source: OptOutSource;
}

const BULK_BATCH_SIZE = 500;

function defaultActorType(source: OptOutSource): 'user' | 'system' | 'webhook' {
  switch (source) {
    case 'dealer_input':
    case 'gdpr_request':
      return 'user';
    case 'call_outcome':
    case 'inbound_ivr':
      return 'webhook';
    case 'rpo_block':
      return 'system';
  }
}

function buildEvent(params: {
  orgId: string;
  phoneE164: string;
  source: OptOutSource;
  reason?: string;
  actorUserId?: string;
  callId?: string;
  recordedAt: Date;
}): InngestEventPayload {
  const data: ComplianceOptOutRegisteredData = {
    orgId: params.orgId,
    phoneE164: params.phoneE164,
    source: params.source,
    recordedAt: params.recordedAt.toISOString(),
  };
  if (params.reason !== undefined) data.reason = params.reason;
  if (params.actorUserId !== undefined) data.actorUserId = params.actorUserId;
  if (params.callId !== undefined) data.callId = params.callId;

  return {
    name: COMPLIANCE_OPT_OUT_REGISTERED_EVENT,
    data: data as unknown as Record<string, unknown>,
    // Dedupe at the (org, phone, source) granularity so plan 13's notifier
    // does not spam the dealer when the same source records the same opt-out
    // twice. Distinct sources produce distinct events because each carries new
    // information (e.g. RPO confirms a number the dealer already opted out).
    id: `opt-out-${params.orgId}-${params.phoneE164}-${params.source}`,
  };
}

/**
 * Tx-aware variant. Runs inside an existing org-scoped transaction and returns
 * the Inngest events the caller must emit after the transaction commits.
 *
 * The caller is responsible for the surrounding `withOrgContext` and for
 * sending the returned events. {@link markOptOut} is the higher-level
 * convenience wrapper.
 */
export async function markOptOutInTx(
  tx: DbTx,
  params: MarkOptOutInTxParams,
): Promise<InngestEventPayload[]> {
  const { orgId, phoneE164, source, reason, actorUserId, actorType, callId, metadata } =
    params;
  const recordedAt = new Date();

  await tx
    .insert(optOutRegistry)
    .values({ org_id: orgId, phone_e164: phoneE164, source })
    .onConflictDoNothing();

  await tx
    .update(contacts)
    .set({ opt_out: true, opt_out_reason: source })
    .where(
      and(
        eq(contacts.org_id, orgId),
        eq(contacts.phone_e164, phoneE164),
        isNull(contacts.deleted_at),
      ),
    );

  const auditMetadata: Record<string, unknown> = { source };
  if (reason !== undefined) auditMetadata['reason'] = reason;
  if (callId !== undefined) auditMetadata['callId'] = callId;
  if (metadata !== undefined) Object.assign(auditMetadata, metadata);

  await recordAudit(tx, {
    orgId,
    ...(actorUserId !== undefined ? { actorUserId } : {}),
    actorType: actorType ?? defaultActorType(source),
    action: 'opt_out.recorded',
    subjectType: 'phone_number',
    subjectId: phoneE164,
    metadata: auditMetadata,
  });

  return [
    buildEvent({
      orgId,
      phoneE164,
      source,
      ...(reason !== undefined ? { reason } : {}),
      ...(actorUserId !== undefined ? { actorUserId } : {}),
      ...(callId !== undefined ? { callId } : {}),
      recordedAt,
    }),
  ];
}

/**
 * Public API. Manages its own org-scoped transaction and emits the
 * `compliance/opt-out-registered` event after commit.
 */
export async function markOptOut(
  orgId: string,
  phoneE164: string,
  source: OptOutSource,
  opts: MarkOptOutOptions = {},
): Promise<void> {
  const events = await withOrgContext(orgId, (tx) =>
    markOptOutInTx(tx, { orgId, phoneE164, source, ...opts }),
  );
  if (events.length > 0) {
    await sendInngestEvents(events);
  }
  await sendInngestEvent({
    name: 'webhook/emit',
    data: {
      orgId,
      eventType: 'contact.opted_out',
      payload: { phoneE164, source },
      dedupKey: `${orgId}-${phoneE164}`,
    },
    id: `webhook-emit-contact-opted-out-${orgId}-${encodeURIComponent(phoneE164)}`,
  });
}

/**
 * Bulk variant for a single org. Each phone is enrolled in the registry,
 * matching live contact rows are flagged opt_out, a single aggregate audit
 * entry records the batch, and one Inngest event per phone is emitted.
 *
 * Optimised for the dealer DNC upload path which can reach thousands of
 * numbers — chunks of 500 keep us under PG parameter limits and avoid
 * locking entire indexes for too long.
 */
export async function bulkMarkOptOut(
  orgId: string,
  phonesE164: string[],
  source: OptOutSource,
  opts: { actorUserId?: string; reason?: string } = {},
): Promise<void> {
  if (phonesE164.length === 0) return;

  const events: InngestEventPayload[] = [];
  const recordedAt = new Date();

  for (let i = 0; i < phonesE164.length; i += BULK_BATCH_SIZE) {
    const batch = phonesE164.slice(i, i + BULK_BATCH_SIZE);
    await withOrgContext(orgId, async (tx) => {
      await tx
        .insert(optOutRegistry)
        .values(batch.map((phone_e164) => ({ org_id: orgId, phone_e164, source })))
        .onConflictDoNothing();

      await tx
        .update(contacts)
        .set({ opt_out: true, opt_out_reason: source })
        .where(
          and(
            eq(contacts.org_id, orgId),
            inArray(contacts.phone_e164, batch),
            isNull(contacts.deleted_at),
          ),
        );

      const batchMetadata: Record<string, unknown> = {
        source,
        count: batch.length,
        bulk: true,
      };
      if (opts.reason !== undefined) batchMetadata['reason'] = opts.reason;

      await recordAudit(tx, {
        orgId,
        ...(opts.actorUserId !== undefined ? { actorUserId: opts.actorUserId } : {}),
        actorType: defaultActorType(source),
        action: 'opt_out.recorded',
        subjectType: 'org',
        subjectId: orgId,
        metadata: batchMetadata,
      });
    });

    for (const phoneE164 of batch) {
      events.push(
        buildEvent({
          orgId,
          phoneE164,
          source,
          ...(opts.reason !== undefined ? { reason: opts.reason } : {}),
          ...(opts.actorUserId !== undefined ? { actorUserId: opts.actorUserId } : {}),
          recordedAt,
        }),
      );
    }
  }

  if (events.length > 0) {
    await sendInngestEvents(events);
  }
}
