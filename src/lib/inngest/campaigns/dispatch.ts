import { TZDate } from '@date-fns/tz';
import { and, count, desc, eq, gt, inArray, isNull, ne, sql } from 'drizzle-orm';

import { getRpoClient, type RpoClient } from '@/lib/compliance/rpo/client';
import { recordAudit } from '@/lib/db/audit';
import { withOrgContext, withSystemContext } from '@/lib/db/context';
import { calls, contacts, phoneNumbers, rpoSnapshots } from '@/lib/db/schema';
import { sendInngestEvent, sendInngestEvents } from '@/lib/inngest/client';
import { logger } from '@/lib/observability/logger';
import type { InngestEventPayload } from '@/lib/inngest/client';
import { CREDIT_LOW_BALANCE_EVENT } from '@/lib/inngest/handlers/credit';
import {
  dispatchCall as dispatchCallToProvider,
  NoPhoneNumberAvailableError,
} from '@/lib/services/calls';
import { requireRunning } from '@/lib/services/campaigns';
import { getBalance } from '@/lib/services/credit';
import { markOptOutInTx } from '@/lib/services/optout';
import { nextWindowOpen } from '@/lib/utils/time-window';

import { checkAndFinaliseCampaignCompletion } from './completed';

export { nextWindowOpen };

import type { CampaignDispatchCallData, VoiceProviderDegradedData } from './events';
import { VOICE_PROVIDER_DEGRADED_EVENT } from './events';

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_TZ = 'Europe/Rome';
/** Minimum balance (in cents) required to attempt a call. */
const MIN_BALANCE_CENTS = 100;

/**
 * Per-campaign concurrency enforcement — design note
 * ─────────────────────────────────────────────────────────────────────────────
 * Inngest's `concurrency` configuration is evaluated at function-definition
 * time, so the `limit` field must be a static number.  We CAN use a dynamic
 * key expression such as `event.data.orgId` to bucket runs, but every bucket
 * always uses the same static ceiling.  This makes it impossible to express
 * "campaign A allows 5 concurrent calls while campaign B allows 10".
 *
 * Trade-off:
 *   Inngest static config   → zero application code; guaranteed by Inngest
 *                             scheduler; but limit is platform-wide or
 *                             per-org, never per-campaign.
 *   In-band Postgres count  → enforced inside `dispatch-call` step; reads
 *                             `calls` table for active (dialing|in_progress)
 *                             rows; slightly racy under high fan-out but
 *                             acceptable for typical campaign sizes (< 10k
 *                             concurrent calls); no external locking needed.
 *
 * We choose the Postgres counting approach so each campaign can respect its
 * own `concurrency_limit`.  When the limit is hit the handler returns
 * `{ deferUntil }` and the Inngest step re-executes after a short delay.
 */

// ─── Error types ─────────────────────────────────────────────────────────────

export class ContactNotEligibleError extends Error {
  constructor(
    public readonly contactId: string,
    public readonly reason: string,
  ) {
    super(`Contact ${contactId} is no longer eligible: ${reason}`);
    this.name = 'ContactNotEligibleError';
  }
}

export class InsufficientCreditError extends Error {
  constructor(public readonly orgId: string) {
    super(`Insufficient credit for org ${orgId}`);
    this.name = 'InsufficientCreditError';
  }
}

// ─── Provider degradation detection ──────────────────────────────────────────

/**
 * Sliding window (ms) used for provider degradation detection.
 * Counts provider errors vs. total terminal calls in this window.
 */
export const PROVIDER_DEGRADATION_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Fraction of dispatches that must fail with `provider_error` within the
 * detection window before `system/voice-provider-degraded` is emitted.
 */
export const PROVIDER_DEGRADATION_THRESHOLD = 0.05; // 5%

/**
 * Marks a single call as definitively failed due to a voice-provider error.
 *
 * Called by the `onDispatchFailure` handler after all Inngest retry attempts
 * for `campaign/dispatch-call` are exhausted.
 *
 * Credit note: no immediate per-call credit release is performed here.
 * The campaign reservation is released in aggregate by `markCampaignCompleted`
 * → `releaseReservation` once all calls reach a terminal state.  Because a
 * `provider_error` call has no `charge` ledger entry, its estimated cost is
 * automatically included in the unused portion returned at campaign close.
 */
