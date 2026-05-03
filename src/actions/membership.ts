'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getAuthContext } from '@/lib/auth/context';
import {
  inviteMember,
  listMembers,
  removeMember,
  updateMemberRole,
} from '@/lib/services/memberships';
import type { ActionResult } from '@/lib/utils/action-toast';
import type { MemberRole } from '@/types';

const inviteSchema = z.object({
  email: z.string().email('email_invalid'),
  role: z.enum(['owner', 'admin', 'operator', 'viewer']),
});

const updateRoleSchema = z.object({
  membershipId: z.string().uuid(),
  role: z.enum(['owner', 'admin', 'operator', 'viewer']),
});

const removeMemberSchema = z.object({
  membershipId: z.string().uuid(),
});

export async function inviteMemberAction(input: {
  email: string;
  role: MemberRole;
}): Promise<ActionResult> {
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, message: issue?.message ?? 'validation_error' };
  }

  const { userId, orgId } = await getAuthContext();

  try {
    await inviteMember(orgId, userId, parsed.data);
    revalidatePath('/settings/members');
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'error_generic';
    return { ok: false, message };
  }
}

export async function updateMemberRoleAction(input: {
  membershipId: string;
  role: MemberRole;
}): Promise<ActionResult> {
  const parsed = updateRoleSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, message: issue?.message ?? 'validation_error' };
  }

  const { userId, orgId } = await getAuthContext();

  try {
    await updateMemberRole(orgId, userId, parsed.data.membershipId, parsed.data.role);
    revalidatePath('/settings/members');
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'error_generic';
    return { ok: false, message };
  }
}

export async function removeMemberAction(input: { membershipId: string }): Promise<ActionResult> {
  const parsed = removeMemberSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, message: issue?.message ?? 'validation_error' };
  }

  const { userId, orgId } = await getAuthContext();

  try {
    await removeMember(orgId, userId, parsed.data.membershipId);
    revalidatePath('/settings/members');
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'error_generic';
    return { ok: false, message };
  }
}

export { listMembers };
