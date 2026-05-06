import { withOrgContext } from '@/lib/db/context';
import { calls } from '@/lib/db/schema';
import { sendInngestEvents } from '@/lib/inngest/client';
import { markCampaignCompletedEmpty } from '@/lib/services/campaigns';
import { findEligibleContactsForCampaign } from '@/lib/services/eligibility';
import type { EligibleContact } from '@/lib/services/eligibility';

import { CAMPAIGN_DISPATCH_CALL_EVENT } from './events';
import type { CampaignLaunchedData } from './events';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface PendingCallRow extends EligibleContact {
  /** ID of the pre-created `calls` row in `pending` state */
  callId: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Inserts one `calls` row per eligible contact in `pending` state.
 * Returns the same contacts with the precreated `callId` attached.
 *
 * Creating these rows at planning time (before the actual call is placed)
 * allows the dashboard to show campaign progress immediately after launch.
 */
export async function createPendingCallRows(
  orgId: string,
  campaignId: string,
  eligible: EligibleContact[],
): Promise<PendingCallRow[]> {
  return withOrgContext(orgId, async (tx) => {
    const inserted = await tx
      .insert(calls)
      .values(
        eligible.map((c) => ({
          org_id: orgId,
          campaign_id: campaignId,
          contact_id: c.contactId,
          provider: 'vapi' as const,
          status: 'pending' as const,
          attempt_number: c.attemptNumber,
        })),
      )
      .returning({ id: calls.id, contact_id: calls.contact_id });

    // Build a contactId → callId map for O(1) lookups
    const callIdByContactId = new Map<string, string>();
    for (const row of inserted) {
      callIdByContactId.set(row.contact_id, row.id);
    }

    return eligible.map((c) => ({
      ...c,
      callId: callIdByContactId.get(c.contactId) ?? '',
    }));
  });
}

// ─── Handler ───────────────────────────────────────────────────────────────────

/**
 * Handles the `campaign/launched` event.
 *
 * 1. Finds all contacts eligible for dispatch.
 * 2. If zero eligible contacts exist, marks the campaign completed (empty).
 * 3. Otherwise, pre-creates one `calls` row per contact in `pending` state
 *    so the dashboard can surface progress immediately.
 * 4. Batch-sends one `campaign/dispatch-call` event per contact.
 *
 * Events are sent with per-contact idempotency keys so that Inngest can
 * deduplicate safely on retry.
 */
export async function campaignLaunchedHandler(data: CampaignLaunchedData): Promise<void> {
  const { campaignId, orgId } = data;

  const eligible = await findEligibleContactsForCampaign(orgId, campaignId);

  if (eligible.length === 0) {
    await markCampaignCompletedEmpty(orgId, campaignId);
    return;
  }

  const pendingCalls = await createPendingCallRows(orgId, campaignId, eligible);

  await sendInngestEvents(
    pendingCalls.map((c) => ({
      name: CAMPAIGN_DISPATCH_CALL_EVENT,
      data: {
        campaignId,
        orgId,
        contactId: c.contactId,
        callId: c.callId,
        attempt: c.attemptNumber,
      },
      id: `dispatch-${campaignId}-${c.contactId}-${c.attemptNumber}`,
    })),
  );
}
