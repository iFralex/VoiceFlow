import { TZDate } from '@date-fns/tz';
import { and, count, desc, eq, gt, inArray, ne } from 'drizzle-orm';

import { recordAudit } from '@/lib/db/audit';
import { withOrgContext } from '@/lib/db/context';
import { calls, contacts, phoneNumbers } from '@/lib/db/schema';
import { sendInngestEvent } from '@/lib/inngest/client';
import { CREDIT_LOW_BALANCE_EVENT } from '@/lib/inngest/handlers/credit';
import { dispatchCall as dispatchCallToProvider } from '@/lib/services/calls';
import { requireRunning } from '@/lib/services/campaigns';
import { getBalance } from '@/lib/services/credit';
import { nextWindowOpen } from '@/lib/utils/time-window';

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
  await withOrgContext(orgId, async (tx) => {
    // Status filter prevents overwriting a call that already reached a terminal
    // state (e.g. webhook delivered `completed` between dispatch failure and
    // dead-letter). Only non-terminal rows are eligible to be marked failed.
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
      .returning({ id: calls.id });

    if (updated.length === 0) return;

    await recordAudit(tx, {
      orgId,
      actorType: 'system',
      action: 'call.failed',
      subjectType: 'call',
      subjectId: callId,
      metadata: { reason: 'provider_error' },
    });
  });
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
    console.error('[dispatch] Provider degradation check failed for campaign', campaignId, e);
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

// ─── Credit check ────────────────────────────────────────────────────────────

/**
 * Verifies there is sufficient credit to attempt a call.
 *
 * If the balance is at or below the minimum threshold:
 *   1. Marks the call as failed with error_code='insufficient_credit'.
 *   2. Emits a `credit/low-balance` event for downstream alerting.
 *   3. Throws `InsufficientCreditError`.
 */
export async function verifyCreditAvailable(orgId: string, callId: string): Promise<void> {
  const { balanceCents, remainingMinutes } = await getBalance(orgId);
  if (balanceCents > MIN_BALANCE_CENTS) return;

  // Mark the pre-created call row as failed
  await withOrgContext(orgId, async (tx) => {
    await tx
      .update(calls)
      .set({ status: 'failed', error_code: 'insufficient_credit' })
      .where(and(eq(calls.id, callId), eq(calls.org_id, orgId)));
  });

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

  throw new InsufficientCreditError(orgId);
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
      // Mark call as failed with the specific reason as error_code
      await withOrgContext(orgId, async (tx) => {
        await tx
          .update(calls)
          .set({ status: 'failed', error_code: err.reason })
          .where(and(eq(calls.id, callId), eq(calls.org_id, orgId)));
      });
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
    await withOrgContext(orgId, async (tx) => {
      await tx
        .update(calls)
        .set({ status: 'failed', error_code: 'cooldown_org_level' })
        .where(and(eq(calls.id, callId), eq(calls.org_id, orgId)));
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
    });
    return null;
  }

  // 6. Credit check
  await verifyCreditAvailable(orgId, callId);

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
  await dispatchCallToProvider(orgId, callId);

  return null;
}