export async function markCallProviderError(orgId: string, callId: string): Promise<void> {
  // Status filter prevents overwriting a call that already reached a terminal
  // state (e.g. webhook delivered `completed` between dispatch failure and
  // dead-letter). Only non-terminal rows are eligible to be marked failed.
  const flipped = await withOrgContext(orgId, async (tx) => {
    const updated = await tx
      .update(calls)
      .set({ status: 'failed', error_code: 'provider_error' })
      .where(
        and(
          eq(calls.id, callId),
          eq(calls.org_id, orgId),
          inArray(calls.status, ['pending', 'dialing', 'in_progress']),
        ),
      )
      .returning({ id: calls.id, campaign_id: calls.campaign_id });

    if (updated.length === 0) return null;

    await recordAudit(tx, {
      orgId,
      actorType: 'system',
      action: 'call.failed',
      subjectType: 'call',
      subjectId: callId,
      metadata: { reason: 'provider_error' },
    });

    return updated[0]!;
  });

  // If we just flipped the call to a terminal state, check whether the campaign
  // can now be finalised. Without this, a campaign whose remaining calls all
  // dead-letter will stay `running` forever (no `call/completed` is emitted
  // for non-webhook terminal paths).
  if (flipped?.campaign_id) {
    await checkAndFinaliseCampaignCompletion(orgId, flipped.campaign_id);
  }
}

/**
 * Checks whether the provider error rate for a campaign exceeds the
 * degradation threshold (default 5%) within the last 10-minute window.
 *
 * The window uses `calls.created_at` as a proxy for dispatch time — calls are
 * created at planning time (immediately before dispatch events are sent), so
 * this gives a reasonable signal for recently-active campaigns.
 *
 * When the threshold is exceeded, emits `system/voice-provider-degraded`
 * with a deduplicated event id scoped to the current 10-minute slot, so at
 * most one alert fires per window per campaign.
 */
export async function checkProviderDegradation(orgId: string, campaignId: string): Promise<void> {
  const windowStart = new Date(Date.now() - PROVIDER_DEGRADATION_WINDOW_MS);

  const terminalStatuses = ['failed', 'completed', 'no_answer', 'voicemail', 'busy'] as const;

  const rows = await withOrgContext(orgId, (tx) =>
    tx
      .select({ error_code: calls.error_code })
      .from(calls)
      .where(
        and(
          eq(calls.org_id, orgId),
          eq(calls.campaign_id, campaignId),
          gt(calls.created_at, windowStart),
          inArray(calls.status, [...terminalStatuses]),
        ),
      ),
  );

  const totalCount = rows.length;
  if (totalCount === 0) return;

  const errorCount = rows.filter((r) => r.error_code === 'provider_error').length;
  const errorRate = errorCount / totalCount;

  if (errorRate <= PROVIDER_DEGRADATION_THRESHOLD) return;

  // Deduplicate: one alert per campaign per 10-minute slot
  const windowSlot = Math.floor(Date.now() / PROVIDER_DEGRADATION_WINDOW_MS);

  await sendInngestEvent({
    name: VOICE_PROVIDER_DEGRADED_EVENT,
    data: {
      orgId,
      campaignId,
      errorCount,
      totalCount,
      errorRate,
    } satisfies VoiceProviderDegradedData,
    id: `provider-degraded-${campaignId}-${windowSlot}`,
  });
}

/**
 * Dead-letter handler for `campaign/dispatch-call` — called after all Inngest
 * retry attempts are exhausted (i.e. the voice provider rejected the call 3
 * times in a row).
 *
 * Responsibilities:
 * 1. Mark the call `failed / provider_error`.
 * 2. Check whether the per-campaign provider error rate in the last 10 minutes
 *    exceeds the degradation threshold (5%) and emit an alert event if so.
 *
 * This function should be wired to the Inngest function's `onFailure` callback
 * once the Inngest SDK is fully integrated (plan 09 follow-up).
 */
export async function onDispatchFailure(data: CampaignDispatchCallData): Promise<void> {
  const { orgId, callId, campaignId } = data;

  await markCallProviderError(orgId, callId);

  // Degradation check is best-effort — alert failures must never propagate
  await checkProviderDegradation(orgId, campaignId).catch((e: unknown) => {
    void logger.error('[dispatch] Provider degradation check failed', {
      campaign_id: campaignId,
      error: e instanceof Error ? e.message : String(e),
    });
  });
}

