'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { getAuthContext, requireCapability } from '@/lib/auth/context';
import {
  getOrganization,
  softDeleteOrganization,
  updateOrganization,
} from '@/lib/services/organizations';
import type { ActionResult } from '@/lib/utils/action-toast';

const updateOrgSchema = z.object({
  name: z.string().min(1, 'name_required').max(100, 'name_too_long'),
  legalName: z.string().optional(),
  vatNumber: z.string().optional(),
});

const deleteOrgSchema = z.object({
  /** The typed org name for confirmation. Validated against the real name server-side. */
  confirmedName: z.string().min(1),
});

export async function updateOrganizationAction(input: {
  name: string;
  legalName?: string;
  vatNumber?: string;
}): Promise<ActionResult> {
  const parsed = updateOrgSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, message: issue?.message ?? 'validation_error' };
  }

  const { userId, orgId } = await getAuthContext();
  await requireCapability('org.manage');

  try {
    await updateOrganization(
      orgId,
      {
        name: parsed.data.name,
        legal_name: parsed.data.legalName ?? null,
        vat_number: parsed.data.vatNumber ?? null,
      },
      userId,
    );
    revalidatePath('/settings/organization');
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'error_generic';
    if (message === 'invalid_vat_number') {
      return { ok: false, message: 'vat_invalid' };
    }
    return { ok: false, message };
  }
}

export async function deleteOrganizationAction(input: {
  confirmedName: string;
}): Promise<ActionResult> {
  const parsed = deleteOrgSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: 'validation_error' };
  }

  const { userId, orgId } = await getAuthContext();
  await requireCapability('org.manage');

  // Verify the confirmed name matches the actual org name
  const org = await getOrganization(orgId);
  if (!org) {
    return { ok: false, message: 'organization_not_found' };
  }
  if (parsed.data.confirmedName !== org.name) {
    return { ok: false, message: 'delete_name_mismatch' };
  }

  try {
    await softDeleteOrganization(orgId, userId);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'error_generic';
    return { ok: false, message };
  }

  redirect('/onboarding');
}
