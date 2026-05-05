import { getAuthContext } from '@/lib/auth/context';
import type { CampaignStatus } from '@/lib/services/campaigns';
import { listCampaigns } from '@/lib/services/campaigns';
import { listContactLists } from '@/lib/services/contact_lists';
import { listScripts } from '@/lib/services/scripts';

import type { SerializedCampaign } from './_components/campaigns-page-client';
import { CampaignsPageClient } from './_components/campaigns-page-client';

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

type TabKey = 'all' | 'draft' | 'running' | 'completed' | 'cancelled';

const VALID_TABS = new Set<TabKey>(['all', 'draft', 'running', 'completed', 'cancelled']);

function isValidTab(v: string): v is TabKey {
  return VALID_TABS.has(v as TabKey);
}

const TAB_STATUS_MAP: Record<TabKey, CampaignStatus[] | undefined> = {
  all: undefined,
  draft: ['draft', 'scheduled'],
  running: ['running', 'paused'],
  completed: ['completed'],
  cancelled: ['cancelled'],
};

export default async function CampaignsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const tabParam = typeof sp.tab === 'string' ? sp.tab : 'all';
  const activeTab: TabKey = isValidTab(tabParam) ? tabParam : 'all';

  const { orgId } = await getAuthContext();

  const statusFilter = TAB_STATUS_MAP[activeTab];
  const [{ items: campaignRows }, allScripts, allContactLists] = await Promise.all([
    listCampaigns(orgId, statusFilter ? { status: statusFilter } : {}, { limit: 100 }),
    listScripts(orgId),
    listContactLists(orgId),
  ]);

  const scriptMap = new Map(allScripts.map((s) => [s.id, s.name]));
  const contactListMap = new Map(allContactLists.map((l) => [l.id, l.name]));

  const campaigns: SerializedCampaign[] = campaignRows.map((c) => ({
    id: c.id,
    name: c.name,
    status: c.status,
    scriptId: c.script_id,
    scriptName: scriptMap.get(c.script_id) ?? c.script_id,
    contactListId: c.contact_list_id,
    contactListName: contactListMap.get(c.contact_list_id) ?? c.contact_list_id,
    totalCalls: c.totalCalls,
    estimatedMaxCents: c.estimated_max_cents,
    actualCents: c.actual_cents,
    createdAt: c.created_at.toISOString(),
  }));

  return <CampaignsPageClient activeTab={activeTab} campaigns={campaigns} />;
}