// ─── Org-level cooldown ───────────────────────────────────────────────────────

/** Default cross-campaign contact cooldown: 7 days in milliseconds. */
export const DEFAULT_ORG_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Checks whether the contact has been called by any **other** campaign in the
 * same org within the cooldown window (default 7 days).
 *
 * Returns the `created_at` timestamp of the most recent such call when a
 * cooldown applies, or `null` when the contact is safe to call.
 *
 * Purpose: prevents a contact from being double-called by multiple campaigns
 * running concurrently in the same org within the cooldown period.
 */
export async function checkOrgLevelCooldown(
  orgId: string,
  campaignId: string,
  contactId: string,
  cooldownMs: number = DEFAULT_ORG_COOLDOWN_MS,
): Promise<Date | null> {
  const cutoff = new Date(Date.now() - cooldownMs);

  const [recentCall] = await withOrgContext(orgId, (tx) =>
    tx
      .select({ created_at: calls.created_at })
      .from(calls)
      .where(
        and(
          eq(calls.org_id, orgId),
          eq(calls.contact_id, contactId),
          ne(calls.campaign_id, campaignId),
          gt(calls.created_at, cutoff),
        ),
      )
      .orderBy(desc(calls.created_at))
      .limit(1),
  );

  return recentCall?.created_at ?? null;
}

// ─── Per-org daily call cap ───────────────────────────────────────────────────

/** Default maximum calls an org can place in a single calendar day (Rome time). */
export const DEFAULT_ORG_DAILY_CAP = 5_000;

/**
 * Checks whether the org has reached its daily call cap.
 *
 * The daily window is aligned to midnight in the `Europe/Rome` timezone so the
 * cap resets at the start of the local business day.
 *
 * Returns `null` when under the cap (proceed with dispatch).
 * Returns a `Date` (midnight tomorrow, Rome time) when the cap is reached or
 * exceeded — the caller should sleep until then and retry.
 */
export async function checkOrgDailyCallCap(
  orgId: string,
  dailyCap: number = DEFAULT_ORG_DAILY_CAP,
): Promise<Date | null> {
  const now = new Date();
  const tzNow = new TZDate(now, DEFAULT_TZ);

  const midnightToday = new TZDate(
    tzNow.getFullYear(),
    tzNow.getMonth(),
    tzNow.getDate(),
    0,
    0,
    0,
    0,
    DEFAULT_TZ,
  );

  const [row] = await withOrgContext(orgId, (tx) =>
    tx
      .select({ cnt: count() })
      .from(calls)
      .where(
        and(
          eq(calls.org_id, orgId),
          gt(calls.created_at, midnightToday),
        ),
      ),
  );

  const todayCount = row?.cnt ?? 0;
  if (todayCount < dailyCap) return null;

  // Cap reached — return midnight tomorrow (Rome time)
  const midnightTomorrow = new TZDate(
    tzNow.getFullYear(),
    tzNow.getMonth(),
    tzNow.getDate() + 1,
    0,
    0,
    0,
    0,
    DEFAULT_TZ,
  );
  return new Date(midnightTomorrow.getTime());
}

// ─── Per-CLI hourly cap ───────────────────────────────────────────────────────

/**
 * Default maximum calls per CLI (phone number) per hour.
 * Aligns with plan 10's per-number rate-cap to protect the org's CLI
 * reputation and comply with Twilio/Telnyx rate limits.
 */
export const DEFAULT_CLI_HOURLY_CAP = 30;

/**
 * Estimates whether all active CLIs (phone numbers) for the org have reached
 * their per-CLI hourly call cap.
 *
 * Because call dispatch in plan 09 does not yet record which CLI was used for
 * each call (that FK is added in plan 10), this function uses a conservative
 * estimate: org-level calls in the last hour ÷ active CLI count.  When the
 * estimated per-CLI rate equals or exceeds the cap, all CLIs are treated as
 * saturated and dispatch is deferred.
 *
 * Returns `null` when capacity is available (at least one CLI is under cap).
 * Returns a `Date` (start of the next clock-hour) when all CLIs appear to be
 * at capacity — the caller should sleep until then.
 */
