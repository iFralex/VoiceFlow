/**
 * Unit tests for src/middleware.ts
 *
 * These tests exercise the middleware logic (path classification, session
 * validation, org resolution, header injection) without hitting real Supabase
 * or the database. @supabase/ssr is fully mocked.
 *
 * Header assertions use the `x-middleware-request-{key}` pattern because
 * NextResponse.next({ request: { headers } }) stores custom headers that way
 * internally (they are then unpacked by the Next.js server into request headers
 * for downstream Server Components).
 */

import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Environment stubs ──────────────────────────────────────────────────────
vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co');
vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon-key');

// ── Supabase SSR mock ──────────────────────────────────────────────────────
let mockGetUser: ReturnType<typeof vi.fn>;
let mockFrom: ReturnType<typeof vi.fn>;

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(
    (_url: string, _key: string, options: { cookies: { setAll: (c: unknown[]) => void } }) => {
      // Simulate Supabase refreshing tokens (with no cookies in this test scenario)
      options.cookies.setAll([]);
      return {
        auth: { getUser: () => (mockGetUser as () => unknown)() },
        from: (table: string) => (mockFrom as (t: string) => unknown)(table),
      };
    },
  ),
}));

import { middleware } from './middleware';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeRequest(
  pathname: string,
  cookies: Record<string, string> = {},
): NextRequest {
  const url = new URL(pathname, 'http://localhost:3000');
  const req = new NextRequest(url);
  Object.entries(cookies).forEach(([name, value]) => req.cookies.set(name, value));
  return req;
}

/** Builds a chainable Supabase `.from().select().eq().not()` mock. */
function membershipChain(
  memberships: Array<{
    org_id: string;
    role: string;
    organizations?: { deleted_at: string | null };
  }>,
): { select: () => { eq: () => { not: () => Promise<{ data: typeof memberships }> } } } {
  const not = vi.fn().mockResolvedValue({ data: memberships });
  const eq = vi.fn().mockReturnValue({ not });
  const select = vi.fn().mockReturnValue({ eq });
  return { select };
}

/**
 * Read a header that was injected into the forwarded request.
 * NextResponse.next({ request: { headers } }) encodes them as
 * `x-middleware-request-{key}` on the response object.
 */
