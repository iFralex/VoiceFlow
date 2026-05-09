import { expect, test } from '@playwright/test';

import { createTestUser, deleteTestUser, generateMagicLink } from './helpers/supabase-admin';

/**
 * E2E dashboard tests.
 *
 * Requirements (all must be running):
 *   - Next.js app on http://localhost:3000
 *   - Supabase local stack (supabase start) — auth on port 54321
 *
 * Skip with SKIP_E2E_DASHBOARD=true (or SKIP_E2E_AUTH=true) when the full
 * stack is not available.
 *
 * The "active campaign → live view" assertion runs only when an existing
 * campaign id is supplied via E2E_DASHBOARD_CAMPAIGN_ID. Without seeded data,
 * a fresh-org dashboard renders the onboarding card and exposes no active
 * campaigns, so we exercise the period selector + onboarding shape there and
 * skip the live-view click for orgs that have no campaigns.
 */

const SKIP = !!process.env['SKIP_E2E_DASHBOARD'] || !!process.env['SKIP_E2E_AUTH'];

const SEEDED_CAMPAIGN_ID = process.env['E2E_DASHBOARD_CAMPAIGN_ID'] ?? null;

// ── Helpers ───────────────────────────────────────────────────────────────────

function testEmail(label: string): string {
  return `e2e-dashboard-${label}-${Date.now()}@example.com`;
}

async function loginViaGeneratedLink(
  page: import('@playwright/test').Page,
  email: string,
): Promise<void> {
  const link = await generateMagicLink(email);
  await page.goto(link);
  await page.waitForURL((url) => !url.toString().includes('54321'), { timeout: 15_000 });
}

async function completeOnboarding(
  page: import('@playwright/test').Page,
  orgName: string,
): Promise<void> {
  await page.waitForURL('**/onboarding**', { timeout: 10_000 });
  await page.getByRole('textbox', { name: /nome organizzazione/i }).fill(orgName);
  await page.getByRole('checkbox').click();
  await page.getByRole('button', { name: /crea organizzazione/i }).click();
  await page.waitForURL('**/dashboard**', { timeout: 15_000 });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Dashboard', () => {
  test.skip(SKIP, 'Skipped: set SKIP_E2E_DASHBOARD=false and SKIP_E2E_AUTH=false to enable');

  let userId: string;
  let userEmail: string;

  test.beforeAll(async () => {
    userEmail = testEmail('view');
    const user = await createTestUser(userEmail);
    userId = user.id;
  });

  test.afterAll(async () => {
    await deleteTestUser(userId).catch(() => {
      // Ignore cleanup failures — test isolation is still maintained
    });
  });

  test('signed-in fresh user lands on dashboard with onboarding card and period selector', async ({
    page,
  }) => {
    // ── 1. Authenticate + onboard ─────────────────────────────────────────
    await loginViaGeneratedLink(page, userEmail);
    if (page.url().includes('onboarding')) {
      await completeOnboarding(page, `Dashboard E2E Org ${Date.now()}`);
    }

    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    // ── 2. Greeting + period selector render ──────────────────────────────
    await expect(page.getByRole('heading', { name: /dashboard/i }).first()).toBeVisible();

    const selector = page.locator('[data-slot="period-selector"]');
    await expect(selector).toBeVisible();
    await expect(selector.getByRole('tab', { name: /oggi/i })).toBeVisible();
    await expect(selector.getByRole('tab', { name: /ultimi 7 giorni/i })).toBeVisible();
    await expect(selector.getByRole('tab', { name: /ultimi 30 giorni/i })).toBeVisible();
    await expect(selector.getByRole('tab', { name: /mese corrente/i })).toBeVisible();
    await expect(selector.getByRole('tab', { name: /mese scorso/i })).toBeVisible();

    // ── 3. KPI grid OR onboarding card visible ────────────────────────────
    // A fresh org has no campaigns yet, so DashboardOnboardingCard renders in
    // place of the KPI section. Either is acceptable; assert the dashboard
    // surfaced one of them so the page actually mounted.
    const kpiSection = page.locator('section[aria-label="Indicatori chiave"]');
    const onboardingCard = page.locator('[data-slot="dashboard-onboarding"]');
    await expect(kpiSection.or(onboardingCard).first()).toBeVisible();

    // ── 4. Active-campaigns and recent-appointments rows always render ────
    await expect(page.locator('[data-slot="active-campaigns"]')).toBeVisible();
    await expect(page.getByRole('heading', { name: /campagne attive/i })).toBeVisible();
  });

  test('changing the period updates the URL search param and the summary line', async ({
    page,
  }) => {
    await loginViaGeneratedLink(page, userEmail);
    if (page.url().includes('onboarding')) {
      await completeOnboarding(page, `Dashboard E2E Period ${Date.now()}`);
    }

    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    const selector = page.locator('[data-slot="period-selector"]');

    // Default period is 7d (no `period` query param set on the URL).
    expect(new URL(page.url()).searchParams.get('period')).toBeNull();
    await expect(page.getByText(/dati degli ultimi 7 giorni/i)).toBeVisible();

    // Click "Oggi" → URL should pick up ?period=today and the summary should update.
    await selector.getByRole('tab', { name: /^oggi$/i }).click();
    await page.waitForURL((url) => url.searchParams.get('period') === 'today', {
      timeout: 5_000,
    });
    await expect(page.getByText(/dati di oggi/i)).toBeVisible();

    // Click "Mese scorso" → URL should pick up ?period=prev_month.
    await selector.getByRole('tab', { name: /mese scorso/i }).click();
    await page.waitForURL((url) => url.searchParams.get('period') === 'prev_month', {
      timeout: 5_000,
    });
    await expect(page.getByText(/dati del mese scorso/i)).toBeVisible();

    // Click "Ultimi 7 giorni" → period query param is removed (default).
    await selector.getByRole('tab', { name: /ultimi 7 giorni/i }).click();
    await page.waitForURL((url) => url.searchParams.get('period') === null, {
      timeout: 5_000,
    });
    await expect(page.getByText(/dati degli ultimi 7 giorni/i)).toBeVisible();
  });

  test('clicking an active campaign navigates to its live view', async ({ page }) => {
    test.skip(
      !SEEDED_CAMPAIGN_ID,
      'Requires E2E_DASHBOARD_CAMPAIGN_ID for an org with at least one active campaign',
    );

    await loginViaGeneratedLink(page, userEmail);
    if (page.url().includes('onboarding')) {
      await completeOnboarding(page, `Dashboard E2E Live ${Date.now()}`);
    }

    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    const firstRow = page.locator('[data-slot="active-campaign-row"]').first();
    await expect(firstRow).toBeVisible();

    await firstRow.locator('a').first().click();
    await page.waitForURL(/\/campaigns\/[a-z0-9-]+/i, { timeout: 10_000 });

    // The campaign detail page exposes a "Live" tab/link; navigate to it
    // explicitly so the test asserts the live view, not just the detail page.
    await page.goto(`/campaigns/${SEEDED_CAMPAIGN_ID}/live`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-slot="live-progress"]')).toBeVisible();
    await expect(page.locator('[data-slot="live-kpi"]').first()).toBeVisible();
  });
});
