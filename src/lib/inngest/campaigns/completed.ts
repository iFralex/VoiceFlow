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

/**
 * Finalises a campaign when no active calls remain.
 *
 * Algorithm:
 * 1. Count remaining active (non-terminal) calls in the campaign.
 * 2. If none remain, finalise the campaign:
 *    a. Transition status to `completed` (idempotent — no-op if already done).
 *    b. Release the unused credit reservation (done inside markCampaignCompleted).
 *    c. Emit `campaign/completed` event for plan 12 (final report email).
 *
 * This helper is invoked from every code path that reaches a per-call terminal
 * state — both the webhook-driven `call/completed` path and the non-webhook
 * paths (provider error dead-letter, insufficient credit, eligibility/cooldown
 * skips, max-attempts exhaustion). Without this fan-in, campaigns whose calls
 * all terminated via non-webhook paths would remain `running` forever.
 */
export async function checkAndFinaliseCampaignCompletion(
  orgId: string,
  campaignId: string,
): Promise<void> {
  const activeCount = await countActiveCalls(campaignId, orgId);
  if (activeCount > 0) return;

  await markCampaignCompleted(orgId, campaignId);

  await sendInngestEvent({
    name: CAMPAIGN_COMPLETED_EVENT,
    data: { campaignId, orgId },
    id: `campaign-completed-${campaignId}`,
  });
}

// ─── Handler ──────────────────────────────────────────────────────────────────

/**
 * Handles the `call/completed` event for campaign-level finalisation.
 *
 * Resolves the campaign for the completed call and delegates to
 * `checkAndFinaliseCampaignCompletion`.
 */
export async function campaignCompletedHandler(data: CallCompletedData): Promise<void> {
  const { callId } = data;

  const [callRow] = await withSystemContext((tx) =>
    tx
      .select({ campaign_id: calls.campaign_id, org_id: calls.org_id })
      .from(calls)
      .where(eq(calls.id, callId))
      .limit(1),
  );

  if (!callRow?.campaign_id) return;

  await checkAndFinaliseCampaignCompletion(callRow.org_id, callRow.campaign_id);
}
