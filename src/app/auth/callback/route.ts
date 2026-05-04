import { NextResponse, type NextRequest } from 'next/server';

import { createServerSupabaseClient } from '@/lib/supabase/server';

/**
 * Handles the Supabase magic-link redirect.
 * Supabase appends `?code=<pkce_code>` to the redirect URL configured in the
 * dashboard (e.g. https://yourapp.com/auth/callback). This handler:
 *   1. Exchanges the code for a session (sets auth cookies).
 *   2. Redirects to /dashboard; middleware (Task 7) will forward to
 *      /onboarding if the user has no organization yet.
 *
 * On error, redirects to /login with an error query parameter.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/dashboard';

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error('[auth/callback] exchangeCodeForSession error:', error.message);
    return NextResponse.redirect(`${origin}/login?error=auth_error`);
  }

  // Ensure the redirect target is a relative path on this origin to prevent
  // open redirect vulnerabilities. Reject protocol-relative paths like //evil.com.
  const isSafeRelative = next.startsWith('/') && !next.startsWith('//');
  const redirectTo = isSafeRelative ? `${origin}${next}` : `${origin}/dashboard`;
  return NextResponse.redirect(redirectTo);
}