function getInjectedHeader(res: { headers: Headers }, key: string): string | null {
  return res.headers.get(`x-middleware-request-${key}`);
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('middleware', () => {
  beforeEach(() => {
    mockGetUser = vi.fn().mockResolvedValue({ data: { user: null } });
    mockFrom = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Public paths ──────────────────────────────────────────────────────────

  describe('public paths bypass auth', () => {
    const publicPaths = [
      '/',
      '/login',
      '/signup',
      '/verify',
      '/accedi',
      '/auth/callback',
      '/api/webhooks/stripe',
      '/_kitchen-sink',
    ];

    for (const path of publicPaths) {
      it(`passes through ${path} without calling getUser`, async () => {
        const req = makeRequest(path);
        const res = await middleware(req);
        expect(res.status).toBe(200);
        expect(mockGetUser).not.toHaveBeenCalled();
      });
    }
  });

  it('sets x-locale to "it" by default on public path', async () => {
    const req = makeRequest('/login');
    const res = await middleware(req);
    expect(getInjectedHeader(res, 'x-locale')).toBe('it');
  });

  it('sets x-locale to "en" when locale cookie is "en" on public path', async () => {
    const req = makeRequest('/login', { locale: 'en' });
    const res = await middleware(req);
    expect(getInjectedHeader(res, 'x-locale')).toBe('en');
  });

  it('ignores unknown locale values and defaults to "it"', async () => {
    const req = makeRequest('/login', { locale: 'fr' });
    const res = await middleware(req);
    expect(getInjectedHeader(res, 'x-locale')).toBe('it');
  });

  // ── Unauthenticated ───────────────────────────────────────────────────────

  it('redirects unauthenticated user on app route to /login with next param', async () => {
    const req = makeRequest('/dashboard');
    const res = await middleware(req);
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get('location')!);
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('next')).toBe('/dashboard');
  });

  it('returns 401 JSON for unauthenticated non-webhook API route', async () => {
    const req = makeRequest('/api/campaigns');
    const res = await middleware(req);
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Unauthorized');
  });

  it('passes through webhook API routes without auth check', async () => {
    const req = makeRequest('/api/webhooks/stripe');
    const res = await middleware(req);
    expect(res.status).toBe(200);
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  // ── Authenticated — no orgs ───────────────────────────────────────────────

  it('redirects to /onboarding when authenticated user has no accepted memberships', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockFrom.mockReturnValue(membershipChain([]));

    const req = makeRequest('/dashboard');
    const res = await middleware(req);
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get('location')!);
    expect(location.pathname).toBe('/onboarding');
  });

  it('allows /onboarding for authenticated user with no orgs', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockFrom.mockReturnValue(membershipChain([]));

    const req = makeRequest('/onboarding');
    const res = await middleware(req);
    expect(res.status).toBe(200);
    expect(getInjectedHeader(res, 'x-user-id')).toBe('user-1');
  });

  it('does not set x-org-id or x-member-role on /onboarding with no orgs', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockFrom.mockReturnValue(membershipChain([]));

    const req = makeRequest('/onboarding');
    const res = await middleware(req);
    expect(getInjectedHeader(res, 'x-org-id')).toBeNull();
    expect(getInjectedHeader(res, 'x-member-role')).toBeNull();
  });

  // ── Authenticated — with orgs ─────────────────────────────────────────────

  it('injects identity headers when active_org_id cookie matches a membership', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockFrom.mockReturnValue(
      membershipChain([
        { org_id: 'org-1', role: 'admin' },
        { org_id: 'org-2', role: 'viewer' },
      ]),
    );

    const req = makeRequest('/dashboard', { active_org_id: 'org-2' });
    const res = await middleware(req);
    expect(res.status).toBe(200);
    expect(getInjectedHeader(res, 'x-user-id')).toBe('user-1');
    expect(getInjectedHeader(res, 'x-org-id')).toBe('org-2');
    expect(getInjectedHeader(res, 'x-member-role')).toBe('viewer');
  });

  it('falls back to first org when active_org_id cookie is absent', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockFrom.mockReturnValue(membershipChain([{ org_id: 'org-1', role: 'owner' }]));

    const req = makeRequest('/dashboard');
    const res = await middleware(req);
    expect(getInjectedHeader(res, 'x-org-id')).toBe('org-1');
    expect(getInjectedHeader(res, 'x-member-role')).toBe('owner');
    // active_org_id must be written to the response cookie
    const cookie = res.cookies.get('active_org_id');
    expect(cookie?.value).toBe('org-1');
  });

  it('falls back to first org when active_org_id does not match any membership', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockFrom.mockReturnValue(membershipChain([{ org_id: 'org-1', role: 'operator' }]));

    const req = makeRequest('/dashboard', { active_org_id: 'org-999' });
    const res = await middleware(req);
    expect(getInjectedHeader(res, 'x-org-id')).toBe('org-1');
    const cookie = res.cookies.get('active_org_id');
    expect(cookie?.value).toBe('org-1');
  });

  it('does not write active_org_id cookie when cookie already matches a membership', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockFrom.mockReturnValue(
      membershipChain([
        { org_id: 'org-1', role: 'admin' },
        { org_id: 'org-2', role: 'viewer' },
      ]),
    );

    const req = makeRequest('/dashboard', { active_org_id: 'org-1' });
    const res = await middleware(req);
    expect(getInjectedHeader(res, 'x-org-id')).toBe('org-1');
    // active_org_id cookie should NOT be set (already valid)
    const cookie = res.cookies.get('active_org_id');
    expect(cookie).toBeUndefined();
  });

  it('sets correct x-locale on authenticated route', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockFrom.mockReturnValue(membershipChain([{ org_id: 'org-1', role: 'owner' }]));

    const req = makeRequest('/dashboard', { locale: 'en', active_org_id: 'org-1' });
    const res = await middleware(req);
    expect(getInjectedHeader(res, 'x-locale')).toBe('en');
  });

  it('handles null memberships from Supabase gracefully (treats as no orgs)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    const not = vi.fn().mockResolvedValue({ data: null, error: { message: 'network error' } });
    const eq = vi.fn().mockReturnValue({ not });
    const select = vi.fn().mockReturnValue({ eq });
    mockFrom.mockReturnValue({ select });

    const req = makeRequest('/dashboard');
    const res = await middleware(req);
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get('location')!);
    expect(location.pathname).toBe('/onboarding');
  });

  it('excludes soft-deleted org memberships and redirects to onboarding', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockFrom.mockReturnValue(
      membershipChain([
        { org_id: 'org-deleted', role: 'owner', organizations: { deleted_at: '2025-01-01T00:00:00Z' } },
      ]),
    );

    const req = makeRequest('/dashboard');
    const res = await middleware(req);
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get('location')!);
    expect(location.pathname).toBe('/onboarding');
  });

  it('excludes soft-deleted orgs but keeps active non-deleted org', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockFrom.mockReturnValue(
      membershipChain([
        { org_id: 'org-deleted', role: 'owner', organizations: { deleted_at: '2025-01-01T00:00:00Z' } },
        { org_id: 'org-active', role: 'admin', organizations: { deleted_at: null } },
      ]),
    );

    const req = makeRequest('/dashboard');
    const res = await middleware(req);
    expect(res.status).toBe(200);
    expect(getInjectedHeader(res, 'x-org-id')).toBe('org-active');
    expect(getInjectedHeader(res, 'x-member-role')).toBe('admin');
  });
});
