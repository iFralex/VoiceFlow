'use server';

import { z } from 'zod';

import { getAuthContext, hasCapability } from '@/lib/auth/context';
import {
  searchPalette,
  type PaletteSearchResults,
} from '@/lib/services/search';

const searchSchema = z.object({
  query: z.string().min(1).max(100),
});

export type SearchPaletteResult =
  | { ok: true; results: PaletteSearchResults }
  | { ok: false; message: string };

/**
 * Server-side cmd+K search across contacts, campaigns, and scripts.
 *
 * Each group is gated by the caller's role:
 *   - contacts: requires `contacts.upload` (operator+; viewers do not see
 *     contacts)
 *   - campaigns: requires `campaigns.view` (all roles)
 *   - scripts:  requires `scripts.edit` (operator+)
 *
 * Capability checks gate visibility, not access errors — a missing capability
 * just yields an empty group rather than an error, so a viewer can still
 * search campaigns even if contacts/scripts return nothing.
 */
export async function searchPaletteAction(
  input: z.infer<typeof searchSchema>,
): Promise<SearchPaletteResult> {
  const parsed = searchSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'validation_error' };
  }
  try {
    const { orgId, role } = await getAuthContext();

    const results = await searchPalette(orgId, parsed.data.query, {
      contacts: hasCapability(role, 'contacts.upload'),
      campaigns: hasCapability(role, 'campaigns.view'),
      scripts: hasCapability(role, 'scripts.edit'),
    });

    return { ok: true, results };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'error' };
  }
}
