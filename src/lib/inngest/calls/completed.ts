/**
 * Inngest handler: call-completed
 *
 * Orchestrates all post-call processing steps in strict order:
 * 1. persist-artifacts  — download recording + transcript from provider
 * 2. charge-credit      — apply billing charge to ledger (idempotent safety net)
 * 3. classify-if-needed — emit call/classify if no tool-driven outcome was set
 * 4. update-campaign-stats — increment campaign's actual_cents counter
 * 5. emit-downstream    — fire appointment.booked / do-not-call events
 *
 * Step ordering is intentional: charge happens after the call duration is
 * persisted (by the webhook handler) but before classification so that a
 * classification failure never blocks billing.  Retry scheduling (step 6)
 * runs last so a retry is only booked after billing succeeds.
 *
 * When wired with the Inngest SDK each `step.run(...)` call gets automatic
 * retry and checkpointing.  For now the functions are plain async helpers that
 * can be called sequentially by the SDK or by tests.
 */

import { and, eq, sql } from 'drizzle-orm';

import { withOrgContext, withSystemContext } from '@/lib/db/context';
import { calls, campaigns } from '@/lib/db/schema';
import { checkAndFinaliseCampaignCompletion } from '@/lib/inngest/campaigns/completed';
import { CAMPAIGN_DISPATCH_CALL_EVENT } from '@/lib/inngest/campaigns/events';
import { sendInngestEvent } from '@/lib/inngest/client';
import { APPOINTMENT_BOOKED_EVENT } from '@/lib/inngest/voice/events';
import { classifyAndFinaliseCall } from '@/lib/services/calls';
import { chargeForCall } from '@/lib/services/credit';
import { persistCallArtifacts } from '@/lib/voice/persistence';

import type { CampaignDispatchCallData } from '../campaigns/events';
import type { CallCompletedData } from '../voice/events';

// ─── Retry constants ──────────────────────────────────────────────────────────

/** Maximum number of attempts per contact per campaign (spec §10.2). */
export const MAX_RETRY_ATTEMPTS = 3;

/**
 * Minimum delay between retry attempts in hours (spec §10.2).
 * Ensures at least 48 hours pass before a follow-up call.
 */
const MIN_RETRY_DELAY_HOURS = 48;

/**
 * Additional random offset range (hours) applied on top of the 48h minimum.
 * This shifts the retry to a different time-of-day (≥3h from the original).
 * A random value in [3, 7) hours is added, producing a 3–7h time-of-day delta.
 */
const RETRY_TIME_OFFSET_HOURS_MIN = 3;
const RETRY_TIME_OFFSET_HOURS_RANGE = 4;

// ─── Step implementations ─────────────────────────────────────────────────────

/**
 * Persists call recording and transcript to Supabase Storage.
 * Delegates to the voice/persistence layer — see plan 08 for full detail.
 * Re-throws `RecordingNotReadyError` so Inngest can schedule a retry.
 */
export async function persistCallArtifactsStep(callId: string): Promise<void> {
  await persistCallArtifacts(callId);
}

/**
 * Applies the call's billing charge to the org's credit ledger.
 *
 * This is a safety net: `recordCallEnded` already calls `chargeForCall` in the
 * webhook handler, but that call might fail under transient errors.  Because
 * `chargeForCall` is idempotent on `callId` (ON CONFLICT DO NOTHING), running
 * it again inside this Inngest step is safe and simply a no-op if billing was
 * already recorded.
 */
export async function chargeCallToLedger(callId: string): Promise<void> {
  // Look up the call via system context to get org_id and persisted cost
  const [row] = await withSystemContext((tx) =>
    tx
      .select({ org_id: calls.org_id, cost_cents: calls.cost_cents })
      .from(calls)
      .where(eq(calls.id, callId))
      .limit(1),
  );

  if (!row) return; // call not found — nothing to charge

  const costCents = row.cost_cents ?? 0;
  if (costCents <= 0) return; // free call — nothing to charge

  await chargeForCall(row.org_id, callId, costCents);
}

/**
 * Updates the campaign's `actual_cents` to reflect the total cost of all
 * completed calls so the dashboard can display accurate spend figures.
 *
 * Uses a subquery-based SET to avoid read-modify-write races; idempotent on
 * repeated runs because the subquery always produces the correct total.
 */
