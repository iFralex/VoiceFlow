/**
 * Supabase Admin API helpers for E2E test setup.
 *
 * These helpers call the Supabase local auth admin endpoints directly (without
 * the SDK) so that tests can:
 *   - Create test users without going through the email flow
 *   - Generate magic links programmatically to speed up test setup
 *   - Accept pending membership invites directly (not yet exposed in app UI)
 *
 * All functions require SUPABASE_SERVICE_ROLE_KEY (available from
 * `supabase status` when running local development).
 */

const SUPABASE_URL = process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? 'http://localhost:54321';
const SERVICE_ROLE_KEY =
  process.env['SUPABASE_SERVICE_ROLE_KEY'] ??
  // Well-known Supabase local dev service-role JWT — safe to include here
  // because it only works against a locally running Supabase instance.
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hj04zWl196z2-SBc0';

const ADMIN_HEADERS = {
  'Content-Type': 'application/json',
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
};

interface SupabaseUser {
  id: string;
  email: string;
  created_at: string;
}

interface GenerateLinkResponse {
  action_link: string;
  email_otp: string;
  hashed_token: string;
  redirect_to: string;
  verification_type: string;
}

/**
 * Creates a new Supabase auth user with the given email.
 * Uses `email_confirm: true` so the user can log in immediately without
 * going through an email confirmation step.
 */
export async function createTestUser(email: string): Promise<SupabaseUser> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: ADMIN_HEADERS,
    body: JSON.stringify({ email, email_confirm: true }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`createTestUser failed (${res.status}): ${body}`);
  }

  const data = (await res.json()) as SupabaseUser;
  return data;
}

/**
 * Deletes a Supabase auth user by id.
 * Call this in afterAll / afterEach to clean up test users.
 */
export async function deleteTestUser(userId: string): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: ADMIN_HEADERS,
  });

  if (!res.ok && res.status !== 404) {
    const body = await res.text();
    throw new Error(`deleteTestUser failed (${res.status}): ${body}`);
  }
}

/**
 * Generates a magic link for the given email without sending an email.
 * Returns the `action_link` which can be navigated to directly in a
 * Playwright page to establish a Supabase session.
 *
 * The link points to the Supabase auth server which then redirects to
 * `redirectTo` (defaults to the app's auth callback URL).
 */
export async function generateMagicLink(
  email: string,
  {
    redirectTo = 'http://localhost:3000/auth/callback',
  }: { redirectTo?: string } = {},
): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: ADMIN_HEADERS,
    body: JSON.stringify({ type: 'magiclink', email, options: { redirectTo } }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`generateMagicLink failed (${res.status}): ${body}`);
  }

  const data = (await res.json()) as GenerateLinkResponse;
  return data.action_link;
}
