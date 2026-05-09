import { notFound } from 'next/navigation';

import { getAuthContext } from '@/lib/auth/context';
import { getCampaignLiveSnapshot } from '@/lib/services/campaign-live';
import { getCampaign } from '@/lib/services/campaigns';

import { CampaignLiveClient } from './_components/campaign-live-client';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function CampaignLivePage({ params }: Props) {
  const { id } = await params;
  const { orgId } = await getAuthContext();

  const [campaign, snapshot] = await Promise.all([
    getCampaign(orgId, id),
    getCampaignLiveSnapshot(orgId, id),
  ]);

  if (!campaign) notFound();

  return (
    <CampaignLiveClient
      orgId={orgId}
      campaignId={campaign.id}
      campaignName={campaign.name}
      initialStatus={campaign.status}
      initialSnapshot={snapshot}
    />
  );
}
