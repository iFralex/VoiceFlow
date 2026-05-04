'use server';

import { z } from 'zod';

import { getAuthContext, requireCapability } from '@/lib/auth/context';
import {
  deleteScript as deleteScriptService,
  ScriptReferencedByCampaignError,
} from '@/lib/services/scripts';
import type { ActionResult } from '@/lib/utils/action-toast';

const deleteScriptSchema = z.object({ scriptId: z.string().uuid() });

/**
 * Deletes an org-owned script.
 * Blocked if the script is referenced by any non-completed/non-cancelled campaign.
 */
export async function deleteScript(
  input: z.infer<typeof deleteScriptSchema>,
): Promise<ActionResult> {
  const parsed = deleteScriptSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'validation_error' };
  }
  try {
    const { orgId, userId } = await getAuthContext();
    await requireCapability('scripts.edit');
    await deleteScriptService(orgId, userId, parsed.data.scriptId);
    return { ok: true };
  } catch (e) {
    if (e instanceof ScriptReferencedByCampaignError) {
      return {
        ok: false,
        message:
          'Questo script è utilizzato da campagne attive. Completale o annullale prima.',
      };
    }
    return { ok: false, message: e instanceof Error ? e.message : 'error' };
  }
}