export async function incrementCampaignCounters(callId: string): Promise<void> {
  // Resolve org_id and campaign_id via system context (no RLS bypass — just
  // need to find the row before switching to org context for the update)
  const [row] = await withSystemContext((tx) =>
    tx
      .select({ org_id: calls.org_id, campaign_id: calls.campaign_id })
      .from(calls)
      .where(eq(calls.id, callId))
      .limit(1),
  );

  if (!row) return;

  const { org_id: orgId, campaign_id: campaignId } = row;

  // Recompute the total cost for all calls in this campaign and write it back.
  // Using a correlated subquery ensures idempotency: double-execution always
  // produces the correct sum rather than double-adding a delta.
  await withOrgContext(orgId, async (tx) => {
    await tx
      .update(campaigns)
      .set({
        actual_cents: sql<number>`(
          SELECT COALESCE(SUM(${calls.cost_cents}), 0)
          FROM ${calls}
          WHERE ${calls.campaign_id} = ${campaignId}
            AND ${calls.org_id} = ${orgId}
            AND ${calls.cost_cents} IS NOT NULL
        )`,
        updated_at: new Date(),
      })
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.org_id, orgId)));
  });
}

/**
 * Emits downstream Inngest events based on the call's outcome.
 *
 * - `appointment_booked`  → `appointment/booked` (consumed by plan 13 CRM sync)
 * - `do_not_call`         → `contact/do-not-call` (consumed by plan 06 opt-out flow)
 *
 * Idempotent: each event is sent with a deterministic id so duplicate
 * deliveries are deduped by Inngest.
 */
export async function emitOutcomeEvents(callId: string): Promise<void> {
  const [row] = await withSystemContext((tx) =>
    tx
      .select({
        org_id: calls.org_id,
        contact_id: calls.contact_id,
        campaign_id: calls.campaign_id,
        outcome: calls.outcome,
      })
      .from(calls)
      .where(eq(calls.id, callId))
      .limit(1),
  );

  if (!row?.outcome) return; // no outcome yet — classification pending

  const { org_id: orgId, contact_id: contactId, campaign_id: campaignId, outcome } = row;

  if (outcome === 'appointment_booked') {
    await sendInngestEvent({
      name: APPOINTMENT_BOOKED_EVENT,
      data: { callId, orgId, campaignId, contactId },
      id: `appointment-booked-${callId}`,
    });
  }

  if (outcome === 'do_not_call') {
    await sendInngestEvent({
      name: 'contact/do-not-call',
      data: { callId, orgId, contactId },
      id: `do-not-call-${callId}`,
    });
  }
}

// ─── Retry scheduling ─────────────────────────────────────────────────────────

/**
 * Schedules a follow-up dispatch if the call ended in a retryable state.
 *
 * Retryable terminal states: `no_answer`, `busy`.
 *
 * Per spec §10.2:
 *  - Max 3 attempts per contact per campaign.
 *  - Minimum 48h between attempts.
 *  - Second attempt scheduled at a different time-of-day (≥3h offset from the
 *    original call's hour, implemented via a 3–7h random additional offset).
 *
 * When a retry is warranted:
 *  1. A new `calls` row is created in `pending` state with `attempt_number + 1`.
 *  2. A `campaign/dispatch-call` event is sent with `scheduledFor` set to the
 *     computed future time, causing the dispatch handler to sleep until then.
 *
 * When max attempts is reached, the current call is marked
 * `failed / max_attempts_reached` and no further event is sent.
 */
