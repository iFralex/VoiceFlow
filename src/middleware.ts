import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';

/**
 * Paths that bypass authentication entirely:
 *   - Auth pages (login, signup, verify, accedi)
 *   - Auth callback (/auth/*)
 *   - Webhook endpoints (signature-verified by their own route handlers)
 *   - Marketing home and dev kitchen-sink
 */
function isPublicPath(pathname: string): boolean {
  return (
    pathname === '/' ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/signup') ||
    pathname.startsWith('/verify') ||
    pathname.startsWith('/accedi') ||
    pathname.startsWith('/auth/') ||
    pathname.startsWith('/api/webhooks/') ||
    pathname.startsWith('/_kitchen-sink')
  );
}

/**
 * Non-webhook API routes: authenticated but respond with JSON 401 instead of redirect.
 */
function isApiRoute(pathname: string): boolean {
  return pathname.startsWith('/api/') && !pathname.startsWith('/api/webhooks/');
}

/**
 * Middleware: session validation, org resolution and request-header injection.
 *
 * Runs on every request except static assets (configured in the matcher).
 * Public paths receive only the `x-locale` header and are not checked against
 * Supabase. Protected paths go through full session + org validation.
 *
 * Headers set for downstream Server Components and Server Actions:
 *   x-locale      — 'it' | 'en' (resolved from the locale cookie)
 *   x-user-id     — Supabase auth user UUID
 *   x-org-id      — active organisation UUID
 *   x-member-role — 'owner' | 'admin' | 'operator' | 'viewer'
 */
export async function middleware(request: NextRequest): Promise<NextResponse> {
  const locale = request.cookies.get('locale')?.value === 'en' ? 'en' : 'it';
  const { pathname } = request.nextUrl;

  // ── Public paths ──────────────────────────────────────────────────────────
  if (isPublicPath(pathname)) {
    const reqHeaders = new Headers(request.headers);
    reqHeaders.set('x-locale', locale);
    return NextResponse.next({ request: { headers: reqHeaders } });
  }

  // ── Supabase SSR client (refreshes session cookies if needed) ─────────────
  // IMPORTANT: do not add code between createServerClient and getUser() per
  // the Supabase SSR guidance — cookie writes from getUser() must propagate.
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          // Mutate the request-side cookies so the refreshed token is readable
          // in subsequent middleware code, then rebuild the response so the
          // new cookies are written back to the browser.
          // RequestCookies.set() only accepts (name, value) — no options.
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // ── Unauthenticated ───────────────────────────────────────────────────────
  if (!user) {
    if (isApiRoute(pathname)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  // ── Org resolution ────────────────────────────────────────────────────────
  // memberships_self_select RLS policy (0011 migration) allows this query via
  // Supabase PostgREST using auth.uid() without the app.current_org_id GUC.
  const { data: memberships } = await supabase
    .from('memberships')
    .select('org_id, role')
    .eq('user_id', user.id)
    .not('accepted_at', 'is', null);

  const activeOrgId = request.cookies.get('active_org_id')?.value;
  const validMemberships = memberships ?? [];
  const activeMembership =
    validMemberships.find((m) => m.org_id === activeOrgId) ?? validMemberships[0] ?? null;

  // ── No accepted memberships → onboarding ─────────────────────────────────
  if (!activeMembership) {
    if (!pathname.startsWith('/onboarding')) {
      const url = request.nextUrl.clone();
      url.pathname = '/onboarding';
      return NextResponse.redirect(url);
    }
    // Already on onboarding — allow through with user identity only
    const reqHeaders = new Headers(request.headers);
    reqHeaders.set('x-locale', locale);
    reqHeaders.set('x-user-id', user.id);
    const res = NextResponse.next({ request: { headers: reqHeaders } });
    supabaseResponse.cookies.getAll().forEach(({ name, value, ...opts }) =>
      res.cookies.set(name, value, opts),
    );
    return res;
  }

  // ── Auto-correct stale/missing active_org_id cookie ───────────────────────
  if (!validMemberships.find((m) => m.org_id === activeOrgId)) {
    supabaseResponse.cookies.set('active_org_id', activeMembership.org_id, {
      path: '/',
      sameSite: 'lax',
      httpOnly: false,
    });
  }

  // ── Inject identity headers for Server Components and Server Actions ───────
  const reqHeaders = new Headers(request.headers);
  reqHeaders.set('x-locale', locale);
  reqHeaders.set('x-user-id', user.id);
  reqHeaders.set('x-org-id', activeMembership.org_id);
  reqHeaders.set('x-member-role', activeMembership.role);

  const finalRes = NextResponse.next({ request: { headers: reqHeaders } });
  supabaseResponse.cookies.getAll().forEach(({ name, value, ...opts }) =>
    finalRes.cookies.set(name, value, opts),
  );

  return finalRes;
}

export const config = {
  // Run on everything except Next.js static bundles and optimised images.
  // Auth pages, marketing pages, and webhooks are excluded programmatically
  // inside the middleware function via isPublicPath().
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico).*)'],
};
