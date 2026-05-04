import { notFound } from 'next/navigation';

import { getAuthContext } from '@/lib/auth/context';
import { getContactList } from '@/lib/services/contact_lists';
import { listContacts } from '@/lib/services/contacts';
import type { RpoStatus } from '@/lib/services/contacts';

import type { SerializedContact, SerializedList } from './_components/list-detail-client';
import { ListDetailClient } from './_components/list-detail-client';

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function serializeList(list: Awaited<ReturnType<typeof getContactList>>): SerializedList {
  if (!list) throw new Error('list is null');
  return {
    id: list.id,
    name: list.name,
    source: list.source,
    source_file_path: list.source_file_path,
    total_count: list.total_count,
    valid_count: list.valid_count,
    import_status: list.import_status,
    created_at: list.created_at.toISOString(),
  };
}

function serializeContact(c: Awaited<ReturnType<typeof listContacts>>['items'][number]): SerializedContact {
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

export default async function ListDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;

  const search = typeof sp.search === 'string' ? sp.search : undefined;
  const optOut =
    sp.optOut === 'true' ? true : sp.optOut === 'false' ? false : undefined;
  const RPO_STATUSES: RpoStatus[] = ['clear', 'blocked', 'unchecked'];
  const rpoStatus =
    typeof sp.rpoStatus === 'string' && RPO_STATUSES.includes(sp.rpoStatus as RpoStatus)
      ? (sp.rpoStatus as RpoStatus)
      : undefined;

  const { orgId } = await getAuthContext();
  const list = await getContactList(orgId, id);
  if (!list) notFound();

  let contacts: SerializedContact[] = [];
  if (list.import_status === 'completed') {
    const result = await listContacts(
      orgId,
      { listId: id, ...(search !== undefined ? { search } : {}), ...(optOut !== undefined ? { optOut } : {}), ...(rpoStatus !== undefined ? { rpoStatus } : {}) },
      { limit: 500 },
    );
    contacts = result.items.map(serializeContact);
  }

  return (
    <ListDetailClient
      list={serializeList(list)}
      contacts={contacts}
      listId={id}
      orgId={orgId}
    />
  );
}
