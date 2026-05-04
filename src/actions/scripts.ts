'use server';

import { z } from 'zod';

import { getAuthContext, requireCapability } from '@/lib/auth/context';
import {
  createScript as createScriptService,
  deleteScript as deleteScriptService,
  getScript as getScriptService,
  updateScript as updateScriptService,
  ScriptReferencedByCampaignError,
} from '@/lib/services/scripts';
import type { ActionResult } from '@/lib/utils/action-toast';

const createScriptInputSchema = z.object({
  templateSlug: z.string().min(1),
  name: z.string().min(1, 'Nome obbligatorio').max(200, 'Nome troppo lungo'),
  variables: z.record(z.string(), z.unknown()),
});

export async function createScriptAction(
  input: z.infer<typeof createScriptInputSchema>,
): Promise<ActionResult & { scriptId?: string }> {
  const parsed = createScriptInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'validation_error' };
  }
  try {
    const { orgId, userId } = await getAuthContext();
    await requireCapability('scripts.edit');
    const script = await createScriptService(orgId, userId, {
      templateSlug: parsed.data.templateSlug,
      name: parsed.data.name,
      variables: parsed.data.variables,
    });
    return { ok: true, scriptId: script.id };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'error' };
  }
}

const updateScriptInputSchema = z.object({
  scriptId: z.string().uuid(),
  name: z.string().min(1, 'Nome obbligatorio').max(200, 'Nome troppo lungo').optional(),
  variables: z.record(z.string(), z.unknown()).optional(),
  voiceId: z.string().max(256).optional().nullable(),
});

export async function updateScriptAction(
  input: z.infer<typeof updateScriptInputSchema>,
): Promise<ActionResult> {
  const parsed = updateScriptInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'validation_error' };
  }
  try {
    const { orgId, userId } = await getAuthContext();
    await requireCapability('scripts.edit');
    await updateScriptService(orgId, userId, parsed.data.scriptId, {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.variables !== undefined ? { variables: parsed.data.variables } : {}),
      ...(parsed.data.voiceId !== undefined ? { voice_id: parsed.data.voiceId } : {}),
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'error' };
  }
}

const copyScriptSchema = z.object({ scriptId: z.string().uuid() });

export async function copyScriptAction(
  input: z.infer<typeof copyScriptSchema>,
): Promise<ActionResult & { scriptId?: string }> {
  const parsed = copyScriptSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'validation_error' };
  }
  try {
    const { orgId, userId } = await getAuthContext();
    await requireCapability('scripts.edit');
    const existing = await getScriptService(orgId, parsed.data.scriptId);
    if (!existing) return { ok: false, message: 'script_not_found' };
    const copy = await createScriptService(orgId, userId, {
      templateSlug: existing.template.slug,
      templateVersion: existing.template.version,
      name: `${existing.name} (copia)`,
      variables: existing.variables as Record<string, unknown>,
      ...(existing.voice_id ? { voiceIdOverride: existing.voice_id } : {}),
    });
    return { ok: true, scriptId: copy.id };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'error' };
  }
}

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