export async function checkCliHourlyCap(
  orgId: string,
  hourlyCap: number = DEFAULT_CLI_HOURLY_CAP,
): Promise<Date | null> {
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);

  // Count active CLIs for this org
  const [cliRow] = await withOrgContext(orgId, (tx) =>
    tx
      .select({ cnt: count() })
      .from(phoneNumbers)
      .where(
        and(
          eq(phoneNumbers.org_id, orgId),
          eq(phoneNumbers.status, 'active'),
        ),
      ),
  );

  const activeCLIs = cliRow?.cnt ?? 0;
  if (activeCLIs === 0) {
    // No CLIs configured; let the provider step fail naturally
    return null;
  }

  // Count calls dispatched in the last hour for this org
  const [callRow] = await withOrgContext(orgId, (tx) =>
    tx
      .select({ cnt: count() })
      .from(calls)
      .where(
        and(
          eq(calls.org_id, orgId),
          gt(calls.created_at, hourAgo),
        ),
      ),
  );

  const hourlyCallCount = callRow?.cnt ?? 0;

  // If estimated per-CLI rate is below cap, at least one CLI has capacity
  const estimatedPerCLIRate = hourlyCallCount / activeCLIs;
  if (estimatedPerCLIRate < hourlyCap) return null;

  // All CLIs appear saturated — sleep until the start of the next clock-hour
  const now = new Date();
  const nextHour = new Date(now);
  nextHour.setMinutes(0, 0, 0);
  nextHour.setTime(nextHour.getTime() + 60 * 60 * 1000);
  return nextHour;
}

// ─── Concurrency gate ─────────────────────────────────────────────────────────

/** How long to defer a dispatch when the campaign's concurrency slot is full. */
const CONCURRENCY_DEFER_SECONDS = 30;

/**
 * Returns the number of calls in `dialing` or `in_progress` state for the
 * given campaign, reflecting current active concurrency usage.
 */
export async function getActiveConcurrencyCount(
  orgId: string,
  campaignId: string,
): Promise<number> {
  const [row] = await withOrgContext(orgId, (tx) =>
    tx
      .select({ cnt: count() })
      .from(calls)
      .where(
        and(
          eq(calls.org_id, orgId),
          eq(calls.campaign_id, campaignId),
          inArray(calls.status, ['dialing', 'in_progress']),
        ),
      ),
  );
  return row?.cnt ?? 0;
}

/**
 * Checks whether a concurrency slot is available for the campaign.
 *
 * Returns `null` when a slot is available (proceed with dispatch).
 * Returns a `Date` (the earliest retry time) when the concurrency limit is
 * already saturated — the caller should defer dispatch until then.
 */
export async function checkConcurrencySlot(
  orgId: string,
  campaignId: string,
  limit: number,
): Promise<Date | null> {
  const active = await getActiveConcurrencyCount(orgId, campaignId);
  if (active < limit) return null;
  // Slot full — suggest a short retry after CONCURRENCY_DEFER_SECONDS
  return new Date(Date.now() + CONCURRENCY_DEFER_SECONDS * 1000);
}

// ─── Time window ─────────────────────────────────────────────────────────────

/**
 * Async wrapper around `nextWindowOpen` for easy use inside `step.run`.
 *
 * Returns `null` when inside the window (dispatch immediately).
 * Returns a `Date` when outside the window (caller should sleep until then).
 */
export async function waitForCallWindow(
  windowStart: string,
  windowEnd: string,
  tz: string = DEFAULT_TZ,
): Promise<Date | null> {
  return nextWindowOpen(new Date(), windowStart, windowEnd, tz);
}

// ─── Eligibility re-check ────────────────────────────────────────────────────

/**
 * Verifies a contact is still eligible for dispatch at call time.
 *
 * Throws `ContactNotEligibleError` if the contact has been deleted, opted out,
 * or RPO-blocked between planning time and actual dispatch. This is a safety
 * net — the contact may have changed state after the eligibility filter ran.
 */
export async function verifyContactStillEligible(
  orgId: string,
  contactId: string,
): Promise<void> {
  const [contact] = await withOrgContext(orgId, (tx) =>
    tx
      .select({
        deleted_at: contacts.deleted_at,
        opt_out: contacts.opt_out,
        rpo_status: contacts.rpo_status,
      })
      .from(contacts)
      .where(and(eq(contacts.id, contactId), eq(contacts.org_id, orgId)))
      .limit(1),
  );

  if (!contact) throw new ContactNotEligibleError(contactId, 'contact_not_found');
  if (contact.deleted_at !== null) throw new ContactNotEligibleError(contactId, 'deleted');
  if (contact.opt_out) throw new ContactNotEligibleError(contactId, 'opted_out');
  if (contact.rpo_status === 'blocked') throw new ContactNotEligibleError(contactId, 'rpo_blocked');
}

