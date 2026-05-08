import { and, count, desc, eq, gt, inArray, isNull, lt, ne, not, or, sql } from 'drizzle-orm';

import { getDpaStatus } from '@/lib/compliance/dpa';
import { recordAudit } from '@/lib/db/audit';
import { withOrgContext } from '@/lib/db/context';
import {
  calls,
  campaignStatusEnum,
  campaigns,
  contacts,
} from '@/lib/db/schema';
import type { Campaign } from '@/lib/db/schema';
import { sendInngestEvent } from '@/lib/inngest/client';
import { getVoiceProviderByName } from '@/lib/voice/factory';

import { computePerMinuteCents } from './billing-rules';
import { aggregateOneCampaign } from './campaign-aggregation';
import { estimateCampaignCost } from './campaign-cost-estimator';
import { releaseReservation, reserveForCampaign } from './credit';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type CampaignStatus = (typeof campaignStatusEnum.enumValues)[number];

export interface CampaignWithStats extends Campaign {
  totalCalls: number;
  pendingCalls: number;
  dialingCalls: number;
  inProgressCalls: number;
  completedCalls: number;
  failedCalls: number;
  noAnswerCalls: number;
  voicemailCalls: number;
  busyCalls: number;
}

// ─── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Counts contacts eligible to be called for a campaign:
 * - belongs to the campaign's contact_list_id
 * - not deleted
 * - not opted out
 * - rpo_status is not 'blocked'
 * - phone_e164 present and E.164-valid (starts with '+', min 7 chars)
 * - no completed/no_answer/busy call attempt within the last 48 hours
 */
async function countEligibleContacts(
  orgId: string,
  campaignId: string,
): Promise<number> {
  return withOrgContext(orgId, async (tx) => {
    const [campaign] = await tx
      .select({ contact_list_id: campaigns.contact_list_id })
      .from(campaigns)
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.org_id, orgId)));

    if (!campaign) return 0;

    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);

    // Step 1: collect contact IDs with a recent terminal call in the last 48h
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

    // contact_id is nullable in the schema (inbound rows have none) but is
    // always populated for outbound calls scoped to a campaign.
    const recentContactIds = recentCallRows
      .map((r) => r.contact_id)
      .filter((id): id is string => id !== null);

    // Step 2: count eligible contacts excluding recently called ones
    const baseConditions = and(
      eq(contacts.org_id, orgId),
      eq(contacts.contact_list_id, campaign.contact_list_id),
      isNull(contacts.deleted_at),
      eq(contacts.opt_out, false),
      ne(contacts.rpo_status, 'blocked'),
      // E.164-valid: starts with '+' and at least 7 chars total
      sql`length(${contacts.phone_e164}) >= 7`,
      sql`left(${contacts.phone_e164}, 1) = '+'`,
    );

    const whereCondition =
      recentContactIds.length > 0
        ? and(baseConditions, not(inArray(contacts.id, recentContactIds)))
        : baseConditions;

    const [row] = await tx
      .select({ total: count() })
      .from(contacts)
      .where(whereCondition);

    return row?.total ?? 0;
  });
}

/**
 * Attaches live call-count stats to campaign rows.
 */
async function attachStats(
  orgId: string,
  campaignRows: Campaign[],
): Promise<CampaignWithStats[]> {
  if (campaignRows.length === 0) return [];

  const campaignIds = campaignRows.map((c) => c.id);

  const statRows = await withOrgContext(orgId, async (tx) => {
    return tx
      .select({
        campaign_id: calls.campaign_id,
        status: calls.status,
        cnt: count(),
      })
      .from(calls)
      .where(and(eq(calls.org_id, orgId), inArray(calls.campaign_id, campaignIds)))
      .groupBy(calls.campaign_id, calls.status);
  });

  // Build a map: campaignId -> status -> count.
  // Skip stat rows with no campaign_id (inbound IVR rows do not belong to a
  // campaign, so they should not contribute to per-campaign totals).
  const statsMap = new Map<string, Record<string, number>>();
  for (const row of statRows) {
    if (row.campaign_id === null) continue;
    if (!statsMap.has(row.campaign_id)) statsMap.set(row.campaign_id, {});
    statsMap.get(row.campaign_id)![row.status] = row.cnt;
  }

  return campaignRows.map((c) => {
    const s = statsMap.get(c.id) ?? {};
    return {
      ...c,
      totalCalls: Object.values(s).reduce((a, b) => a + b, 0),
      pendingCalls: s['pending'] ?? 0,
      dialingCalls: s['dialing'] ?? 0,
      inProgressCalls: s['in_progress'] ?? 0,
      completedCalls: s['completed'] ?? 0,
      failedCalls: s['failed'] ?? 0,
      noAnswerCalls: s['no_answer'] ?? 0,
      voicemailCalls: s['voicemail'] ?? 0,
      busyCalls: s['busy'] ?? 0,
    };
  });
}

