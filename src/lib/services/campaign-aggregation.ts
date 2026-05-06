import { eq, sql } from 'drizzle-orm';

import { withSystemContext } from '@/lib/db/context';
import { calls, campaignStats, campaigns } from '@/lib/db/schema';

/**
 * Recomputes and upserts `campaign_stats` for a single campaign.
 *
 * Uses a single aggregate query for efficiency, then upserts the result.
 * Idempotent: re-running yields the same row.
 */
export async function aggregateOneCampaign(
  campaignId: string,
  orgId: string,
): Promise<void> {
  const now = new Date();

  const [stats] = await withSystemContext(async (tx) =>
    tx
      .select({
        total_calls: sql<number>`count(*)::int`,
        pending_calls: sql<number>`count(case when ${calls.status} = 'pending' then 1 end)::int`,
        dialing_calls: sql<number>`count(case when ${calls.status} = 'dialing' then 1 end)::int`,
        in_progress_calls: sql<number>`count(case when ${calls.status} = 'in_progress' then 1 end)::int`,
        completed_calls: sql<number>`count(case when ${calls.status} = 'completed' then 1 end)::int`,
        failed_calls: sql<number>`count(case when ${calls.status} in ('failed','no_answer','busy','voicemail') then 1 end)::int`,
        outcome_appointment_booked: sql<number>`count(case when ${calls.outcome} = 'appointment_booked' then 1 end)::int`,
        outcome_interested: sql<number>`count(case when ${calls.outcome} = 'interested' then 1 end)::int`,
        outcome_not_interested: sql<number>`count(case when ${calls.outcome} = 'not_interested' then 1 end)::int`,
        outcome_wrong_number: sql<number>`count(case when ${calls.outcome} = 'wrong_number' then 1 end)::int`,
        outcome_callback: sql<number>`count(case when ${calls.outcome} = 'callback_requested' then 1 end)::int`,
        outcome_voicemail: sql<number>`count(case when ${calls.outcome} in ('voicemail_left','voicemail_no_message') then 1 end)::int`,
        outcome_do_not_call: sql<number>`count(case when ${calls.outcome} = 'do_not_call' then 1 end)::int`,
        total_billed_seconds: sql<number>`coalesce(sum(${calls.billable_seconds}),0)::int`,
        total_cost_cents: sql<number>`coalesce(sum(${calls.cost_cents}),0)::int`,
      })
      .from(calls)
      .where(eq(calls.campaign_id, campaignId)),
  );

  if (!stats) return;

  const values = {
    campaign_id: campaignId,
    org_id: orgId,
    total_calls: stats.total_calls,
    pending_calls: stats.pending_calls,
    dialing_calls: stats.dialing_calls,
    in_progress_calls: stats.in_progress_calls,
    completed_calls: stats.completed_calls,
    failed_calls: stats.failed_calls,
    outcome_appointment_booked: stats.outcome_appointment_booked,
    outcome_interested: stats.outcome_interested,
    outcome_not_interested: stats.outcome_not_interested,
    outcome_wrong_number: stats.outcome_wrong_number,
    outcome_callback: stats.outcome_callback,
    outcome_voicemail: stats.outcome_voicemail,
    outcome_do_not_call: stats.outcome_do_not_call,
    total_billed_seconds: stats.total_billed_seconds,
    total_cost_cents: stats.total_cost_cents,
    last_aggregated_at: now,
  };

  await withSystemContext(async (tx) =>
    tx
      .insert(campaignStats)
      .values(values)
      .onConflictDoUpdate({
        target: campaignStats.campaign_id,
        set: {
          total_calls: values.total_calls,
          pending_calls: values.pending_calls,
          dialing_calls: values.dialing_calls,
          in_progress_calls: values.in_progress_calls,
          completed_calls: values.completed_calls,
          failed_calls: values.failed_calls,
          outcome_appointment_booked: values.outcome_appointment_booked,
          outcome_interested: values.outcome_interested,
          outcome_not_interested: values.outcome_not_interested,
          outcome_wrong_number: values.outcome_wrong_number,
          outcome_callback: values.outcome_callback,
          outcome_voicemail: values.outcome_voicemail,
          outcome_do_not_call: values.outcome_do_not_call,
          total_billed_seconds: values.total_billed_seconds,
          total_cost_cents: values.total_cost_cents,
          last_aggregated_at: values.last_aggregated_at,
        },
      }),
  );
}

/**
 * Aggregates stats for all currently-running and paused campaigns.
 * Used by the periodic cron sweep. Terminal-state campaigns are aggregated
 * once at transition time (see `markCampaignCompleted`) rather than every
 * tick, so the cron doesn't need to scan them.
 */
export async function aggregateActiveCampaigns(): Promise<{
  processed: number;
  errors: number;
}> {
  const activeCampaigns = await withSystemContext(async (tx) =>
    tx
      .select({ id: campaigns.id, org_id: campaigns.org_id })
      .from(campaigns)
      .where(sql`${campaigns.status} IN ('running', 'paused')`),
  );

  let processed = 0;
  let errors = 0;

  for (const campaign of activeCampaigns) {
    try {
      await aggregateOneCampaign(campaign.id, campaign.org_id);
      processed++;
    } catch (err) {
      console.error('[aggregate-campaigns] Error aggregating campaign', {
        campaignId: campaign.id,
        error: err instanceof Error ? err.message : String(err),
      });
      errors++;
    }
  }

  return { processed, errors };
}
