'use server';

import { createHash } from 'crypto';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { recordAudit } from '@/lib/db/audit';
import { withSystemContext } from '@/lib/db/context';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { ActionResult } from '@/lib/utils/action-toast';

const emailSchema = z.string().min(1, 'email_required').email('email_invalid');

/** SHA-256 hash of the lower-cased email — used as a pseudonymous subject_id in audit entries. */
function hashEmail(email: string): string {
  return createHash('sha256').update(email.toLowerCase()).digest('hex');
}

/**
 * Sends a magic-link OTP email for sign-in or sign-up.
 * New users get a `public.users` row via the auth trigger (Task 4).
 */
export async function signInWithMagicLink(email: string): Promise<ActionResult> {
  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) {
    const key = parsed.error.issues[0]?.message ?? 'email_invalid';
    await withSystemContext(async (tx) => {
      await recordAudit(tx, {
        actorType: 'user',
        action: 'auth.signin_requested',
        subjectType: 'user',
        subjectId: 'invalid_email',
        metadata: { success: false, reason: 'validation_failed' },
      });
    });
    return { ok: false, message: key };
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data,
    options: { shouldCreateUser: true },
  });

  const emailHash = hashEmail(parsed.data);
  await withSystemContext(async (tx) => {
    await recordAudit(tx, {
      actorType: 'user',
      action: 'auth.signin_requested',
      subjectType: 'user',
      subjectId: emailHash,
      metadata: { success: !error, ...(error ? { error: error.message } : {}) },
    });
  });

  if (error) {
    return { ok: false, message: error.message };
  }

  return { ok: true };
}

/**
 * Signs out the current user: clears the Supabase session and the
 * `active_org_id` cookie, then redirects to `/`.
 */
export async function signOut(): Promise<void> {
  const supabase = await createServerSupabaseClient();

  // Capture userId before invalidating the session
  const {
    data: { user },
  } = await supabase.auth.getUser();

  await withSystemContext(async (tx) => {
    await recordAudit(tx, {
      actorType: 'user',
      ...(user?.id ? { actorUserId: user.id } : {}),
      action: 'auth.signed_out',
      subjectType: 'user',
      subjectId: user?.id ?? 'unknown',
    });
  });

  await supabase.auth.signOut();

  const cookieStore = await cookies();
  cookieStore.delete('active_org_id');

  redirect('/');
}

/**
 * Requests an email address change for the currently authenticated user.
 * Triggers the Supabase change-email flow (confirmation sent to new address).
 */
export async function requestEmailChange(newEmail: string): Promise<ActionResult> {
  const parsed = emailSchema.safeParse(newEmail);
  if (!parsed.success) {
    const key = parsed.error.issues[0]?.message ?? 'email_invalid';
    return { ok: false, message: key };
  }

  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
    error: sessionError,
  } = await supabase.auth.getUser();

  if (sessionError ?? !user) {
    return { ok: false, message: 'auth.unauthenticated' };
  }

  const { error } = await supabase.auth.updateUser({ email: parsed.data });

  await withSystemContext(async (tx) => {
    await recordAudit(tx, {
      actorType: 'user',
      actorUserId: user.id,
      action: 'auth.email_change_requested',
      subjectType: 'user',
      subjectId: user.id,
      metadata: { success: !error, ...(error ? { error: error.message } : {}) },
    });
  });

  if (error) {
    return { ok: false, message: error.message };
  }

  return { ok: true };
}
