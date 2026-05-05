/**
 * Inngest handler: campaign-completed
 *
 * Listens for `call/completed` events. After each call finishes, checks whether
 * the campaign has any remaining active calls (pending | dialing | in_progress).
 * If zero remain, transitions the campaign to `completed`, releases the unused
 * credit reservation, and emits `campaign/completed` for downstream consumers
 * (plan 12: final report email).
 *
 * Double-finalisation is prevented by the conditional UPDATE inside
 * `markCampaignCompleted`: it only updates rows where status IS NOT already
 * 'completed' or 'cancelled', so concurrent invocations produce at most one
 * state transition.
 */

import { and, count, eq, inArray } from 'drizzle-orm';

import { withSystemContext } from '@/lib/db/context';
import { calls } from '@/lib/db/schema';
import { sendInngestEvent } from '@/lib/inngest/client';
import { markCampaignCompleted } from '@/lib/services/campaigns';

import { CAMPAIGN_COMPLETED_EVENT } from './events';
import type { CallCompletedData } from '../voice/events';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Call statuses that are NOT yet terminal. */
const ACTIVE_STATUSES = ['pending', 'dialing', 'in_progress'] as const;

/**
 * Counts calls in non-terminal states for the given campaign.
 * Returns the number of calls that still need to finish before the campaign
 * can be marked completed.
 */
export async function countActiveCalls(campaignId: string, orgId: string): Promise<number> {
  const [row] = await withSystemContext((tx) =>
    tx
      .select({ total: count() })
      .from(calls)
      .where(
        and(
          eq(calls.campaign_id, campaignId),
          eq(calls.org_id, orgId),
          inArray(calls.status, [...ACTIVE_STATUSES]),
        ),
      ),
  );
  return row?.total ?? 0;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

/**
 * Handles the `call/completed` event for campaign-level finalisation.
 *
 * Algorithm:
 * 1. Resolve the campaign and org for the completed call.
 * 2. Count remaining active (non-terminal) calls in that campaign.
 * 3. If none remain, finalise the campaign:
 *    a. Transition status to `completed` (idempotent — no-op if already done).
 *    b. Release the unused credit reservation (done inside markCampaignCompleted).
 *    c. Emit `campaign/completed` event for plan 12 (final report email).
 *
 * This function is designed to be called as a `step.run(...)` block when the
 * Inngest SDK is fully wired up; for now it runs sequentially for testability.
 */
export async function campaignCompletedHandler(data: CallCompletedData): Promise<void> {
  const { callId } = data;

  // Step 1: resolve campaign for this call
  const [callRow] = await withSystemContext((tx) =>
    tx
      .select({ campaign_id: calls.campaign_id, org_id: calls.org_id })
      .from(calls)
      .where(eq(calls.id, callId))
      .limit(1),
  );

  // Call not found or not part of a campaign — nothing to finalise
  if (!callRow?.campaign_id) return;

  const { campaign_id: campaignId, org_id: orgId } = callRow;

  // Step 2: check if any active calls remain
  const activeCount = await countActiveCalls(campaignId, orgId);
  if (activeCount > 0) return;

  // Step 3a+3b: transition to completed and release unused credit (idempotent)
  await markCampaignCompleted(orgId, campaignId);

  // Step 3c: emit campaign/completed for downstream consumers (plan 12)
  await sendInngestEvent({
    name: CAMPAIGN_COMPLETED_EVENT,
    data: { campaignId, orgId },
    id: `campaign-completed-${campaignId}`,
  });
}