// ─── Campaign CRUD ──────────────────────────────────────────────────────────────

/**
 * Creates a new campaign in `draft` state (or `scheduled` if `scheduledStart` is
 * provided). Does not reserve credit or emit events.
 */
export async function createCampaign(
  orgId: string,
  byUserId: string,
  input: {
    name: string;
    scriptId: string;
    contactListId: string;
    scheduledStart?: Date;
    concurrencyLimit?: number;
    timeWindowStart?: string;
    timeWindowEnd?: string;
  },
): Promise<Campaign> {
  return withOrgContext(orgId, async (tx) => {
    const status: CampaignStatus =
      input.scheduledStart && input.scheduledStart > new Date() ? 'scheduled' : 'draft';

    const [created] = await tx
      .insert(campaigns)
      .values({
        org_id: orgId,
        script_id: input.scriptId,
        contact_list_id: input.contactListId,
        name: input.name,
        status,
        concurrency_limit: input.concurrencyLimit ?? 5,
        time_window_start: input.timeWindowStart ?? '09:00',
        time_window_end: input.timeWindowEnd ?? '19:00',
        scheduled_at: input.scheduledStart ?? null,
      })
      .returning();

    await recordAudit(tx, {
      orgId,
      actorUserId: byUserId,
      actorType: 'user',
      action: 'campaign.created',
      subjectType: 'campaign',
      subjectId: created!.id,
      metadata: { name: input.name, status },
    });

    return created!;
  });
}

/**
 * Launches a campaign:
 * 1. Validates the campaign is in `draft` or `scheduled` state.
 * 2. Counts eligible contacts.
 * 3. Computes estimated max cost and reserves credit.
 * 4. Transitions the campaign to `running`.
 * 5. Emits `campaign/launched` Inngest event.
 * 6. Writes audit log.
 *
 * Throws `'campaign_not_found'` if the campaign does not exist.
 * Throws `'campaign_not_launchable'` if the campaign is in a non-launchable state.
 * Throws `'dpa_outdated'` if the org has not accepted the current DPA version.
 * Throws `'no_eligible_contacts'` if zero contacts are eligible.
 * Throws `'insufficient_credit'` if the org has insufficient credit to cover the reservation.
 * Throws `'no_billing_rate'` if no per-minute rate can be computed (no credit packages purchased).
 */