export async function scheduleRetryIfNeeded(callId: string): Promise<void> {
  const [call] = await withSystemContext((tx) =>
    tx
      .select({
        org_id: calls.org_id,
        campaign_id: calls.campaign_id,
        contact_id: calls.contact_id,
        status: calls.status,
        attempt_number: calls.attempt_number,
        started_at: calls.started_at,
      })
      .from(calls)
      .where(eq(calls.id, callId))
      .limit(1),
  );

  if (!call) return;

  // Only retry on retryable statuses
  if (call.status !== 'no_answer' && call.status !== 'busy') return;

  if (call.attempt_number >= MAX_RETRY_ATTEMPTS) {
    // Max attempts exhausted — mark the call as definitively failed
    await withOrgContext(call.org_id, async (tx) => {
      await tx
        .update(calls)
        .set({ status: 'failed', error_code: 'max_attempts_reached' })
        .where(and(eq(calls.id, callId), eq(calls.org_id, call.org_id)));
    });
    // The original `call/completed` that triggered this handler reaches
    // `campaignCompletedHandler` in parallel; that path saw the source row
    // still in `no_answer`/`busy` (a terminal state), so it considered this
    // call already finished. But once we flip to `failed/max_attempts_reached`
    // we still need to finalise here in case our flip happened after the
    // parallel handler ran (or replaces a non-terminal status).
    await checkAndFinaliseCampaignCompletion(call.org_id, call.campaign_id);
    return;
  }

  // Compute the earliest retry time: 48h + random 3–7h offset from call start.
  // The offset ensures the second attempt falls at a different time-of-day
  // (≥3h from the original).  The dispatch handler's time-window gate will
  // further adjust to the next open window if the computed time falls outside
  // the 09:00–19:00 envelope.
  const base = call.started_at ?? new Date();
  const offsetHours =
    MIN_RETRY_DELAY_HOURS +
    RETRY_TIME_OFFSET_HOURS_MIN +
    Math.random() * RETRY_TIME_OFFSET_HOURS_RANGE;
  const scheduledFor = new Date(base.getTime() + offsetHours * 3600 * 1000).toISOString();

  const nextAttempt = call.attempt_number + 1;

  // Create a new pending call row for the retry so the dashboard immediately
  // reflects the upcoming attempt.
  const [newCall] = await withOrgContext(call.org_id, async (tx) =>
    tx
      .insert(calls)
      .values({
        org_id: call.org_id,
        campaign_id: call.campaign_id,
        contact_id: call.contact_id,
        provider: 'vapi',
        status: 'pending',
        attempt_number: nextAttempt,
      })
      .returning({ id: calls.id }),
  );

  if (!newCall) return;

  // Send the future dispatch event (idempotent via deterministic id).
  await sendInngestEvent({
    name: CAMPAIGN_DISPATCH_CALL_EVENT,
    data: {
      campaignId: call.campaign_id,
      orgId: call.org_id,
      contactId: call.contact_id,
      callId: newCall.id,
      attempt: nextAttempt,
      scheduledFor,
    } satisfies CampaignDispatchCallData,
    id: `retry-${callId}-attempt-${nextAttempt}`,
  });
}

// ─── Main handler ─────────────────────────────────────────────────────────────

/**
 * Handles the `call/completed` event.
 *
 * Executes post-call processing steps in strict order.  Each step function is
 * designed to be called inside a `step.run(...)` block when the Inngest SDK is
 * fully wired up; until then they run sequentially here.
 *
 * Step order (must not be changed without updating the design note above):
 *   1. persist-artifacts  — blocking; later steps need the stored paths
 *   2. charge-credit      — idempotent safety net; charge before classification
 *   3. classify-if-needed — can fail without affecting 1 or 2
 *   4. update-campaign-stats — aggregation; non-blocking for billing
 *   5. emit-downstream    — fire-and-forward; last so no side-effects on retry
 *   6. schedule-retry     — only if no_answer/busy; runs after billing succeeds
 */
export async function callCompletedHandler(data: CallCompletedData): Promise<void> {
  const { callId } = data;

  // Step 1: persist recording + transcript to storage
  await persistCallArtifactsStep(callId);

  // Step 2: ensure billing charge is recorded (idempotent)
  await chargeCallToLedger(callId);

  // Step 3: emit call/classify if no tool-driven outcome was set
  await classifyAndFinaliseCall(callId);

  // Step 4: update campaign-level cost counter
  await incrementCampaignCounters(callId);

  // Step 5: emit downstream events for CRM / opt-out integrations
  await emitOutcomeEvents(callId);

  // Step 6: schedule a retry if the call ended in a retryable state
  // (no_answer or busy) and attempts < MAX_RETRY_ATTEMPTS
  await scheduleRetryIfNeeded(callId);
}
