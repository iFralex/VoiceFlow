'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { recordDpaAcceptance } from '@/lib/compliance/dpa';
import { createOrganization } from '@/lib/services/organizations';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { ActionResult } from '@/lib/utils/action-toast';

const onboardingSchema = z.object({
  name: z.string().min(1, 'name_required').max(100, 'name_too_long'),
  legalName: z.string().optional(),
  vatNumber: z.string().optional(),
  // Plan 11 task 16: the DPA tickbox is required on the onboarding form;
  // enforce server-side too so a direct Server Action call cannot bypass it.
  dpaAccepted: z.literal(true, { message: 'dpa_required' }),
});

type OnboardingInput = z.infer<typeof onboardingSchema>;

/**
 * Creates a new organization for the currently authenticated user and
 * sets it as the active org. Records DPA acceptance in the audit log.
 * Redirects to /dashboard on success.
 */
export async function createOrganizationAndOnboard(
  input: OnboardingInput,
): Promise<ActionResult> {
  const parsed = onboardingSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, message: issue?.message ?? 'validation_error' };
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError ?? !user) {
    return { ok: false, message: 'auth.unauthenticated' };
  }

  try {
    const org = await createOrganization({
      ownerId: user.id,
      name: parsed.data.name,
      ...(parsed.data.legalName ? { legalName: parsed.data.legalName } : {}),
      ...(parsed.data.vatNumber ? { vatNumber: parsed.data.vatNumber } : {}),
    });

    // Record DPA acceptance in the audit log with IP, user-agent and version.
    const h = await headers();
    const ip =
      h.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      h.get('x-real-ip')?.trim() ??
      null;
    const userAgent = h.get('user-agent') ?? null;

    await recordDpaAcceptance({
      orgId: org.id,
      userId: user.id,
      ip,
      userAgent,
    });

    // Set the new org as the active org
    const cookieStore = await cookies();
    cookieStore.set('active_org_id', org.id, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 365, // 1 year
      secure: process.env.NODE_ENV === 'production',
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unknown_error';
    if (message === 'invalid_vat_number') {
      return { ok: false, message: 'vat_invalid' };
    }
    return { ok: false, message: 'error_generic' };
  }

  // Must be outside try/catch — redirect() throws NEXT_REDIRECT internally
  redirect('/dashboard');
}
