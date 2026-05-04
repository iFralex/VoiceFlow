import { expect, test } from '@playwright/test';

import { createTestUser, deleteTestUser, generateMagicLink } from './helpers/supabase-admin';

/**
 * E2E scripts flow tests.
 *
 * Requirements (all must be running):
 *   - Next.js app on http://localhost:3000
 *   - Supabase local stack (supabase start) — auth on port 54321
 *
 * Skip with SKIP_E2E_SCRIPTS=true (or SKIP_E2E_AUTH=true) when the full
 * stack is not available.
 */

const SKIP = !!process.env['SKIP_E2E_SCRIPTS'] || !!process.env['SKIP_E2E_AUTH'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function testEmail(label: string): string {
  return `e2e-scripts-${label}-${Date.now()}@example.com`;
}

async function loginViaGeneratedLink(
  page: import('@playwright/test').Page,
  email: string,
): Promise<void> {
  const link = await generateMagicLink(email);
  await page.goto(link);
  // Wait until we leave the Supabase auth server (port 54321)
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

test.describe('Scripts flow', () => {
  test.skip(SKIP, 'Skipped: set SKIP_E2E_SCRIPTS=false and SKIP_E2E_AUTH=false to enable');

  let userId: string;
  let userEmail: string;

  test.beforeAll(async () => {
    userEmail = testEmail('crud');
    const user = await createTestUser(userEmail);
    userId = user.id;
  });

  test.afterAll(async () => {
    await deleteTestUser(userId).catch(() => {
      // Ignore cleanup failures — test isolation is still maintained
    });
  });

  test(
    'create script from lead-reactivation template → save → edit variable → validate required',
    async ({ page }) => {
      // ── 1. Authenticate ──────────────────────────────────────────────────
      await loginViaGeneratedLink(page, userEmail);
      if (page.url().includes('onboarding')) {
        await completeOnboarding(page, `Scripts E2E Org ${Date.now()}`);
      }

      // ── 2. Navigate to /scripts ──────────────────────────────────────────
      await page.goto('/scripts');
      await page.waitForLoadState('networkidle');
      await expect(page.getByRole('heading', { name: /script/i }).first()).toBeVisible();

      // Verify template cards are visible (5 templates)
      await expect(page.getByText(/template disponibili/i)).toBeVisible();
      await expect(page.getByText('Riattivazione Lead')).toBeVisible();

      // ── 3. Click "Crea da questo template" on lead-reactivation ──────────
      // The lead-reactivation card has a link to /scripts/new?template=lead-reactivation
      const leadReactivationCard = page
        .locator('[href="/scripts/new?template=lead-reactivation"]')
        .first();
      await expect(leadReactivationCard).toBeVisible();
      await leadReactivationCard.click();

      // ── 4. Now on the wizard, step 2 (variables) is pre-selected ─────────
      await page.waitForURL('**/scripts/new**', { timeout: 10_000 });
      await page.waitForLoadState('networkidle');

      // Should be on the variables step (step 2) because template= query param is set
      await expect(page.getByRole('heading', { name: /nuovo script/i })).toBeVisible();

      // ── 5. Fill in the script name ───────────────────────────────────────
      await page.getByLabel(/nome script/i).fill('Test Script E2E');

      // ── 6. Fill required variable fields ─────────────────────────────────
      // dealership_name
      await page.getByLabel(/dealership_name/i).fill('Concessionaria Test');

      // brand
      await page.getByLabel(/brand/i).fill('Volkswagen');

      // salesperson_first_name
      await page.getByLabel(/salesperson_first_name/i).fill('Marco');

      // available_slots (array field — first slot input)
      const slotsInput = page.locator('input[placeholder*="GG/MM"]').first();
      await slotsInput.fill('15/06 10:00');

      // lead_origin_context
      await page.getByLabel(/lead_origin_context/i).fill('Richiesta info online Golf GTI');

      // ── 7. Verify live preview updates ───────────────────────────────────
      // The preview pane should now show the filled-in values
      const previewPane = page.locator('pre').first();
      await expect(previewPane).toContainText('Concessionaria Test', { timeout: 5_000 });

      // ── 8. Save the script ───────────────────────────────────────────────
      await page.getByRole('button', { name: /salva script/i }).click();

      // Should redirect to the detail page
      await page.waitForURL('**/scripts/**', { timeout: 15_000 });
      const detailUrl = page.url();
      expect(detailUrl).toMatch(/\/scripts\/[a-z0-9-]+$/);

      // Detail page should be visible
      await expect(page.getByRole('heading', { name: /modifica script/i })).toBeVisible();
      await expect(page.locator('input#script-name')).toHaveValue('Test Script E2E');

      // ── 9. Edit one variable and save ─────────────────────────────────────
      await page.getByLabel(/dealership_name/i).clear();
      await page.getByLabel(/dealership_name/i).fill('Concessionaria Aggiornata');

      await page.getByRole('button', { name: /salva modifiche/i }).click();

      // Success toast appears
      await expect(page.getByText(/modifiche salvate/i)).toBeVisible({ timeout: 10_000 });

      // The page should still be on the same script detail URL (no redirect on update)
      expect(page.url()).toBe(detailUrl);

      // ── 10. Attempt to save with empty dealership_name → form rejects ─────
      await page.getByLabel(/dealership_name/i).clear();

      await page.getByRole('button', { name: /salva modifiche/i }).click();

      // The client-side validation should show a required field error
      await expect(page.getByText(/campo obbligatorio/i).first()).toBeVisible({ timeout: 3_000 });

      // The URL should remain on the same detail page (no navigation)
      expect(page.url()).toBe(detailUrl);
    },
  );

  test('attempt to save new script with empty dealership_name → form rejects', async ({ page }) => {
    // ── 1. Authenticate ──────────────────────────────────────────────────
    await loginViaGeneratedLink(page, userEmail);
    if (page.url().includes('onboarding')) {
      await completeOnboarding(page, `Scripts E2E Org ${Date.now()}`);
    }

    // ── 2. Navigate directly to the new script wizard ────────────────────
    await page.goto('/scripts/new?template=lead-reactivation');
    await page.waitForLoadState('networkidle');

    // ── 3. Fill script name but leave dealership_name empty ───────────────
    await page.getByLabel(/nome script/i).fill('Script Senza Concessionaria');

    // Fill all required fields EXCEPT dealership_name
    await page.getByLabel(/brand/i).fill('BMW');
    await page.getByLabel(/salesperson_first_name/i).fill('Luca');
    await page.locator('input[placeholder*="GG/MM"]').first().fill('20/07 14:00');
    await page.getByLabel(/lead_origin_context/i).fill('Prova E2E');

    // dealership_name is left empty

    // ── 4. Attempt to save ────────────────────────────────────────────────
    await page.getByRole('button', { name: /salva script/i }).click();

    // ── 5. Validation error should appear ─────────────────────────────────
    await expect(page.getByText(/campo obbligatorio/i).first()).toBeVisible({ timeout: 3_000 });

    // Should NOT have navigated away
    await expect(page).toHaveURL(/\/scripts\/new/);
  });
});
