import { expect, test } from '@playwright/test';

import { clearMailbox, waitForMagicLink } from './helpers/inbucket';
import { createTestUser, deleteTestUser, generateMagicLink } from './helpers/supabase-admin';

/**
 * E2E organisation management tests.
 *
 * Requirements:
 *   - Next.js app on http://localhost:3000
 *   - Supabase local stack (supabase start) — auth on port 54321
 *   - Inbucket mail catcher on port 54324
 *
 * Tests are grouped under `test.describe` blocks so they share a single
 * authenticated browser context set up in `beforeAll`.
 *
 * `SKIP_E2E_AUTH=true` skips the full flow tests; pass `SKIP_E2E_AUTH=false`
 * to re-enable them when the local Supabase stack is running.
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

function testEmail(label: string): string {
  return `e2e-org-${label}-${Date.now()}@example.com`;
}

/**
 * Logs in programmatically using the Supabase admin `generate_link` endpoint.
 * This bypasses the email flow to speed up test setup — the magic link is
 * obtained directly from the admin API, not from Inbucket.
 *
 * After navigation the page will land on /onboarding (new user) or /dashboard
 * (returning user with an org). The caller must handle the resulting URL.
 */
async function loginViaGeneratedLink(
  page: import('@playwright/test').Page,
  email: string,
): Promise<void> {
  const link = await generateMagicLink(email);
  await page.goto(link);
  // Wait for the auth callback to complete and the browser to be redirected
  await page.waitForURL((url) => !url.toString().includes('54321'), { timeout: 15_000 });
}

/**
 * Completes the onboarding form for a freshly-signed-up user.
 * Assumes the page is currently at /onboarding.
 */
async function completeOnboarding(
  page: import('@playwright/test').Page,
  orgName: string,
): Promise<void> {
  await page.waitForURL('**/onboarding**', { timeout: 10_000 });
  await page.getByRole('textbox', { name: /nome organizzazione/i }).fill(orgName);
  await page.getByRole('checkbox').click(); // DPA acceptance
  await page.getByRole('button', { name: /crea organizzazione/i }).click();
  await page.waitForURL('**/dashboard**', { timeout: 15_000 });
}

// ── Skip guard (requires live Supabase + Inbucket) ────────────────────────────

const SKIP = !!process.env['SKIP_E2E_AUTH'];

// ── Invite member flow via Inbucket ──────────────────────────────────────────

test.describe('Invite member via magic-link email', () => {
  test.skip(SKIP, 'Skipped: set SKIP_E2E_AUTH=false to enable');

  let ownerEmail: string;
  let ownerUserId: string;
  let memberEmail: string;

  test.beforeAll(async ({ browser }) => {
    ownerEmail = testEmail('owner');
    memberEmail = testEmail('member');

    // Create owner user and log in
    const ownerUser = await createTestUser(ownerEmail);
    ownerUserId = ownerUser.id;

    const page = await browser.newPage();
    await loginViaGeneratedLink(page, ownerEmail);
    await completeOnboarding(page, `Org ${Date.now()}`);
    await page.close();
  });

  test.afterAll(async () => {
    if (ownerUserId) await deleteTestUser(ownerUserId).catch(() => {});
    await clearMailbox(memberEmail).catch(() => {});
  });

  test('owner can invite a member and they appear in pending invites', async ({ page }) => {
    const beforeInvite = new Date();

    // Log in as owner
    await loginViaGeneratedLink(page, ownerEmail);
    await page.waitForURL('**/dashboard**', { timeout: 10_000 });

    // Navigate to members settings
    await page.goto('/settings/members');
    await page.waitForLoadState('networkidle');

    // Open invite dialog
    await page.getByRole('button', { name: /invita membro/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Fill invite form
    await page.getByRole('textbox', { name: /indirizzo email/i }).fill(memberEmail);
    // Role select defaults to "Operatore" — leave as is

    // Submit invite
    await page.getByRole('button', { name: /invia invito/i }).click();

    // Dialog should close and page should refresh
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5_000 });
    await page.waitForLoadState('networkidle');

    // The invited member should appear in the pending invites section
    const pendingSection = page.getByText(/inviti in sospeso/i).locator('..');
    await expect(pendingSection.getByText(memberEmail)).toBeVisible({ timeout: 5_000 });

    // --- Accept invite: member receives a magic link via Inbucket ---
    // Supabase sends an invite email when the user was created via admin API;
    // for the member we rely on the magic-link OTP email they receive when
    // the inviteMember service generates a user and they subsequently log in.
    //
    // The invited member clicks a magic link email to sign in for the first time.
    // Here we trigger that by requesting OTP for the member's email and
    // intercepting it from Inbucket.

    // Request magic link for invited member
    const memberPage = await page.context().newPage();
    await memberPage.goto('/login');
    await memberPage.getByRole('textbox', { name: /email/i }).fill(memberEmail);
    await memberPage.getByRole('button', { name: /invia link/i }).click();
    await memberPage.waitForURL('**/verify**');

    const memberLink = await waitForMagicLink(memberEmail, { afterDate: beforeInvite });
    await memberPage.goto(memberLink);
    // Member has a pending (unaccepted) membership → middleware sends to /onboarding
    // until an auto-accept mechanism is implemented. For now, verify they reach the
    // app shell (onboarding or dashboard depending on implementation).
    await memberPage.waitForURL((url) => {
      const p = new URL(url).pathname;
      return p.startsWith('/onboarding') || p.startsWith('/dashboard');
    }, { timeout: 15_000 });

    await memberPage.close();
  });
});

// ── Org management with programmatic setup ───────────────────────────────────

