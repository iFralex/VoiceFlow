'use server';

import { z } from 'zod';

import { getAuthContext, requireCapability } from '@/lib/auth/context';
import { env } from '@/lib/env';
import {
  createScript as createScriptService,
  deleteScript as deleteScriptService,
  getScript as getScriptService,
  previewSystemPrompt as previewSystemPromptService,
  updateScript as updateScriptService,
  ScriptReferencedByCampaignError,
} from '@/lib/services/scripts';
import type { ActionResult } from '@/lib/utils/action-toast';
import {
  ELEVENLABS_DEFAULT_VOICE_ID,
  synthesizeSpeech,
} from '@/lib/voice/elevenlabs';

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
export async function deleteScriptAction(
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
      return { ok: false, message: 'delete_error_referenced' };
    }
    return { ok: false, message: e instanceof Error ? e.message : 'error' };
  }
}

// ---------------------------------------------------------------------------
// Voice sample preview
// ---------------------------------------------------------------------------

export type VoiceSampleResult =
  | { ok: true; audioDataUrl: string }
  | { ok: false; status: 'not_configured'; message: string }
  | { ok: false; status: 'error'; message: string };

/**
 * In-memory cache: key is `${voiceId}:${text}`, value is base64 data URL + TTL.
 * Avoids re-synthesizing the same snippet within 24 h.
 */
const voiceSampleCache = new Map<string, { dataUrl: string; expiresAt: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function resolveElevenLabsVoiceId(voiceId: string | null | undefined): string {
  if (voiceId && !voiceId.includes('placeholder')) {
    return voiceId;
  }
  return ELEVENLABS_DEFAULT_VOICE_ID;
}

const previewVoiceSampleSchema = z.object({ scriptId: z.string().uuid() });

/**
 * Synthesises the first 60 characters of a script's first message using
 * ElevenLabs TTS and returns a base64 audio/mpeg data URL.
 *
 * Returns `{ ok: false, status: 'not_configured' }` when ELEVENLABS_API_KEY
 * is absent — the UI hides the button in that case.
 *
 * Results are cached in memory for 24 h per (voiceId, text) pair to avoid
 * burning ElevenLabs credits during iterative editing.
 */
export async function previewVoiceSampleAction(
  input: z.infer<typeof previewVoiceSampleSchema>,
): Promise<VoiceSampleResult> {
  const parsed = previewVoiceSampleSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, status: 'error', message: 'invalid_input' };
  }

  const apiKey = env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      status: 'not_configured',
      message: 'ElevenLabs API key not configured',
    };
  }

  try {
    const { orgId } = await getAuthContext();
    await requireCapability('scripts.edit');

    const [{ firstMessage }, script] = await Promise.all([
      previewSystemPromptService(orgId, parsed.data.scriptId),
      getScriptService(orgId, parsed.data.scriptId),
    ]);

    if (!script) {
      return { ok: false, status: 'error', message: 'script_not_found' };
    }

    const textToSynthesize = firstMessage.slice(0, 60);
    const voiceId = resolveElevenLabsVoiceId(
      script.voice_id ?? script.template.default_voice_id,
    );

    const cacheKey = `${voiceId}:${textToSynthesize}`;
    const cached = voiceSampleCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return { ok: true, audioDataUrl: cached.dataUrl };
    }

    const audioBuffer = await synthesizeSpeech({ text: textToSynthesize, voiceId, apiKey });
    const dataUrl = `data:audio/mpeg;base64,${audioBuffer.toString('base64')}`;

    voiceSampleCache.set(cacheKey, { dataUrl, expiresAt: Date.now() + CACHE_TTL_MS });

    return { ok: true, audioDataUrl: dataUrl };
  } catch (e) {
    console.error('[previewVoiceSampleAction]', e);
    return { ok: false, status: 'error', message: 'Errore durante la sintesi vocale.' };
  }
}