// ─── Per-call RPO verification ───────────────────────────────────────────────

/** Snapshots older than this are considered stale and trigger a live re-check. */
export const RPO_STALE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Outcome of {@link verifyRpoCompliance}.
 *
 * - `safe` — proceed with dispatch
 * - `blocked` — the number is on the RPO registry; abort and opt-out
 * - `unverifiable` — live API failed and no snapshot exists; fail closed
 */
export type RpoVerifyDecision = 'safe' | 'blocked' | 'unverifiable';

export interface RpoVerifyOutcome {
  decision: RpoVerifyDecision;
  phoneE164?: string;
}

/**
 * Per-call live RPO verification (plan 11 task 4).
 *
 * Acts as a final safety net just before dialing. B2B contacts are skipped
 * (RPO covers B2C only per Italian regulation). For B2C contacts whose
 * snapshot is missing or older than {@link RPO_STALE_THRESHOLD_MS}, the
 * intermediary is queried live; the result refreshes both `rpo_snapshots`
 * and the contact's `rpo_status`.
 *
 * Failure handling:
 *  - On singleCheck error, fall back to the latest stored snapshot.
 *  - When neither a live answer nor a snapshot is available, the function
 *    returns `unverifiable` so the caller can fail closed.
 */
export async function verifyRpoCompliance(
  orgId: string,
  contactId: string,
  clientOverride?: RpoClient,
): Promise<RpoVerifyOutcome> {
  const [contact] = await withOrgContext(orgId, (tx) =>
    tx
      .select({
        phone_e164: contacts.phone_e164,
        contact_type: contacts.contact_type,
        rpo_status: contacts.rpo_status,
        rpo_checked_at: contacts.rpo_checked_at,
      })
      .from(contacts)
      .where(and(eq(contacts.id, contactId), eq(contacts.org_id, orgId)))
      .limit(1),
  );

  // The eligibility re-check ran first, so a missing row here is unexpected.
  // Treat as safe — eligibility would have already short-circuited if there's
  // a real problem; we don't want to double-report.
  if (!contact) return { decision: 'safe' };

  // RPO covers B2C only per Italian regulation
  if (contact.contact_type === 'b2b') {
    return { decision: 'safe', phoneE164: contact.phone_e164 };
  }

  const cutoff = new Date(Date.now() - RPO_STALE_THRESHOLD_MS);
  const isStale =
    contact.rpo_status === 'unchecked' ||
    contact.rpo_checked_at === null ||
    contact.rpo_checked_at < cutoff;

  if (!isStale) {
    return { decision: 'safe', phoneE164: contact.phone_e164 };
  }

  const phoneE164 = contact.phone_e164;
  const rpoClient = clientOverride ?? getRpoClient();

  let result: { isBlocked: boolean; checkedAt: Date };
  try {
    result = await rpoClient.singleCheck(phoneE164);
  } catch (e) {
    void logger.warn('[dispatch] RPO singleCheck failed; falling back to snapshot', {
      error: e instanceof Error ? e.message : String(e),
    });
    const stale = await fetchRpoSnapshotState(phoneE164);
    if (stale === null) return { decision: 'unverifiable', phoneE164 };
    return { decision: stale ? 'blocked' : 'safe', phoneE164 };
  }

  await persistRpoCheck(orgId, phoneE164, result.isBlocked, result.checkedAt);

  return { decision: result.isBlocked ? 'blocked' : 'safe', phoneE164 };
}

async function fetchRpoSnapshotState(phoneE164: string): Promise<boolean | null> {
  const [snap] = await withSystemContext((tx) =>
    tx
      .select({ is_blocked: rpoSnapshots.is_blocked })
      .from(rpoSnapshots)
      .where(eq(rpoSnapshots.phone_e164, phoneE164))
      .limit(1),
  );
  return snap?.is_blocked ?? null;
}