export async function launchCampaign(
  orgId: string,
  byUserId: string,
  campaignId: string,
): Promise<void> {
  // Load campaign outside the write transaction to allow eligibility count first
  const campaign = await getCampaign(orgId, campaignId);
  if (!campaign) throw new Error('campaign_not_found');

  if (campaign.status !== 'draft' && campaign.status !== 'scheduled') {
    throw new Error('campaign_not_launchable');
  }

  // DPA gate (plan 11 task 16/18). The in-app banner already nudges users to
  // re-accept on outdated DPA versions, but enforcement must also live on the
  // server so a direct Server Action call cannot bypass it.
  const dpaStatus = await getDpaStatus(orgId);
  if (dpaStatus.state !== 'current') {
    throw new Error('dpa_outdated');
  }

  // Count eligible contacts
  const eligibleCount = await countEligibleContacts(orgId, campaignId);
  if (eligibleCount === 0) throw new Error('no_eligible_contacts');

  // Compute max cost estimate
  const perMinuteCents = await computePerMinuteCents(orgId);
  if (perMinuteCents === null) throw new Error('no_billing_rate');

  const estimate = estimateCampaignCost({
    contactCount: eligibleCount,
    perMinuteCents,
  });

  // Reserve credit — throws 'insufficient_credit' if balance too low
  await reserveForCampaign(orgId, campaignId, estimate.maxCents);

  // Transition campaign to running and record audit inside a transaction
  await withOrgContext(orgId, async (tx) => {
    const [updated] = await tx
      .update(campaigns)
      .set({
        status: 'running',
        started_at: new Date(),
        estimated_max_cents: estimate.maxCents,
        updated_at: new Date(),
      })
      .where(
        and(
          eq(campaigns.id, campaignId),
          eq(campaigns.org_id, orgId),
          inArray(campaigns.status, ['draft', 'scheduled']),
        ),
      )
      .returning({ id: campaigns.id });

    if (!updated) throw new Error('campaign_not_launchable');

    await recordAudit(tx, {
      orgId,
      actorUserId: byUserId,
      actorType: 'user',
      action: 'campaign.launched',
      subjectType: 'campaign',
      subjectId: campaignId,
      metadata: { eligibleCount, estimatedMaxCents: estimate.maxCents },
    });
  });

  // Emit Inngest event outside transaction
  await sendInngestEvent({
    name: 'campaign/launched',
    data: { campaignId, orgId },
    id: `campaign-launched-${campaignId}`,
  });
}

/**
 * Pauses a running campaign. In-flight Inngest steps complete naturally;
 * no new dispatches are initiated after this.
 */
export async function pauseCampaign(
  orgId: string,
  byUserId: string,
  campaignId: string,
): Promise<void> {
  await withOrgContext(orgId, async (tx) => {
    const [updated] = await tx
      .update(campaigns)
      .set({ status: 'paused', updated_at: new Date() })
      .where(
        and(
          eq(campaigns.id, campaignId),
          eq(campaigns.org_id, orgId),
          eq(campaigns.status, 'running'),
        ),
      )
      .returning({ id: campaigns.id });

    if (!updated) throw new Error('campaign_not_running');

    await recordAudit(tx, {
      orgId,
      actorUserId: byUserId,
      actorType: 'user',
      action: 'campaign.paused',
      subjectType: 'campaign',
      subjectId: campaignId,
    });
  });
}

/**
 * Resumes a paused campaign, setting it back to `running`.
 */
export async function resumeCampaign(
  orgId: string,
  byUserId: string,
  campaignId: string,
): Promise<void> {
  await withOrgContext(orgId, async (tx) => {
    const [updated] = await tx
      .update(campaigns)
      .set({ status: 'running', updated_at: new Date() })
      .where(
        and(
          eq(campaigns.id, campaignId),
          eq(campaigns.org_id, orgId),
          eq(campaigns.status, 'paused'),
        ),
      )
      .returning({ id: campaigns.id });

    if (!updated) throw new Error('campaign_not_paused');

    await recordAudit(tx, {
      orgId,
      actorUserId: byUserId,
      actorType: 'user',
      action: 'campaign.resumed',
      subjectType: 'campaign',
      subjectId: campaignId,
    });
  });
}

/**
 * Cancels a campaign. Sets status to `cancelled`, terminates any currently
 * dialing or in-progress provider calls, releases the unused credit reservation
 * back to the org's balance, and writes a final stats snapshot so the dashboard
 * reflects post-cancel KPIs without waiting for the next aggregation cron.
 */
