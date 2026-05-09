import { and, count, desc, eq, isNotNull, sql } from 'drizzle-orm';

import { withOrgContext } from '@/lib/db/context';
import { calls, campaignStats, contacts } from '@/lib/db/schema';

export type CampaignLiveCallRow = {
  id: string;
  contactName: string;
  phoneE164: string | null;
  status:
    | 'pending'
    | 'dialing'
    | 'in_progress'
    | 'completed'
    | 'failed'
    | 'no_answer'
    | 'voicemail'
    | 'busy';
  outcome:
    | 'interested'
    | 'not_interested'
    | 'appointment_booked'
    | 'wrong_number'
    | 'callback_requested'
    | 'voicemail_left'
    | 'voicemail_no_message'
    | 'do_not_call'
    | null;
  startedAtIso: string | null;
  endedAtIso: string | null;
  costCents: number | null;
  billableSeconds: number | null;
};

export type CampaignLiveSnapshot = {
  totalCalls: number;
  completedCalls: number;
  inProgressCalls: number;
  appointmentsBooked: number;
  costCents: number;
  recentCalls: CampaignLiveCallRow[];
};

const TERMINAL_STATUSES = ['completed', 'failed', 'no_answer', 'voicemail', 'busy'] as const;

/**
 * Loads the initial server-side snapshot for the campaign live view.
 *
 * Returns aggregated counts plus the most recent calls (active first, then by
 * started_at desc) so the page renders with real data before Realtime takes
 * over for incremental updates.
 */
export async function getCampaignLiveSnapshot(
  orgId: string,
  campaignId: string,
  recentLimit = 50,
): Promise<CampaignLiveSnapshot> {
  return withOrgContext(orgId, async (tx) => {
    const [statusRows, statsRow, recentRows] = await Promise.all([
      tx
        .select({ status: calls.status, cnt: count() })
        .from(calls)
        .where(
          and(
            eq(calls.org_id, orgId),
            isNotNull(calls.campaign_id),
            eq(calls.campaign_id, campaignId),
          ),
        )
        .groupBy(calls.status),
      tx
        .select({
          appointmentsBooked: campaignStats.outcome_appointment_booked,
          costCents: campaignStats.total_cost_cents,
        })
        .from(campaignStats)
        .where(
          and(
            eq(campaignStats.org_id, orgId),
            eq(campaignStats.campaign_id, campaignId),
          ),
        )
        .limit(1),
      tx
        .select({
          id: calls.id,
          status: calls.status,
          outcome: calls.outcome,
          startedAt: calls.started_at,
          endedAt: calls.ended_at,
          costCents: calls.cost_cents,
          billableSeconds: calls.billable_seconds,
          firstName: contacts.first_name,
          lastName: contacts.last_name,
          phoneE164: contacts.phone_e164,
        })
        .from(calls)
        .leftJoin(contacts, eq(calls.contact_id, contacts.id))
        .where(
          and(
            eq(calls.org_id, orgId),
            isNotNull(calls.campaign_id),
            eq(calls.campaign_id, campaignId),
          ),
        )
        // Active calls first, then most recently started.
        .orderBy(
          sql`case when ${calls.status} in ('dialing','in_progress') then 0 else 1 end`,
          desc(calls.started_at),
          desc(calls.created_at),
        )
        .limit(recentLimit),
    ]);

    const statusCounts: Record<string, number> = {};
    for (const r of statusRows) statusCounts[r.status] = r.cnt;

    const totalCalls = Object.values(statusCounts).reduce((a, b) => a + b, 0);
    const completedCalls = TERMINAL_STATUSES.reduce(
      (sum, s) => sum + (statusCounts[s] ?? 0),
      0,
    );
    const inProgressCalls =
      (statusCounts['dialing'] ?? 0) + (statusCounts['in_progress'] ?? 0);

    const recentCalls: CampaignLiveCallRow[] = recentRows.map((r) => {
      const fullName = [r.firstName, r.lastName].filter(Boolean).join(' ').trim();
      return {
        id: r.id,
        contactName: fullName || (r.phoneE164 ?? ''),
        phoneE164: r.phoneE164,
        status: r.status,
        outcome: r.outcome,
        startedAtIso: r.startedAt?.toISOString() ?? null,
        endedAtIso: r.endedAt?.toISOString() ?? null,
        costCents: r.costCents,
        billableSeconds: r.billableSeconds,
      };
    });

    return {
      totalCalls,
      completedCalls,
      inProgressCalls,
      appointmentsBooked: statsRow[0]?.appointmentsBooked ?? 0,
      costCents: statsRow[0]?.costCents ?? 0,
      recentCalls,
    };
  });
}
