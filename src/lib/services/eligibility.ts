import { and, asc, count, eq, gt, inArray, isNull, ne, not, sql } from 'drizzle-orm';

import { withOrgContext } from '@/lib/db/context';
import { calls, campaigns, contacts } from '@/lib/db/schema';

/**
 * Maximum attempts per contact per campaign (spec §10.2).
 * Mirrored in `src/lib/inngest/calls/completed.ts` for the retry path.
 */
const MAX_RETRY_ATTEMPTS = 3;

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface EligibleContact {
  contactId: string;
  phoneE164: string;
  /** 1-based attempt number for the upcoming call (1 = first attempt, 2 = retry, …) */
  attemptNumber: number;
}

// ─── Eligibility filter ────────────────────────────────────────────────────────

/**
 * Returns contacts eligible to be called for a campaign, ordered oldest-first.
 *
 * A contact is eligible when ALL of the following hold:
 * - belongs to the campaign's contact_list_id
 * - not soft-deleted (`deleted_at IS NULL`)
 * - not opted-out (`opt_out = false`)
 * - RPO status is not `blocked`
 * - phone is present and E.164-valid (starts with '+', ≥ 7 chars total)
 * - no terminal call (completed / no_answer / busy / voicemail) for this campaign
 *   in the last 48 hours
 * - existing attempt count for this campaign is below `MAX_RETRY_ATTEMPTS`
 *   (spec §10.2 — at most 3 calls per contact per campaign)
 *
 * The `attemptNumber` field is computed as the count of any existing call rows
 * for that contact in this campaign + 1 (so 1 on first launch, 2 on first retry, …).
 */
export async function findEligibleContactsForCampaign(
  orgId: string,
  campaignId: string,
): Promise<EligibleContact[]> {
  return withOrgContext(orgId, async (tx) => {
    // Step 1: Load campaign → contact_list_id
    const [campaign] = await tx
      .select({ contact_list_id: campaigns.contact_list_id })
      .from(campaigns)
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.org_id, orgId)));

    if (!campaign) return [];

    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);

    // Step 2: Collect contact IDs with a recent terminal call (48 h window)
    const recentCallRows = await tx
      .select({ contact_id: calls.contact_id })
      .from(calls)
      .where(
        and(
          eq(calls.org_id, orgId),
          eq(calls.campaign_id, campaignId),
          inArray(calls.status, ['completed', 'no_answer', 'busy', 'voicemail']),
          gt(calls.created_at, cutoff),
        ),
      );

    const recentContactIds = recentCallRows.map((r) => r.contact_id);

    // Step 3: Select eligible contacts, oldest first
    const baseConditions = and(
      eq(contacts.org_id, orgId),
      eq(contacts.contact_list_id, campaign.contact_list_id),
      isNull(contacts.deleted_at),
      eq(contacts.opt_out, false),
      ne(contacts.rpo_status, 'blocked'),
      sql`length(${contacts.phone_e164}) >= 7`,
      sql`left(${contacts.phone_e164}, 1) = '+'`,
    );

    const whereCondition =
      recentContactIds.length > 0
        ? and(baseConditions, not(inArray(contacts.id, recentContactIds)))
        : baseConditions;

    const eligibleRows = await tx
      .select({ id: contacts.id, phone_e164: contacts.phone_e164 })
      .from(contacts)
      .where(whereCondition)
      .orderBy(asc(contacts.created_at));

    if (eligibleRows.length === 0) return [];

    // Step 4: Count existing calls per eligible contact for this campaign
    //         to determine attempt number (1-based)
    const eligibleIds = eligibleRows.map((r) => r.id);

    const callCountRows = await tx
      .select({ contact_id: calls.contact_id, cnt: count() })
      .from(calls)
      .where(
        and(
          eq(calls.org_id, orgId),
          eq(calls.campaign_id, campaignId),
          inArray(calls.contact_id, eligibleIds),
        ),
      )
      .groupBy(calls.contact_id);

    const callCountMap = new Map<string, number>();
    for (const row of callCountRows) {
      callCountMap.set(row.contact_id, row.cnt);
    }

    // Filter out contacts that already used all their attempts (spec §10.2 cap).
    // The retry path enforces this in `scheduleRetryIfNeeded`, but a relaunch
    // (or any new launch over an old contact list) must enforce it too so a
    // 4th call cannot be enqueued at planning time.
    return eligibleRows
      .map((c) => ({
        contactId: c.id,
        phoneE164: c.phone_e164,
        attemptNumber: (callCountMap.get(c.id) ?? 0) + 1,
      }))
      .filter((c) => c.attemptNumber <= MAX_RETRY_ATTEMPTS);
  });
}