async function persistRpoCheck(
  orgId: string,
  phoneE164: string,
  isBlocked: boolean,
  checkedAt: Date,
): Promise<void> {
  await withSystemContext(async (tx) => {
    await tx
      .insert(rpoSnapshots)
      .values({ phone_e164: phoneE164, is_blocked: isBlocked, last_checked_at: checkedAt })
      .onConflictDoUpdate({
        target: rpoSnapshots.phone_e164,
        set: {
          is_blocked: sql`excluded.is_blocked`,
          last_checked_at: sql`excluded.last_checked_at`,
        },
      });
  });

  await withOrgContext(orgId, async (tx) => {
    await tx
      .update(contacts)
      .set({
        rpo_status: isBlocked ? 'blocked' : 'clear',
        rpo_checked_at: checkedAt,
      })
      .where(
        and(
          eq(contacts.org_id, orgId),
          eq(contacts.phone_e164, phoneE164),
          isNull(contacts.deleted_at),
        ),
      );
  });
}

// ─── Credit check ────────────────────────────────────────────────────────────

/**
 * Verifies there is sufficient credit to attempt a call.
 *
 * Returns `true` when credit is available (caller proceeds with dispatch).
 *
 * Returns `false` when the balance is at or below the minimum threshold:
 *   1. Marks the call as failed with error_code='insufficient_credit'.
 *   2. Emits a `credit/low-balance` event for downstream alerting.
 *   3. Triggers a campaign-completion check (so a campaign whose calls all hit
 *      this path is finalised rather than stuck in `running`).
 *
 * The graceful return shape avoids forcing Inngest to retry the dispatch step
 * three times before its dead-letter handler no-ops on the already-failed row.
 */
