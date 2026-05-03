'use server';

import { z } from 'zod';

import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { ActionResult } from '@/lib/utils/action-toast';

const emailSchema = z.string().min(1, 'email_required').email('email_invalid');

/**
 * Sends a magic-link OTP email for sign-in or sign-up.
 * New users get a `public.users` row via the auth trigger (Task 4).
 */
export async function signInWithMagicLink(email: string): Promise<ActionResult> {
  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) {
    const key = parsed.error.issues[0]?.message ?? 'email_invalid';
    return { ok: false, message: key };
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data,
    options: {
      shouldCreateUser: true,
    },
  });

  if (error) {
    return { ok: false, message: error.message };
  }

  return { ok: true };
}
