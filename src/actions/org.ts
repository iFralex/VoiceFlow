'use server';

import { and, eq, isNotNull } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { z } from 'zod';

import { withSystemContext } from '@/lib/db/context';
import { memberships } from '@/lib/db/schema';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { ActionResult } from '@/lib/utils/action-toast';

const orgIdSchema = z.string().uuid('invalid_org_id');

/**
 * Validates that the current user has an accepted membership in `orgId`,
 * then writes the `active_org_id` cookie.
 *
 * Supersedes the unprotected stub from plan 03.
 */
export async function setActiveOrg(orgId: string): Promise<ActionResult> {
  const parsed = orgIdSchema.safeParse(orgId);
  if (!parsed.success) {
    return { ok: false, message: 'invalid_org_id' };
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError ?? !user) {
    return { ok: false, message: 'auth.unauthenticated' };
  }

  const member = await withSystemContext(async (tx) => {
    const [row] = await tx
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.org_id, parsed.data),
          eq(memberships.user_id, user.id),
          isNotNull(memberships.accepted_at),
        ),
      );
    return row ?? null;
  });

  if (!member) {
    return { ok: false, message: 'not_a_member' };
  }

  const store = await cookies();
  store.set('active_org_id', parsed.data, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365, // 1 year
    secure: process.env.NODE_ENV === 'production',
  });

  return { ok: true };
}