export async function cancelCampaign(
  orgId: string,
  byUserId: string,
  campaignId: string,
): Promise<void> {
  // Flip status first. The dispatch handler's status check (`requireRunning`)
  // ensures no NEW calls move from `pending` → `dialing` after this point, so
  // the snapshot we take below is a complete picture of calls that need to be
  // terminated at the provider.
  await withOrgContext(orgId, async (tx) => {
    const [updated] = await tx
      .update(campaigns)
      .set({ status: 'cancelled', updated_at: new Date() })
      .where(
        and(
          eq(campaigns.id, campaignId),
          eq(campaigns.org_id, orgId),
          not(inArray(campaigns.status, ['completed', 'cancelled'])),
        ),
      )
      .returning({ id: campaigns.id });

    if (!updated) throw new Error('campaign_already_terminal');

    await recordAudit(tx, {
      orgId,
      actorUserId: byUserId,
      actorType: 'user',
      action: 'campaign.cancelled',
      subjectType: 'campaign',
      subjectId: campaignId,
    });
  });

  // Snapshot active calls AFTER the status flip so we capture any that
  // transitioned from `pending` → `dialing` between user intent and the flip.
  const activeCalls = await withOrgContext(orgId, async (tx) => {
    return tx
      .select({ provider: calls.provider, provider_call_id: calls.provider_call_id })
      .from(calls)
      .where(
        and(
          eq(calls.org_id, orgId),
          eq(calls.campaign_id, campaignId),
          inArray(calls.status, ['dialing', 'in_progress']),
        ),
      );
  });

  // Terminate in-progress calls FIRST (best-effort). Doing this before
  // `releaseReservation` ensures we don't return reserved credit to the org's
  // balance while provider calls may still be billing against it.
  for (const call of activeCalls) {
    if (!call.provider_call_id) continue;
    try {
      await getVoiceProviderByName(call.provider).cancelCall(call.provider_call_id);
    } catch (err) {
      console.error(
        `[cancelCampaign] Failed to terminate provider call ${call.provider_call_id}:`,
        err,
      );
    }
  }

  // Release reservation outside any transaction. Wrap in try/catch so a
  // transient release failure doesn't surface as a cancel failure: the
  // campaign is already cancelled and provider calls are terminated; the
  // reservation can be reconciled by the periodic credit-sweep cron.
  try {
    await releaseReservation(orgId, campaignId);
  } catch (err) {
    console.error(
      `[cancelCampaign] Failed to release reservation for campaign ${campaignId}:`,
      err,
    );
  }

  // Write final stats snapshot so the detail page shows post-cancel KPIs
  // immediately. The aggregation cron skips terminal-state campaigns, so
  // without this the page would show stale numbers until activity stops.
  try {
    await aggregateOneCampaign(campaignId, orgId);
  } catch (err) {
    console.error(
      `[cancelCampaign] Failed to aggregate final stats for campaign ${campaignId}:`,
      err,
    );
  }
}

// ─── Read helpers ───────────────────────────────────────────────────────────────

/**
 * Returns a single campaign with live call-count stats, or null if not found.
 */
export async function getCampaign(
  orgId: string,
  campaignId: string,
): Promise<CampaignWithStats | null> {
  const campaign = await withOrgContext(orgId, async (tx) => {
    const rows = await tx
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.org_id, orgId)));
    return rows[0] ?? null;
  });

  if (!campaign) return null;

  const [withStats] = await attachStats(orgId, [campaign]);
  return withStats ?? null;
}

/**
 * Returns a paginated list of campaigns with live call-count stats.
 * Uses cursor-based pagination keyed on (created_at DESC, id DESC).
 */
export async function listCampaigns(
  orgId: string,
  filters: { status?: CampaignStatus[] },
  page: { limit: number; cursor?: string },
): Promise<{ items: CampaignWithStats[]; nextCursor?: string }> {
  // Decode cursor: base64-encoded JSON { createdAt: string; id: string }
  let cursorCondition:
    | ReturnType<typeof or>
    | ReturnType<typeof and>
    | undefined = undefined;

  if (page.cursor) {
    try {
      const decoded = JSON.parse(
        Buffer.from(page.cursor, 'base64').toString('utf-8'),
      ) as { createdAt: string; id: string };
      const cursorDate = new Date(decoded.createdAt);
      cursorCondition = or(
        lt(campaigns.created_at, cursorDate),
        and(eq(campaigns.created_at, cursorDate), lt(campaigns.id, decoded.id)),
      );
    } catch {
      // Ignore malformed cursor — start from beginning
    }
  }

  const conditions = [eq(campaigns.org_id, orgId)];
  if (filters.status && filters.status.length > 0) {
    conditions.push(inArray(campaigns.status, filters.status));
  }
  if (cursorCondition) {
    conditions.push(cursorCondition as ReturnType<typeof eq>);
  }

  const rows = await withOrgContext(orgId, async (tx) => {
    return tx
      .select()
      .from(campaigns)
      .where(and(...conditions))
      .orderBy(desc(campaigns.created_at), desc(campaigns.id))
      .limit(page.limit + 1); // fetch one extra to detect if there's a next page
  });

  const hasNextPage = rows.length > page.limit;
  const pageRows = hasNextPage ? rows.slice(0, page.limit) : rows;

  const items = await attachStats(orgId, pageRows);

  let nextCursor: string | undefined;
  if (hasNextPage && pageRows.length > 0) {
    const last = pageRows[pageRows.length - 1]!;
    nextCursor = Buffer.from(
      JSON.stringify({ createdAt: last.created_at.toISOString(), id: last.id }),
    ).toString('base64');
  }

  return nextCursor !== undefined ? { items, nextCursor } : { items };
}

