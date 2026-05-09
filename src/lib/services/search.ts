import { and, asc, eq, ilike, isNull, or } from 'drizzle-orm';

import { withOrgContext } from '@/lib/db/context';
import { campaigns, contacts, scripts } from '@/lib/db/schema';

export interface PaletteContactResult {
  id: string;
  firstName: string | null;
  lastName: string | null;
  phone: string;
  contactListId: string;
}

export interface PaletteCampaignResult {
  id: string;
  name: string;
  status: string;
}

export interface PaletteScriptResult {
  id: string;
  name: string;
}

export interface PaletteSearchOptions {
  contacts: boolean;
  campaigns: boolean;
  scripts: boolean;
  limit?: number;
}

export interface PaletteSearchResults {
  contacts: PaletteContactResult[];
  campaigns: PaletteCampaignResult[];
  scripts: PaletteScriptResult[];
}

const DEFAULT_LIMIT = 20;
const MAX_QUERY_LENGTH = 100;

function escapeLike(query: string): string {
  return query.replace(/[%_\\]/g, '\\$&');
}

/**
 * Searches contacts, campaigns, and scripts in a single transaction. Each group
 * is gated independently by the caller via `options`. Results are capped at
 * `options.limit` (default 20) per group. Soft-deleted contacts are excluded.
 */
export async function searchPalette(
  orgId: string,
  rawQuery: string,
  options: PaletteSearchOptions,
): Promise<PaletteSearchResults> {
  const trimmed = rawQuery.trim().slice(0, MAX_QUERY_LENGTH);
  if (trimmed.length === 0) {
    return { contacts: [], campaigns: [], scripts: [] };
  }

  const limit = options.limit ?? DEFAULT_LIMIT;
  const pattern = `%${escapeLike(trimmed)}%`;

  return withOrgContext(orgId, async (tx) => {
    const [contactRows, campaignRows, scriptRows] = await Promise.all([
      options.contacts
        ? tx
            .select({
              id: contacts.id,
              first_name: contacts.first_name,
              last_name: contacts.last_name,
              phone_e164: contacts.phone_e164,
              contact_list_id: contacts.contact_list_id,
            })
            .from(contacts)
            .where(
              and(
                eq(contacts.org_id, orgId),
                isNull(contacts.deleted_at),
                or(
                  ilike(contacts.first_name, pattern),
                  ilike(contacts.last_name, pattern),
                  ilike(contacts.phone_e164, pattern),
                ),
              ),
            )
            .orderBy(asc(contacts.last_name), asc(contacts.first_name))
            .limit(limit)
        : Promise.resolve([]),
      options.campaigns
        ? tx
            .select({
              id: campaigns.id,
              name: campaigns.name,
              status: campaigns.status,
            })
            .from(campaigns)
            .where(and(eq(campaigns.org_id, orgId), ilike(campaigns.name, pattern)))
            .orderBy(asc(campaigns.name))
            .limit(limit)
        : Promise.resolve([]),
      options.scripts
        ? tx
            .select({ id: scripts.id, name: scripts.name })
            .from(scripts)
            .where(and(eq(scripts.org_id, orgId), ilike(scripts.name, pattern)))
            .orderBy(asc(scripts.name))
            .limit(limit)
        : Promise.resolve([]),
    ]);

    return {
      contacts: contactRows.map((c) => ({
        id: c.id,
        firstName: c.first_name,
        lastName: c.last_name,
        phone: c.phone_e164,
        contactListId: c.contact_list_id,
      })),
      campaigns: campaignRows.map((c) => ({
        id: c.id,
        name: c.name,
        status: c.status,
      })),
      scripts: scriptRows.map((s) => ({ id: s.id, name: s.name })),
    };
  });
}
