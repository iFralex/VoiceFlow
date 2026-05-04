import { and, eq } from 'drizzle-orm';

import { recordAudit } from '@/lib/db/audit';
import { withOrgContext } from '@/lib/db/context';
import { contactLists, importStatusEnum } from '@/lib/db/schema';
import type { ContactList } from '@/lib/db/schema';

export type ImportStatus = (typeof importStatusEnum.enumValues)[number];

export async function createContactList(
  orgId: string,
  byUserId: string,
  input: {
    name: string;
    source: 'csv-upload' | 'zapier' | 'api';
    sourceFilePath?: string;
  },
): Promise<ContactList> {
  return withOrgContext(orgId, async (tx) => {
    const [list] = await tx
      .insert(contactLists)
      .values({
        org_id: orgId,
        name: input.name,
        source: input.source,
        source_file_path: input.sourceFilePath ?? null,
      })
      .returning();

    await recordAudit(tx, {
      orgId,
      actorUserId: byUserId,
      actorType: 'user',
      action: 'contact_list.created',
      subjectType: 'contact_list',
      subjectId: list!.id,
      metadata: { name: input.name, source: input.source },
    });

    return list!;
  });
}

export async function listContactLists(orgId: string): Promise<ContactList[]> {
  return withOrgContext(orgId, async (tx) => {
    return tx.select().from(contactLists).where(eq(contactLists.org_id, orgId));
  });
}

export async function getContactList(orgId: string, listId: string): Promise<ContactList | null> {
  return withOrgContext(orgId, async (tx) => {
    const [list] = await tx
      .select()
      .from(contactLists)
      .where(and(eq(contactLists.id, listId), eq(contactLists.org_id, orgId)));
    return list ?? null;
  });
}

export async function deleteContactList(
  orgId: string,
  byUserId: string,
  listId: string,
): Promise<void> {
  await withOrgContext(orgId, async (tx) => {
    const [deleted] = await tx
      .delete(contactLists)
      .where(and(eq(contactLists.id, listId), eq(contactLists.org_id, orgId)))
      .returning({ id: contactLists.id });

    if (!deleted) {
      throw new Error('contact_list_not_found');
    }

    await recordAudit(tx, {
      orgId,
      actorUserId: byUserId,
      actorType: 'user',
      action: 'contact_list.deleted',
      subjectType: 'contact_list',
      subjectId: listId,
    });
  });
}

export async function updateListCounts(
  orgId: string,
  listId: string,
  total: number,
  valid: number,
): Promise<void> {
  await withOrgContext(orgId, async (tx) => {
    await tx
      .update(contactLists)
      .set({ total_count: total, valid_count: valid })
      .where(and(eq(contactLists.id, listId), eq(contactLists.org_id, orgId)));
  });
}

export async function updateListImportStatus(
  orgId: string,
  listId: string,
  status: ImportStatus,
): Promise<void> {
  await withOrgContext(orgId, async (tx) => {
    await tx
      .update(contactLists)
      .set({ import_status: status })
      .where(and(eq(contactLists.id, listId), eq(contactLists.org_id, orgId)));
  });
}
