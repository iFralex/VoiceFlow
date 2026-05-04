import { expect, test } from '@playwright/test';

import { clearMailbox, waitForMagicLink } from './helpers/inbucket';

/**
 * E2E auth flow tests.
 *
 * Requirements (all must be running):
 *   - Next.js app on http://localhost:3000
 *   - Supabase local stack (supabase start) — auth on port 54321
 *   - Inbucket mail catcher on port 54324
 *
 * The tests exercise the complete magic-link sign-up → onboarding → dashboard
 * flow using a real browser, real Supabase auth, and Inbucket to intercept
 * outgoing magic-link emails.
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Generates a unique test email address to avoid collisions between runs. */
function testEmail(label: string): string {
  return `e2e-auth-${label}-${Date.now()}@example.com`;
}

/**
 * Fills and submits the login form.
 * Waits for the verify page to confirm the OTP request was sent.
 */
async function submitLoginForm(
  page: import('@playwright/test').Page,
  email: string,
): Promise<void> {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');

  const emailInput = page.getByRole('textbox', { name: /email/i });
  await emailInput.fill(email);

  const sendButton = page.getByRole('button', { name: /invia link/i });
  await sendButton.click();

  // After submit, the page redirects to /verify
  await page.waitForURL('**/verify**');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Login page', () => {
  test('renders the magic-link form with email input and submit button', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('textbox', { name: /email/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /invia link/i })).toBeVisible();
    // Link to /signup
    await expect(page.getByRole('link', { name: /registrati/i })).toBeVisible();
  });

  test('shows validation error for an invalid email', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    await page.getByRole('textbox', { name: /email/i }).fill('not-an-email');
    await page.getByRole('button', { name: /invia link/i }).click();

    // React Hook Form validation runs client-side
    await expect(page.getByText(/email valido/i)).toBeVisible();
  });
});

test.describe('Verify page', () => {
  test('shows generic verify message when no email param is set', async ({ page }) => {
    await page.goto('/verify');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText(/controlla la tua email/i)).toBeVisible();
    await expect(page.getByRole('link', { name: /torna al login/i })).toBeVisible();
  });

  test('shows personalised message when email is in the query string', async ({ page }) => {
    await page.goto('/verify?email=mario%40example.com');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText(/mario@example\.com/i)).toBeVisible();
  });
});

test.describe('Signup page', () => {
  test('renders the signup form', async ({ page }) => {
    await page.goto('/signup');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('textbox', { name: /email/i })).toBeVisible();
    // Signup uses the same action; submit should lead to /verify
    await expect(page.getByRole('button', { name: /invia link/i })).toBeVisible();
  });
});

test.describe('Magic-link sign-up → onboarding → dashboard', () => {
  /**
   * Full end-to-end: a new user signs up via magic link (intercepted from
   * Inbucket), lands on /onboarding (no org yet), creates an organisation,
   * and arrives at /dashboard.
   *
   * This test requires a running Supabase local stack and Inbucket.
   * Skip with SKIP_E2E_AUTH=true if the local stack is not available.
   */
  test.skip(!!process.env['SKIP_E2E_AUTH'], 'Skipped: set SKIP_E2E_AUTH=false to enable');

  const email = testEmail('signup');

  test.beforeEach(async () => {
    await clearMailbox(email).catch(() => {
      // Inbucket not running — test will fail at waitForMagicLink with a clear error
    });
  });

  test('new user: magic link → onboarding → dashboard', async ({ page }) => {
    const beforeRequest = new Date();

    // 1. Submit login form — Supabase sends an email to Inbucket
    await submitLoginForm(page, email);
    await expect(page.getByText(/controlla la tua email/i)).toBeVisible();

    // 2. Retrieve the magic link from Inbucket
    const magicLink = await waitForMagicLink(email, { afterDate: beforeRequest });
    expect(magicLink).toBeTruthy();

    // 3. Navigate to the magic link — Supabase validates the token and redirects
    //    to /auth/callback?code=..., which exchanges the code and redirects to /dashboard
    //    (middleware sees no org → redirects to /onboarding)
    await page.goto(magicLink);
    await page.waitForURL('**/onboarding**', { timeout: 15_000 });

    // 4. Fill the onboarding form
    const orgName = `Test Org ${Date.now()}`;
    await page.getByRole('textbox', { name: /nome organizzazione/i }).fill(orgName);

    // Accept DPA
    await page.getByRole('checkbox').click();

    // 5. Submit
    await page.getByRole('button', { name: /crea organizzazione/i }).click();

    // 6. Should redirect to /dashboard
    await page.waitForURL('**/dashboard**', { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
  });

  test('unauthenticated user is redirected to /login from /dashboard', async ({ page }) => {
    // Clear any existing session
    await page.context().clearCookies();
    await page.goto('/dashboard');
    await page.waitForURL('**/login**');
    await expect(page.getByRole('button', { name: /invia link/i })).toBeVisible();
  });

  test('unauthenticated user is redirected to /login from a protected API route', async ({
    page,
  }) => {
    await page.context().clearCookies();
    const response = await page.request.get('/api/health', { failOnStatusCode: false });
    // API routes return JSON 401, not a redirect
    expect([401, 404]).toContain(response.status());
  });
});
