import { getAuthContext } from '@/lib/auth/context';
import { listContactLists } from '@/lib/services/contact_lists';
import { listContacts } from '@/lib/services/contacts';

import type { SerializedContactList } from './_components/contacts-page-client';
import { ContactsPageClient } from './_components/contacts-page-client';
import type { SerializedContact } from './lists/[id]/_components/list-detail-client';

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

type TabKey = 'lists' | 'all' | 'optout';

const VALID_TABS = new Set<TabKey>(['lists', 'all', 'optout']);

function isValidTab(v: string): v is TabKey {
  return VALID_TABS.has(v as TabKey);
}

function serializeList(
  list: Awaited<ReturnType<typeof listContactLists>>[number],
): SerializedContactList {
  return {
    id: list.id,
    name: list.name,
    source: list.source,
    total_count: list.total_count,
    valid_count: list.valid_count,
    import_status: list.import_status,
    created_at: list.created_at.toISOString(),
  };
}

function serializeContact(
  c: Awaited<ReturnType<typeof listContacts>>['items'][number],
): SerializedContact {
  return {
    id: c.id,
    phone_e164: c.phone_e164,
    first_name: c.first_name,
    last_name: c.last_name,
    email: c.email,
    opt_out: c.opt_out,
    rpo_status: c.rpo_status,
    metadata: c.metadata as Record<string, unknown> | null,
  };
}

export default async function ContactsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const tabParam = typeof sp.tab === 'string' ? sp.tab : 'lists';
  const activeTab: TabKey = isValidTab(tabParam) ? tabParam : 'lists';

  const { orgId } = await getAuthContext();

  const rawLists = await listContactLists(orgId);
  const lists = rawLists.map(serializeList);

  let allContacts: SerializedContact[] = [];
  let optOutContacts: SerializedContact[] = [];

  if (activeTab === 'all') {
    const result = await listContacts(orgId, {}, { limit: 500 });
    allContacts = result.items.map(serializeContact);
  } else if (activeTab === 'optout') {
    const result = await listContacts(orgId, { optOut: true }, { limit: 500 });
    optOutContacts = result.items.map(serializeContact);
  }

  return (
    <ContactsPageClient
      activeTab={activeTab}
      lists={lists}
      allContacts={allContacts}
      optOutContacts={optOutContacts}
      orgId={orgId}
    />
  );
}
