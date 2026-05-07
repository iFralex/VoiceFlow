/**
 * Inbound IVR call handling (plan 10 task 11).
 *
 * Inbound calls hit a shared-pool DID, are routed by Vapi to the inbound-ivr
 * assistant, and never carry an `orgId` / `callId` we set in metadata (because
 * the call originated from the customer, not from us). This module owns:
 *
 *   1. Persisting one `direction='inbound'` row in `calls` per Vapi inbound
 *      call, scoped to the most recent calling org. The row's `provider_call_id`
 *      is how subsequent webhook events (call-end, function-call) find it back.
 *   2. Updating that row on call-end with duration, ended reason, and recording.
 *   3. Enroling the inbound caller in the opt-out registry of every org that
 *      recently dialed them — the "press 1" path on the IVR. This is the only
 *      cross-org write in the request path; it runs inside `withSystemContext`
 *      so RLS does not block the lookup, then writes per-org via
 *      `withOrgContext` so each opt-out + audit row stays scoped correctly.
 *
 * If `findRecentOutboundCallsToNumber` returns no recent callers we cannot
 * persist an inbound row (calls.org_id stays NOT NULL) — the IVR still answers
 * and the caller still hears the menu, we just have no org context to bind the
 * row to. This is logged but otherwise silent.
 */

import { and, desc, eq } from 'drizzle-orm';

import { recordAudit } from '@/lib/db/audit';
import { withOrgContext, withSystemContext } from '@/lib/db/context';
import { calls, type Call } from '@/lib/db/schema';
import { sendInngestEvents } from '@/lib/inngest/client';
import type { InngestEventPayload } from '@/lib/inngest/client';
import { markOptOutInTx } from '@/lib/services/optout';
import { findRecentOutboundCallsToNumber } from '@/lib/voice/inbound/lookup';

interface RecordInboundCallStartedParams {
  providerCallId: string;
  callerNumber: string;
  /** The pool DID the customer dialed (E.164). */
  toNumber: string;
}

/**
 * Persists an inbound IVR call as a `direction='inbound'` row in `calls`.
 *
 * Resolves the row's `org_id` to the most recent org that dialed `callerNumber`
 * in the last 30 days. When no such org exists, returns null (no row written).
 * Idempotent on `provider_call_id`: if a row already exists, returns it
 * unchanged.
 */
export async function recordInboundCallStarted(
  params: RecordInboundCallStartedParams,
): Promise<Call | null> {
  // Idempotency: if we have already inserted a row for this provider_call_id,
  // return it without re-running the org lookup.
  const [existing] = await withSystemContext((tx) =>
    tx
      .select()
      .from(calls)
      .where(eq(calls.provider_call_id, params.providerCallId))
      .limit(1),
  );
  if (existing) return existing;

  // Find the most recent calling org. Returns [] when no recent caller exists,
  // which is the "we got an inbound call but have no record of ever calling
  // this person" case — we cannot persist a row because org_id is NOT NULL.
  const recent = await findRecentOutboundCallsToNumber(params.callerNumber);
  if (recent.length === 0) return null;

  // findRecentOutboundCallsToNumber orders by started_at DESC, so the freshest
  // org is first. The ordering is also documented in lookup.ts.
  const orgId = recent[0]!.orgId;

  return withOrgContext(orgId, async (tx) => {
    const [created] = await tx
      .insert(calls)
      .values({
        org_id: orgId,
        direction: 'inbound',
        provider: 'vapi',
        provider_call_id: params.providerCallId,
        status: 'in_progress',
        from_number: params.toNumber,
        started_at: new Date(),
        metadata: { inbound_caller_number: params.callerNumber },
      })
      .returning();

    await recordAudit(tx, {
      orgId,
      actorType: 'webhook',
      action: 'inbound_call.received',
      subjectType: 'call',
      subjectId: created!.id,
      metadata: {
        callerNumber: params.callerNumber,
        toNumber: params.toNumber,
        providerCallId: params.providerCallId,
      },
    });

    return created!;
  });
}

interface RecordInboundCallEndedParams {
  providerCallId: string;
  durationSeconds: number;
  endedReason: string;
  recordingUrl?: string;
}

