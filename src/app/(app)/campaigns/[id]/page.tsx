import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';

import { dbForRequest } from '@/lib/db/client';
import { campaignStats } from '@/lib/db/schema';
import { getCampaign } from '@/lib/services/campaigns';
import { listContactLists } from '@/lib/services/contact_lists';
import { listScripts } from '@/lib/services/scripts';

import type { SerializedCampaignDetail } from './_components/campaign-detail-client';
import { CampaignDetailClient } from './_components/campaign-detail-client';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function CampaignDetailPage({ params }: Props) {
  const { id } = await params;

  const { orgId, withOrgContext } = await dbForRequest();

  const [campaign, allScripts, allContactLists] = await Promise.all([
    getCampaign(orgId, id),
    listScripts(orgId),
    listContactLists(orgId),
  ]);

  if (!campaign) notFound();

  // Fetch aggregated campaign stats (row may not exist before first cron run)
  const stats = await withOrgContext(async (tx) => {
    const rows = await tx
      .select()
      .from(campaignStats)
      .where(eq(campaignStats.campaign_id, id));
    return rows[0] ?? null;
  });

  const scriptMap = new Map(allScripts.map((s) => [s.id, s.name]));
  const contactListMap = new Map(allContactLists.map((l) => [l.id, l.name]));

  const serialized: SerializedCampaignDetail = {
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    scriptId: campaign.script_id,
    scriptName: scriptMap.get(campaign.script_id) ?? campaign.script_id,
    contactListId: campaign.contact_list_id,
    contactListName: contactListMap.get(campaign.contact_list_id) ?? campaign.contact_list_id,
    totalCalls: campaign.totalCalls,
    completedCalls: campaign.completedCalls,
    failedCalls: campaign.failedCalls,
    pendingCalls: campaign.pendingCalls,
    dialingCalls: campaign.dialingCalls,
    inProgressCalls: campaign.inProgressCalls,
    estimatedMaxCents: campaign.estimated_max_cents,
    actualCents: campaign.actual_cents,
    createdAt: campaign.created_at.toISOString(),
    updatedAt: campaign.updated_at.toISOString(),
    startedAt: campaign.started_at?.toISOString() ?? null,
    completedAt: campaign.completed_at?.toISOString() ?? null,
    scheduledAt: campaign.scheduled_at?.toISOString() ?? null,
    concurrencyLimit: campaign.concurrency_limit,
    timeWindowStart: campaign.time_window_start,
    timeWindowEnd: campaign.time_window_end,
    statsAppointmentBooked: stats?.outcome_appointment_booked ?? 0,
    statsInterested: stats?.outcome_interested ?? 0,
    statsTotalBilledSeconds: stats?.total_billed_seconds ?? 0,
    statsTotalCostCents: stats?.total_cost_cents ?? 0,
  };

  return <CampaignDetailClient campaign={serialized} />;
}
