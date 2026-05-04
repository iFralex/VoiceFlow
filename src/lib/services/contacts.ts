import { and, count, desc, eq, ilike, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import { recordAudit } from '@/lib/db/audit';
import { withOrgContext } from '@/lib/db/context';
import { contacts, optOutRegistry, optOutSourceEnum, rpoStatusEnum } from '@/lib/db/schema';
import type { Contact, NewContact } from '@/lib/db/schema';

export type OptOutSource = (typeof optOutSourceEnum.enumValues)[number];
export type RpoStatus = (typeof rpoStatusEnum.enumValues)[number];

const BATCH_SIZE = 500;

interface ListFilters {
  listId?: string;
  optOut?: boolean;
  rpoStatus?: RpoStatus;
  search?: string;
}

interface Page {
  limit: number;
  cursor?: string;
}

interface PageCursor {
  createdAt: string;
  id: string;
}

function encodeCursor(c: PageCursor): string {
  return Buffer.from(JSON.stringify(c)).toString('base64url');
}

function decodeCursor(cursor: string): PageCursor {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (
      typeof decoded !== 'object' ||
      decoded === null ||
      typeof (decoded as Record<string, unknown>).createdAt !== 'string' ||
      typeof (decoded as Record<string, unknown>).id !== 'string'
    ) {
      throw new Error('invalid_cursor');
    }
    return decoded as PageCursor;
  } catch {
    throw new Error('invalid_cursor');
  }
}

export async function upsertContact(
  orgId: string,
  input: NewContact,
): Promise<{ inserted: boolean; contact: Contact }> {
  return withOrgContext(orgId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(contacts)
      .where(
        and(
          eq(contacts.org_id, orgId),
          eq(contacts.phone_e164, input.phone_e164),
          isNull(contacts.deleted_at),
        ),
      );

    if (existing) {
      const [updated] = await tx
        .update(contacts)
        .set({
          first_name: input.first_name ?? existing.first_name,
          last_name: input.last_name ?? existing.last_name,
          email: input.email ?? existing.email,
          consent_basis: input.consent_basis,
          consent_evidence: input.consent_evidence ?? existing.consent_evidence,
          contact_type: input.contact_type ?? existing.contact_type,
          metadata: input.metadata ?? existing.metadata,
        })
        .where(eq(contacts.id, existing.id))
        .returning();

      return { inserted: false, contact: updated! };
    }

    const [newContact] = await tx
      .insert(contacts)
      .values({ ...input, org_id: orgId })
      .returning();

    return { inserted: true, contact: newContact! };
  });
}

export async function bulkUpsertContacts(
  orgId: string,
  contactsInput: NewContact[],
): Promise<{ insertedCount: number; updatedCount: number; skippedCount: number }> {
  let insertedCount = 0;
  let updatedCount = 0;

  for (let i = 0; i < contactsInput.length; i += BATCH_SIZE) {
    const batch = contactsInput.slice(i, i + BATCH_SIZE);

    await withOrgContext(orgId, async (tx) => {
      const phones = batch.map((c) => c.phone_e164);

      const existing = await tx
        .select({ phone: contacts.phone_e164 })
        .from(contacts)
        .where(
          and(
            eq(contacts.org_id, orgId),
            inArray(contacts.phone_e164, phones),
            isNull(contacts.deleted_at),
          ),
        );

      const existingPhones = new Set(existing.map((e) => e.phone));
      insertedCount += phones.filter((p) => !existingPhones.has(p)).length;
      updatedCount += existingPhones.size;

      await tx
        .insert(contacts)
        .values(batch.map((c) => ({ ...c, org_id: orgId })))
        .onConflictDoUpdate({
          target: [contacts.org_id, contacts.phone_e164],
          targetWhere: isNull(contacts.deleted_at),
          set: {
            first_name: sql`excluded.first_name`,
            last_name: sql`excluded.last_name`,
            email: sql`excluded.email`,
            consent_basis: sql`excluded.consent_basis`,
            consent_evidence: sql`excluded.consent_evidence`,
            contact_type: sql`excluded.contact_type`,
            metadata: sql`excluded.metadata`,
          },
        });
    });
  }

  return { insertedCount, updatedCount, skippedCount: 0 };
}