export async function verifyCreditAvailable(
  orgId: string,
  callId: string,
  campaignId: string,
): Promise<boolean> {
  const { balanceCents, remainingMinutes } = await getBalance(orgId);
  if (balanceCents > MIN_BALANCE_CENTS) return true;

  // Mark the pre-created call row as failed. Status filter prevents overwriting
  // a call that already reached a terminal state (e.g. webhook delivered
  // `completed` between the dispatch event firing and this credit check). Only
  // emit the alert + finalisation when this invocation actually flipped status
  // — otherwise duplicate deliveries would spam the credit alert and audit log.
  const flipped = await withOrgContext(orgId, async (tx) => {
    const updated = await tx
      .update(calls)
      .set({ status: 'failed', error_code: 'insufficient_credit' })
      .where(
        and(
          eq(calls.id, callId),
          eq(calls.org_id, orgId),
          inArray(calls.status, ['pending', 'dialing', 'in_progress']),
        ),
      )
      .returning({ id: calls.id });
    return updated.length > 0;
  });

  if (!flipped) return false;

  // Alert downstream systems. Dedupe to one alert per org per 10-minute window
  // so a campaign with hundreds of queued dispatches against an empty wallet
  // doesn't fan-out a fresh event for every retry attempt.
  const lowBalanceWindowSlot = Math.floor(Date.now() / (10 * 60 * 1000));
  await sendInngestEvent({
    name: CREDIT_LOW_BALANCE_EVENT,
    data: { orgId, balanceCents, remainingMinutes } satisfies {
      orgId: string;
      balanceCents: number;
      remainingMinutes: number;
    },
    id: `credit-low-${orgId}-${lowBalanceWindowSlot}`,
  });

  await checkAndFinaliseCampaignCompletion(orgId, campaignId);

  return false;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

/**
 * Handles the `campaign/dispatch-call` event (per-contact).
 *
 * Steps:
 * 1. Load campaign; if not `running` (paused or cancelled), return early.
 * 2. Time-window check — if outside the call window, return the sleep target.
 *    (Production Inngest SDK callers use `step.sleepUntil(result.sleepUntil)`.)
 * 3. Verify the contact is still eligible (may have opted out since planning).
 * 4. Verify credit is available.
 * 5. Dispatch the call to the voice provider.
 *
 * Returns `{ sleepUntil: Date }` when outside the call window (caller sleeps),
 * `{ deferUntil: Date }` when the campaign concurrency limit is saturated
 * (caller should retry after a short delay), or `null` on a completed dispatch
 * (success or graceful skip).
 */
export async function campaignDispatchCallHandler(
  data: CampaignDispatchCallData,
): Promise<{ sleepUntil: Date } | { deferUntil: Date } | null> {
  const { campaignId, orgId, contactId, callId } = data;

  // 0. Scheduled-for gate: enforce minimum delay for retry attempts.
  //    When `scheduledFor` is in the future the caller should sleep until then
  //    before proceeding with the rest of the dispatch steps.
  if (data.scheduledFor) {
    const scheduledDate = new Date(data.scheduledFor);
    if (scheduledDate > new Date()) {
      return { sleepUntil: scheduledDate };
    }
  }

  // 1. Campaign status gate
  const campaign = await requireRunning(orgId, campaignId);
  if (campaign.status !== 'running') {
    // Paused or cancelled — skip gracefully without error
    return null;
  }

  // 2. Time-window gate
  const sleepUntil = await waitForCallWindow(
    campaign.time_window_start,
    campaign.time_window_end,
  );
  if (sleepUntil !== null) {
    return { sleepUntil };
  }

  // 2.5. Per-org daily call cap gate
  //
  // Prevents the org from exceeding its configured daily call limit.  When the
  // cap is reached the handler returns a `sleepUntil` pointing to midnight
  // (Europe/Rome) so the Inngest step re-executes at the start of the next
  // business day rather than immediately retrying.
  const dailyCapSleepUntil = await checkOrgDailyCallCap(orgId);
  if (dailyCapSleepUntil !== null) {
    return { sleepUntil: dailyCapSleepUntil };
  }

  // 3. Per-campaign concurrency gate
  //
  // Counts active calls (dialing|in_progress) against campaign.concurrency_limit.
  // When the limit is saturated we return a short defer signal instead of
  // proceeding — the Inngest caller uses step.sleepUntil(deferUntil) and
  // retries automatically.  See the design note above for the trade-off
  // discussion vs Inngest's built-in static concurrency config.
  const deferUntil = await checkConcurrencySlot(orgId, campaignId, campaign.concurrency_limit);
  if (deferUntil !== null) {
    return { deferUntil };
  }

  // 5. Contact eligibility re-check
  try {
    await verifyContactStillEligible(orgId, contactId);
  } catch (err) {
    if (err instanceof ContactNotEligibleError) {
      // Mark call as failed with the specific reason as error_code. Status
      // filter avoids overwriting a row that has already reached a terminal
      // state since dispatch was queued.
      const flipped = await withOrgContext(orgId, async (tx) => {
        const updated = await tx
          .update(calls)
          .set({ status: 'failed', error_code: err.reason })
          .where(
            and(
              eq(calls.id, callId),
              eq(calls.org_id, orgId),
              inArray(calls.status, ['pending', 'dialing', 'in_progress']),
            ),
          )
          .returning({ id: calls.id });
        return updated.length > 0;
      });
      if (flipped) {
        await checkAndFinaliseCampaignCompletion(orgId, campaignId);
      }
      return null;
    }
    throw err;
  }

  // 5.5 Org-level cross-campaign cooldown check
  //
  // Prevents a contact from being called by multiple campaigns in the same org
  // within the cooldown window (default 7 days).  When a recent call from
  // another campaign is found, the pre-created call row is marked
  // `failed/cooldown_org_level` and an audit entry is written, then the handler
  // returns null (graceful skip — not an error from Inngest's perspective).
  const recentCrossCall = await checkOrgLevelCooldown(orgId, campaignId, contactId);
  if (recentCrossCall !== null) {
    const flipped = await withOrgContext(orgId, async (tx) => {
      const updated = await tx
        .update(calls)
        .set({ status: 'failed', error_code: 'cooldown_org_level' })
        .where(
          and(
            eq(calls.id, callId),
            eq(calls.org_id, orgId),
            inArray(calls.status, ['pending', 'dialing', 'in_progress']),
          ),
        )
        .returning({ id: calls.id });

      if (updated.length === 0) return false;

      await recordAudit(tx, {
        orgId,
        actorType: 'system',
        action: 'call.skipped',
        subjectType: 'call',
        subjectId: callId,
        metadata: {
          reason: 'cooldown_org_level',
          contactId,
          campaignId,
          recentCallAt: recentCrossCall.toISOString(),
        },
      });
      return true;
    });
    if (flipped) {
      await checkAndFinaliseCampaignCompletion(orgId, campaignId);
    }
    return null;
  }

  // 5.7 Per-call live RPO verification (Task 11.4)
  //
  // Final safety net before dialing. For B2C contacts whose snapshot is stale
  // or never checked, we hit the RPO intermediary live. If the number is
  // blocked, abort dispatch, register the opt-out, and write an audit entry —
  // no provider dispatch happens and no credit is consumed. If the live API
  // is unavailable and no snapshot exists, fail closed.
  const rpoOutcome = await verifyRpoCompliance(orgId, contactId);
  if (rpoOutcome.decision === 'blocked' && rpoOutcome.phoneE164) {
    const blockedPhone = rpoOutcome.phoneE164;
    const result = await withOrgContext(orgId, async (tx) => {
      const updated = await tx
        .update(calls)
        .set({ status: 'failed', error_code: 'rpo_blocked' })
        .where(
          and(
            eq(calls.id, callId),
            eq(calls.org_id, orgId),
            inArray(calls.status, ['pending', 'dialing', 'in_progress']),
          ),
        )
        .returning({ id: calls.id });

      if (updated.length === 0) return { flipped: false, optOutEvents: [] as InngestEventPayload[] };

      // Routes through the unified opt-out service so the registry insert,
      // contact flag, audit log, and `compliance/opt-out-registered` event
      // all stay in sync — same path as call_outcome / dealer_input / etc.
      const optOutEvents = await markOptOutInTx(tx, {
        orgId,
        phoneE164: blockedPhone,
        source: 'rpo_block',
        callId,
        actorType: 'system',
      });

      await recordAudit(tx, {
        orgId,
        actorType: 'system',
        action: 'call.skipped',
        subjectType: 'call',
        subjectId: callId,
        metadata: {
          reason: 'rpo_blocked',
          contactId,
          phoneE164: blockedPhone,
        },
      });
      return { flipped: true, optOutEvents };
    });

    if (result.optOutEvents.length > 0) {
      await sendInngestEvents(result.optOutEvents);
    }
    if (result.flipped) {
      await checkAndFinaliseCampaignCompletion(orgId, campaignId);
    }
    return null;
  }
  if (rpoOutcome.decision === 'unverifiable') {
    const flipped = await withOrgContext(orgId, async (tx) => {
      const updated = await tx
        .update(calls)
        .set({ status: 'failed', error_code: 'rpo_unverifiable' })
        .where(
          and(
            eq(calls.id, callId),
            eq(calls.org_id, orgId),
            inArray(calls.status, ['pending', 'dialing', 'in_progress']),
          ),
        )
        .returning({ id: calls.id });

      if (updated.length === 0) return false;

      await recordAudit(tx, {
        orgId,
        actorType: 'system',
        action: 'call.skipped',
        subjectType: 'call',
        subjectId: callId,
        metadata: { reason: 'rpo_unverifiable', contactId },
      });
      return true;
    });

    if (flipped) {
      await checkAndFinaliseCampaignCompletion(orgId, campaignId);
    }
    return null;
  }

  // 6. Credit check — gracefully skip if balance below threshold (returns false)
  const hasCredit = await verifyCreditAvailable(orgId, callId, campaignId);
  if (!hasCredit) return null;

  // 6.5. Per-CLI hourly cap gate
  //
  // Protects CLI reputation and provider rate limits by estimating the per-CLI
  // call rate over the last hour.  When all active CLIs appear saturated the
  // handler returns a `sleepUntil` pointing to the start of the next clock-hour
  // instead of proceeding to the provider.  CLI-specific tracking (plan 10)
  // will replace this estimate with an exact per-number count.
  const cliCapSleepUntil = await checkCliHourlyCap(orgId);
  if (cliCapSleepUntil !== null) {
    return { sleepUntil: cliCapSleepUntil };
  }

  // 7. Dispatch to voice provider
  //
  // CLI-pool saturation (plan 10 task 4): when every active candidate is at
  // its daily/hourly cap or already locked by a concurrent picker, the picker
  // raises `NoPhoneNumberAvailableError`. Treat this as a transient saturation
  // signal and reschedule the dispatch step in 30 minutes instead of letting
  // it fail through Inngest's retry policy and end up as a permanent
  // provider_error on the call row.
  try {
    await dispatchCallToProvider(orgId, callId);
  } catch (err) {
    if (err instanceof NoPhoneNumberAvailableError) {
      return { sleepUntil: new Date(Date.now() + 30 * 60 * 1000) };
    }
    throw err;
  }

  return null;
}
