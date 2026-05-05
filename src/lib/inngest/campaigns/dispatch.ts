import { and, count, eq, inArray } from 'drizzle-orm';

import { withOrgContext } from '@/lib/db/context';
import { calls, contacts } from '@/lib/db/schema';
import { sendInngestEvent } from '@/lib/inngest/client';
import { CREDIT_LOW_BALANCE_EVENT } from '@/lib/inngest/handlers/credit';
import { dispatchCall as dispatchCallToProvider } from '@/lib/services/calls';
import { requireRunning } from '@/lib/services/campaigns';
import { getBalance } from '@/lib/services/credit';

import type { CampaignDispatchCallData } from './events';

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
 * Determines whether we are currently inside the call time window.
 *
 * Returns `null` when inside the window (OK to call now).
 * Returns a `Date` (the next window-open instant) when outside the window.
 *
 * Window strings are "HH:MM" in 24-hour format, e.g. "09:00" and "19:00".
 * Only weekdays (Mon–Fri) are considered valid call days.
 *
 * This function is a pure helper; in production Inngest functions the caller
 * uses `step.sleepUntil(nextWindowOpen(...))` when the return value is non-null.
 */
export function nextWindowOpen(
  now: Date,
  windowStart: string,
  windowEnd: string,
  tz: string = DEFAULT_TZ,
): Date | null {
  // Parse "HH:MM" strings
  const [startHStr, startMStr] = windowStart.split(':');
  const [endHStr, endMStr] = windowEnd.split(':');
  const startH = parseInt(startHStr ?? '9', 10);
  const startM = parseInt(startMStr ?? '0', 10);
  const endH = parseInt(endHStr ?? '19', 10);
  const endM = parseInt(endMStr ?? '0', 10);

  // Convert `now` to local wall-clock in the target timezone
  const localStr = now.toLocaleString('en-US', { timeZone: tz, hour12: false });
  const localDate = new Date(localStr);
  const dayOfWeek = localDate.getDay(); // 0 = Sun, 6 = Sat
  const localH = localDate.getHours();
  const localMin = localDate.getMinutes();

  const nowMinutes = localH * 60 + localMin;
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
  const insideWindow = isWeekday && nowMinutes >= startMinutes && nowMinutes < endMinutes;

  if (insideWindow) return null;

  // Build a mutable local-time candidate
  const candidate = new Date(localDate);
  candidate.setSeconds(0, 0);

  if (isWeekday && nowMinutes < startMinutes) {
    // Same weekday, before window start
    candidate.setHours(startH, startM, 0, 0);
  } else {
    // After window end, or on weekend — advance to next calendar day then skip weekends
    candidate.setDate(candidate.getDate() + 1);
    candidate.setHours(startH, startM, 0, 0);
    while (candidate.getDay() === 0 || candidate.getDay() === 6) {
      candidate.setDate(candidate.getDate() + 1);
    }
  }

  // `candidate` is expressed in local (tz-naïve) wall-clock time.
  // We return it as a UTC Date so callers can use it with step.sleepUntil.
  // Re-parse through toLocaleString to map back to UTC.
  const utcMs =
    candidate.getTime() - (localDate.getTime() - now.getTime());

  return new Date(utcMs);
}

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

  // Alert downstream systems
  await sendInngestEvent({
    name: CREDIT_LOW_BALANCE_EVENT,
    data: { orgId, balanceCents, remainingMinutes } satisfies {
      orgId: string;
      balanceCents: number;
      remainingMinutes: number;
    },
    id: `credit-low-${orgId}-${Date.now()}`,
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

  // 6. Credit check
  await verifyCreditAvailable(orgId, callId);

  // 7. Dispatch to voice provider
  await dispatchCallToProvider(orgId, callId);

  return null;
}
