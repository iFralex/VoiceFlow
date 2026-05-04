import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
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
 * SHA-256 hex digest of a string using the Web Crypto API (Edge-compatible).
 */
async function sha256Hex(input: string): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Module-level admin client for PAT lookups — created once per worker process.
 * Avoids constructing a new SDK client (and its fetch adapter) on every request.
 */
const _patAdminClient = (() => {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
})();

/**
 * Attempts to authenticate a request using a Personal Access Token (PAT).
 * Returns identity if the token is valid, or null if not.
 *
 * Only called for non-webhook API routes with an Authorization: Bearer header.
 */
async function tryPatAuth(
  rawToken: string,
): Promise<{ userId: string; orgId: string; role: string } | null> {
  const admin = _patAdminClient;
  if (!admin) return null;

  const tokenHash = await sha256Hex(rawToken);

  const { data: pat } = await admin
    .from('personal_access_tokens')
    .select('user_id, org_id, revoked_at, expires_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (!pat) return null;
  if (pat.revoked_at) return null;
  if (pat.expires_at && new Date(pat.expires_at as string) < new Date()) return null;

  // Look up the membership role so downstream code behaves uniformly
  const { data: membership } = await admin
    .from('memberships')
    .select('role')
    .eq('user_id', pat.user_id as string)
    .eq('org_id', pat.org_id as string)
    .not('accepted_at', 'is', null)
    .maybeSingle();

  // If the membership has been removed, the PAT is no longer valid
  if (!membership) return null;
  const role = membership.role as string;

  // Best-effort update of last_used_at (fire-and-forget)
  void admin
    .from('personal_access_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('token_hash', tokenHash);

  return { userId: pat.user_id as string, orgId: pat.org_id as string, role };
}

/**
 * Middleware: session validation, org resolution and request-header injection.
 *
 * Runs on every request except static assets (configured in the matcher).
 * Public paths receive only the `x-locale` header and are not checked against
 * Supabase. Protected paths go through full session + org validation.
 *
 * For API routes, additionally accepts `Authorization: Bearer <pat>` in place
 * of session cookies (Personal Access Token authentication, spec §14.1).
 *
 * Headers set for downstream Server Components and Server Actions:
 *   x-locale      — 'it' | 'en' (resolved from the locale cookie)
 *   x-user-id     — Supabase auth user UUID
 *   x-org-id      — active organisation UUID
 *   x-member-role — 'owner' | 'admin' | 'operator' | 'viewer'
 *   x-auth-method — 'pat' when authenticated via Personal Access Token
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

  // ── PAT Bearer token auth (API routes only) ───────────────────────────────
  const authHeader = request.headers.get('Authorization');
  if (isApiRoute(pathname) && authHeader?.startsWith('Bearer ')) {
    const rawToken = authHeader.slice(7).trim();
    if (rawToken) {
      const identity = await tryPatAuth(rawToken);
      if (identity) {
        const reqHeaders = new Headers(request.headers);
        reqHeaders.set('x-locale', locale);
        reqHeaders.set('x-user-id', identity.userId);
        reqHeaders.set('x-org-id', identity.orgId);
        reqHeaders.set('x-member-role', identity.role);
        reqHeaders.set('x-auth-method', 'pat');
        return NextResponse.next({ request: { headers: reqHeaders } });
      }
      // Bearer token present but invalid → 401; don't fall through to cookie auth
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
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
    const redirectRes = NextResponse.redirect(url);
    // Propagate any refreshed session cookies so the browser doesn't lose them
    supabaseResponse.cookies.getAll().forEach(({ name, value, ...opts }) =>
      redirectRes.cookies.set(name, value, opts),
    );
    return redirectRes;
  }

  // ── Org resolution ────────────────────────────────────────────────────────
  // memberships_self_select RLS policy (0011 migration) allows this query via
  // Supabase PostgREST using auth.uid() without the app.current_org_id GUC.
  // The embedded organizations join lets us exclude soft-deleted orgs.
  const { data: rawMemberships } = await supabase
    .from('memberships')
    .select('org_id, role, organizations!inner(deleted_at)')
    .eq('user_id', user.id)
    .not('accepted_at', 'is', null);

  const activeOrgId = request.cookies.get('active_org_id')?.value;
  // Exclude memberships for soft-deleted organizations
  const validMemberships = (rawMemberships ?? [])
    .filter((m) => {
      const org = (m as unknown as { organizations?: { deleted_at: string | null } })
        .organizations;
      return !org?.deleted_at;
    })
    .map(({ org_id, role }) => ({ org_id, role }));
  const activeMembership =
    validMemberships.find((m) => m.org_id === activeOrgId) ?? validMemberships[0] ?? null;

  // ── No accepted memberships → onboarding ─────────────────────────────────
  if (!activeMembership) {
    if (!pathname.startsWith('/onboarding')) {
      const url = request.nextUrl.clone();
      url.pathname = '/onboarding';
      const redirectRes = NextResponse.redirect(url);
      // Propagate any refreshed session cookies so the browser doesn't lose them
      supabaseResponse.cookies.getAll().forEach(({ name, value, ...opts }) =>
        redirectRes.cookies.set(name, value, opts),
      );
      return redirectRes;
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
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
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