test.describe('Organisation member management (owner)', () => {
  test.skip(SKIP, 'Skipped: set SKIP_E2E_AUTH=false to enable');

  /**
   * We use a shared browser context so all tests in this block run as the same
   * authenticated owner, avoiding repeated login round-trips.
   */
  let ownerPage: import('@playwright/test').Page;
  let ownerUserId: string;
  let ownerEmail: string;

  test.beforeAll(async ({ browser }) => {
    ownerEmail = testEmail('mgmt-owner');
    const ownerUser = await createTestUser(ownerEmail);
    ownerUserId = ownerUser.id;

    ownerPage = await browser.newPage();
    await loginViaGeneratedLink(ownerPage, ownerEmail);
    await completeOnboarding(ownerPage, `MgmtOrg ${Date.now()}`);
  });

  test.afterAll(async () => {
    if (ownerUserId) await deleteTestUser(ownerUserId).catch(() => {});
    await ownerPage.close().catch(() => {});
  });

  test('members page shows the owner in the active members list', async () => {
    await ownerPage.goto('/settings/members');
    await ownerPage.waitForLoadState('networkidle');

    // The "Membri attivi" section should list the owner
    await expect(ownerPage.getByText(/membri attivi/i)).toBeVisible();
    await expect(ownerPage.getByText(ownerEmail)).toBeVisible();

    // Owner badge
    await expect(ownerPage.getByText(/proprietario/i)).toBeVisible();
  });

  test('owner can open the invite member dialog', async () => {
    await ownerPage.goto('/settings/members');
    await ownerPage.waitForLoadState('networkidle');

    await ownerPage.getByRole('button', { name: /invita membro/i }).click();

    const dialog = ownerPage.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Email and role fields must be present
    await expect(dialog.getByRole('textbox', { name: /indirizzo email/i })).toBeVisible();
    await expect(dialog.getByRole('combobox')).toBeVisible();

    // Cancel
    await ownerPage.getByRole('button', { name: /annulla/i }).click();
    await expect(dialog).not.toBeVisible();
  });

  test('invite dialog shows validation error for invalid email', async () => {
    await ownerPage.goto('/settings/members');
    await ownerPage.waitForLoadState('networkidle');

    await ownerPage.getByRole('button', { name: /invita membro/i }).click();
    const dialog = ownerPage.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.getByRole('textbox', { name: /indirizzo email/i }).fill('not-an-email');
    await dialog.getByRole('button', { name: /invia invito/i }).click();

    // Client-side validation should fire
    await expect(dialog.getByText(/email valido/i)).toBeVisible();

    await ownerPage.getByRole('button', { name: /annulla/i }).click();
  });

  test('owner can invite a new member', async () => {
    const inviteeEmail = testEmail('invitee-mgmt');

    await ownerPage.goto('/settings/members');
    await ownerPage.waitForLoadState('networkidle');

    await ownerPage.getByRole('button', { name: /invita membro/i }).click();
    const dialog = ownerPage.getByRole('dialog');

    await dialog.getByRole('textbox', { name: /indirizzo email/i }).fill(inviteeEmail);
    await dialog.getByRole('button', { name: /invia invito/i }).click();

    await expect(dialog).not.toBeVisible({ timeout: 5_000 });

    // Refresh the page to see updated state
    await ownerPage.reload();
    await ownerPage.waitForLoadState('networkidle');

    // The invitee should appear in pending invites
    await expect(ownerPage.getByText(inviteeEmail)).toBeVisible({ timeout: 5_000 });
  });
});

// ── Org switcher ──────────────────────────────────────────────────────────────

test.describe('Org switcher', () => {
  test.skip(SKIP, 'Skipped: set SKIP_E2E_AUTH=false to enable');

  let userEmail: string;
  let userId: string;
  let userPage: import('@playwright/test').Page;

  test.beforeAll(async ({ browser }) => {
    userEmail = testEmail('switcher');
    const user = await createTestUser(userEmail);
    userId = user.id;

    userPage = await browser.newPage();
    await loginViaGeneratedLink(userPage, userEmail);
    await completeOnboarding(userPage, `SwitcherOrg ${Date.now()}`);
  });

  test.afterAll(async () => {
    if (userId) await deleteTestUser(userId).catch(() => {});
    await userPage.close().catch(() => {});
  });

  test('org switcher button is visible in the sidebar', async () => {
    await userPage.goto('/dashboard');
    await userPage.waitForLoadState('networkidle');

    // The OrgSwitcher renders a button with aria-label "Cambia organizzazione"
    const switcher = userPage.getByRole('button', { name: /cambia organizzazione/i });
    await expect(switcher).toBeVisible();
  });

  test('org switcher popover opens and shows the active org', async () => {
    await userPage.goto('/dashboard');
    await userPage.waitForLoadState('networkidle');

    // Open org switcher
    const switcher = userPage.getByRole('button', { name: /cambia organizzazione/i });
    await switcher.click();

    // Popover content
    const popover = userPage.getByTestId('org-switcher-content');
    await expect(popover).toBeVisible();

    // "Crea nuova organizzazione" link should always be present
    await expect(popover.getByText(/crea nuova organizzazione/i)).toBeVisible();
  });
});

// ── Auth: unauthenticated redirects ──────────────────────────────────────────

test.describe('Unauthenticated access', () => {
  test('GET /dashboard redirects to /login', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/dashboard');
    await page.waitForURL('**/login**');
    await expect(page.getByRole('button', { name: /invia link/i })).toBeVisible();
  });

  test('GET /settings/members redirects to /login', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/settings/members');
    await page.waitForURL('**/login**');
  });

  test('GET /onboarding redirects to /login when no session exists', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/onboarding');
    await page.waitForURL('**/login**');
  });
});
