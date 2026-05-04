'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getAuthContext } from '@/lib/auth/context';
import type { PersonalAccessToken } from '@/lib/db/schema';
import { createPat, revokePat } from '@/lib/services/pat';
import type { ActionResult } from '@/lib/utils/action-toast';

const createPatSchema = z.object({
  name: z.string().min(1, 'name_required').max(100, 'name_too_long'),
  scopes: z.array(z.string()).min(1, 'scopes_required'),
  expiresAt: z.string().optional(),
});

const revokePatSchema = z.object({
  patId: z.string().uuid(),
});

export async function createPatAction(input: {
  name: string;
  scopes: string[];
  expiresAt?: string;
}): Promise<ActionResult & { rawToken?: string; pat?: PersonalAccessToken }> {
  const parsed = createPatSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, message: issue?.message ?? 'validation_error' };
  }

  const { userId, orgId } = await getAuthContext();

  try {
    const result = await createPat({
      userId,
      orgId,
      name: parsed.data.name,
      scopes: parsed.data.scopes,
      ...(parsed.data.expiresAt ? { expiresAt: parsed.data.expiresAt } : {}),
    });
    revalidatePath('/settings/integrations');
    return { ok: true, rawToken: result.rawToken, pat: result.pat };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'error_generic';
    return { ok: false, message };
  }
}

export async function revokePatAction(input: { patId: string }): Promise<ActionResult> {
  const parsed = revokePatSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, message: issue?.message ?? 'validation_error' };
  }

  const { userId, orgId } = await getAuthContext();

  try {
    await revokePat(parsed.data.patId, userId, orgId);
    revalidatePath('/settings/integrations');
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'error_generic';
    return { ok: false, message };
  }
}