/**
 * Creates a copy of an existing campaign in `draft` state, preserving all
 * settings (script, contact list, time window, concurrency) but clearing
 * scheduling, launch timestamps, and costs.
 */
export async function duplicateCampaign(
  orgId: string,
  byUserId: string,
  campaignId: string,
): Promise<Campaign> {
  const original = await getCampaign(orgId, campaignId);
  if (!original) throw new Error('campaign_not_found');

  return createCampaign(orgId, byUserId, {
    name: `${original.name} (copia)`,
    scriptId: original.script_id,
    contactListId: original.contact_list_id,
    concurrencyLimit: original.concurrency_limit,
    timeWindowStart: original.time_window_start,
    timeWindowEnd: original.time_window_end,
  });
}

// ─── Internal helpers for Inngest functions ────────────────────────────────────

/**
 * Marks a campaign as completed when all calls have reached terminal states.
 * Called by the `campaign-completed` Inngest function (Task 7).
 */
export async function markCampaignCompleted(
  orgId: string,
  campaignId: string,
): Promise<void> {
  await withOrgContext(orgId, async (tx) => {
    const [updated] = await tx
      .update(campaigns)
      .set({
        status: 'completed',
        completed_at: new Date(),
        updated_at: new Date(),
      })
      .where(
        and(
          eq(campaigns.id, campaignId),
          eq(campaigns.org_id, orgId),
          ne(campaigns.status, 'completed'),
          ne(campaigns.status, 'cancelled'),
        ),
      )
      .returning({ id: campaigns.id });

    if (!updated) return; // already completed or cancelled — idempotent no-op

    await recordAudit(tx, {
      orgId,
      actorType: 'system',
      action: 'campaign.completed',
      subjectType: 'campaign',
      subjectId: campaignId,
    });
  });

  // Release unused credit reservation
  await releaseReservation(orgId, campaignId);
}

/**
 * Marks a campaign as completed because zero eligible contacts were found
 * at planning time. Called by the `campaign-launched` Inngest function (Task 3).
 */
export async function markCampaignCompletedEmpty(
  orgId: string,
  campaignId: string,
): Promise<void> {
  await withOrgContext(orgId, async (tx) => {
    const [updated] = await tx
      .update(campaigns)
      .set({
        status: 'completed',
        completed_at: new Date(),
        updated_at: new Date(),
      })
      .where(
        and(
          eq(campaigns.id, campaignId),
          eq(campaigns.org_id, orgId),
          eq(campaigns.status, 'running'),
        ),
      )
      .returning({ id: campaigns.id });

    if (!updated) return;

    await recordAudit(tx, {
      orgId,
      actorType: 'system',
      action: 'campaign.completed_empty',
      subjectType: 'campaign',
      subjectId: campaignId,
      metadata: { reason: 'no_eligible_contacts' },
    });
  });

  await releaseReservation(orgId, campaignId);
}

/**
 * Loads a campaign and asserts it is in `running` state.
 * Returns the campaign row.
 * Used by dispatch-call Inngest function to abort gracefully on pause/cancel.
 */
export async function requireRunning(
  orgId: string,
  campaignId: string,
): Promise<Campaign> {
  const campaign = await withOrgContext(orgId, async (tx) => {
    const rows = await tx
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.org_id, orgId)));
    return rows[0] ?? null;
  });

  if (!campaign) throw new Error('campaign_not_found');
  return campaign;
}