export async function listContacts(
  orgId: string,
  filters: ListFilters,
  page: Page,
): Promise<{ items: Contact[]; nextCursor?: string }> {
  return withOrgContext(orgId, async (tx) => {
    const conditions: (SQL | undefined)[] = [
      eq(contacts.org_id, orgId),
      isNull(contacts.deleted_at),
    ];

    if (filters.listId) {
      conditions.push(eq(contacts.contact_list_id, filters.listId));
    }
    if (filters.optOut !== undefined) {
      conditions.push(eq(contacts.opt_out, filters.optOut));
    }
    if (filters.rpoStatus) {
      conditions.push(eq(contacts.rpo_status, filters.rpoStatus));
    }
    if (filters.search) {
      const escaped = filters.search.replace(/[%_\\]/g, '\\$&');
      const pattern = `%${escaped}%`;
      conditions.push(
        or(
          ilike(contacts.first_name, pattern),
          ilike(contacts.last_name, pattern),
          ilike(contacts.phone_e164, pattern),
        ),
      );
    }

    if (page.cursor) {
      const cursor = decodeCursor(page.cursor);
      const cursorDate = new Date(cursor.createdAt);
      conditions.push(
        or(
          lt(contacts.created_at, cursorDate),
          and(eq(contacts.created_at, cursorDate), lt(contacts.id, cursor.id)),
        ),
      );
    }

    const rows = await tx
      .select()
      .from(contacts)
      .where(and(...conditions))
      .orderBy(desc(contacts.created_at), desc(contacts.id))
      .limit(page.limit + 1);

    let nextCursor: string | undefined;
    if (rows.length > page.limit) {
      rows.pop();
      const last = rows[rows.length - 1]!;
      nextCursor = encodeCursor({
        createdAt: last.created_at.toISOString(),
        id: last.id,
      });
    }

    return { items: rows, ...(nextCursor !== undefined ? { nextCursor } : {}) };
  });
}

export async function softDeleteContact(
  orgId: string,
  byUserId: string,
  contactId: string,
): Promise<void> {
  await withOrgContext(orgId, async (tx) => {
    const [deleted] = await tx
      .update(contacts)
      .set({ deleted_at: new Date() })
      .where(
        and(
          eq(contacts.id, contactId),
          eq(contacts.org_id, orgId),
          isNull(contacts.deleted_at),
        ),
      )
      .returning({ id: contacts.id });

    if (!deleted) {
      throw new Error('contact_not_found');
    }

    await recordAudit(tx, {
      orgId,
      actorUserId: byUserId,
      actorType: 'user',
      action: 'contact.deleted',
      subjectType: 'contact',
      subjectId: contactId,
    });
  });
}

export async function countContactsForOrg(orgId: string): Promise<number> {
  return withOrgContext(orgId, async (tx) => {
    const [result] = await tx
      .select({ total: count() })
      .from(contacts)
      .where(and(eq(contacts.org_id, orgId), isNull(contacts.deleted_at)));
    return result?.total ?? 0;
  });
}

export async function markOptOut(
  orgId: string,
  phoneE164: string,
  source: OptOutSource,
  reason?: string,
): Promise<void> {
  await withOrgContext(orgId, async (tx) => {
    await tx
      .insert(optOutRegistry)
      .values({ org_id: orgId, phone_e164: phoneE164, source })
      .onConflictDoNothing();

    await tx
      .update(contacts)
      .set({ opt_out: true, opt_out_reason: reason ?? null })
      .where(
        and(
          eq(contacts.org_id, orgId),
          eq(contacts.phone_e164, phoneE164),
          isNull(contacts.deleted_at),
        ),
      );
  });
}

/**
 * Bulk-inserts multiple phone numbers into the opt-out registry in a single
 * transaction. Existing entries are silently skipped (ON CONFLICT DO NOTHING).
 * Matching live contact rows are also marked opt_out = true.
 */
export async function bulkMarkOptOut(
  orgId: string,
  phonesE164: string[],
  source: OptOutSource,
): Promise<void> {
  if (phonesE164.length === 0) return;

  for (let i = 0; i < phonesE164.length; i += BATCH_SIZE) {
    const batch = phonesE164.slice(i, i + BATCH_SIZE);
    await withOrgContext(orgId, async (tx) => {
      await tx
        .insert(optOutRegistry)
        .values(batch.map((phone_e164) => ({ org_id: orgId, phone_e164, source })))
        .onConflictDoNothing();

      await tx
        .update(contacts)
        .set({ opt_out: true })
        .where(
          and(
            eq(contacts.org_id, orgId),
            inArray(contacts.phone_e164, batch),
            isNull(contacts.deleted_at),
          ),
        );
    });
  }
}