/**
 * Updates the inbound `calls` row identified by `provider_call_id` with end
 * metadata. No-op when no inbound row exists for the provider call id (e.g.
 * the call-start webhook arrived before any recent outbound call existed).
 */
export async function recordInboundCallEnded(
  params: RecordInboundCallEndedParams,
): Promise<void> {
  const [row] = await withSystemContext((tx) =>
    tx
      .select({ id: calls.id, org_id: calls.org_id })
      .from(calls)
      .where(
        and(
          eq(calls.provider_call_id, params.providerCallId),
          eq(calls.direction, 'inbound'),
        ),
      )
      .limit(1),
  );
  if (!row) return;

  await withOrgContext(row.org_id, async (tx) => {
    await tx
      .update(calls)
      .set({
        status: 'completed',
        ended_at: new Date(),
        billable_seconds: Math.max(0, Math.round(params.durationSeconds)),
        ...(params.recordingUrl !== undefined && { recording_path: params.recordingUrl }),
      })
      .where(eq(calls.id, row.id));

    await recordAudit(tx, {
      orgId: row.org_id,
      actorType: 'webhook',
      action: 'inbound_call.ended',
      subjectType: 'call',
      subjectId: row.id,
      metadata: {
        durationSeconds: params.durationSeconds,
        endedReason: params.endedReason,
        providerCallId: params.providerCallId,
      },
    });
  });
}

interface RecordInboundOptoutParams {
  /** Vapi call id, used to locate the inbound `calls` row for outcome update. */
  providerCallId: string;
  callerNumber: string;
}

export interface InboundOptoutResult {
  /** Distinct orgs that were enroled in opt-out for this caller. */
  enroledOrgIds: string[];
}

/**
 * Handles the inbound IVR `register_inbound_optout` tool invocation: enrols
 * the inbound caller in the opt-out registry of every org that recently
 * dialed them.
 *
 * Per plan 10 task 11:
 *   - call `findRecentOutboundCallsToNumber`
 *   - for each unique org: insert into `opt_out_registry` with source
 *     `inbound_ivr` (idempotent on the unique constraint), flip every matching
 *     contact's `opt_out` flag, and write an audit row.
 *
 * When an inbound `calls` row exists for `providerCallId`, also marks its
 * outcome as `do_not_call` so the inbound row reflects the IVR's resolution.
 */
export async function recordInboundOptout(
  params: RecordInboundOptoutParams,
): Promise<InboundOptoutResult> {
  const recent = await findRecentOutboundCallsToNumber(params.callerNumber);

  // Dedupe by orgId — the lookup may return multiple calls per org.
  const orgIds = Array.from(new Set(recent.map((r) => r.orgId)));

  // Routes through the unified opt-out service (plan 11 task 5) so every
  // inbound IVR opt-out also flips matching contact rows, writes the audit
  // entry, and emits `compliance/opt-out-registered` consistently with the
  // other four sources.
  const events: InngestEventPayload[] = [];
  for (const orgId of orgIds) {
    const orgEvents = await withOrgContext(orgId, (tx) =>
      markOptOutInTx(tx, {
        orgId,
        phoneE164: params.callerNumber,
        source: 'inbound_ivr',
        actorType: 'webhook',
        metadata: { providerCallId: params.providerCallId },
      }),
    );
    events.push(...orgEvents);
  }

  // Mark the inbound calls row's outcome so it reads "do_not_call" in the
  // operations dashboard. Locating it requires system context because we have
  // not preserved the inbound row's org through the tool call.
  const [inboundRow] = await withSystemContext((tx) =>
    tx
      .select({ id: calls.id, org_id: calls.org_id })
      .from(calls)
      .where(
        and(
          eq(calls.provider_call_id, params.providerCallId),
          eq(calls.direction, 'inbound'),
        ),
      )
      .orderBy(desc(calls.created_at))
      .limit(1),
  );
  if (inboundRow) {
    await withOrgContext(inboundRow.org_id, async (tx) => {
      await tx
        .update(calls)
        .set({ outcome: 'do_not_call' })
        .where(eq(calls.id, inboundRow.id));
    });
  }

  if (events.length > 0) {
    await sendInngestEvents(events);
  }

  return { enroledOrgIds: orgIds };
}
