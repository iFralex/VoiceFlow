import { Buffer } from 'node:buffer';

import { expect, test } from '@playwright/test';

import { createTestUser, deleteTestUser, generateMagicLink } from './helpers/supabase-admin';

/**
 * E2E contacts import flow tests.
 *
 * Requirements (all must be running):
 *   - Next.js app on http://localhost:3000
 *   - Supabase local stack (supabase start) — auth + storage on port 54321
 *   - Inngest Dev Server on port 8288 with contacts/import-requested handler
 *
 * Skip with SKIP_E2E_CONTACTS=true (or SKIP_E2E_AUTH=true) when the full
 * stack is not available.
 */

const SKIP = !!process.env['SKIP_E2E_CONTACTS'] || !!process.env['SKIP_E2E_AUTH'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function testEmail(label: string): string {
  return `e2e-contacts-${label}-${Date.now()}@example.com`;
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

/**
 * Build a CSV buffer with `validCount` valid Italian mobile numbers and
 * `invalidCount` rows containing malformed phone values.
 *
 * Valid numbers use the 340-prefix (Vodafone Italy) with 7-digit suffixes,
 * giving 10-digit numbers after the +39 country code — confirmed valid by
 * the libphonenumber-js unit tests in src/lib/utils/phone.test.ts.
 */
function generateTestCsv(validCount: number, invalidCount: number): Buffer {
  const lines = ['telefono,nome,cognome'];

  // 95 valid Italian mobile numbers: +39 340 1000001 … +39 340 1000095
  for (let i = 0; i < validCount; i++) {
    const suffix = String(1_000_001 + i); // 7-digit suffix → 10-digit mobile
    lines.push(`+39340${suffix},Test,Contatto${i + 1}`);
  }

  // 5 rows with clearly malformed phone values
  const invalids = ['not-a-phone', '123', 'abc', 'XXXXX', '00000'];
  for (let i = 0; i < invalidCount; i++) {
    const bad = invalids[i % invalids.length] ?? 'BAD';
    lines.push(`${bad},Bad,Row${i + 1}`);
  }

  return Buffer.from(lines.join('\n'), 'utf-8');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Contacts CSV import', () => {
  test.skip(SKIP, 'Skipped: set SKIP_E2E_CONTACTS=false and SKIP_E2E_AUTH=false to enable');

  let userId: string;
  let userEmail: string;

  test.beforeAll(async () => {
    userEmail = testEmail('import');
    const user = await createTestUser(userEmail);
    userId = user.id;
  });

  test.afterAll(async () => {
    await deleteTestUser(userId).catch(() => {
      // Ignore cleanup failures — test isolation is still maintained
    });
  });

  test(
    'upload 100-row CSV with 5 invalid phones → 95 valid contacts → errors artifact → opt-out tab',
    async ({ page }) => {
      // ── 1. Authenticate ──────────────────────────────────────────────────
      await loginViaGeneratedLink(page, userEmail);
      if (page.url().includes('onboarding')) {
        await completeOnboarding(page, `Contacts E2E Org ${Date.now()}`);
      }

      // ── 2. Open upload wizard ────────────────────────────────────────────
      await page.goto('/contacts/upload');
      await page.waitForLoadState('networkidle');
      await expect(page.getByRole('heading', { name: /importa contatti/i })).toBeVisible();

      // ── 3. Drop the test CSV file onto the hidden file input ─────────────
      //    Playwright can interact with hidden <input type="file"> elements
      const csvBuffer = generateTestCsv(95, 5);
      await page.locator('input[type="file"]').setInputFiles({
        name: 'test-contacts.csv',
        mimeType: 'text/csv',
        buffer: csvBuffer,
      });

      // ── 4. Wait for the XHR upload to Supabase Storage to finish ─────────
      await expect(page.getByText(/caricamento completato/i)).toBeVisible({ timeout: 30_000 });

      // Phone header "telefono" is auto-detected → mapping step is skipped.
      // "Avanti" button should now be enabled.
      await page.getByRole('button', { name: /avanti/i }).click();

      // ── 5. Accept disclaimer and submit ──────────────────────────────────
      //    The compliance step uses a <Checkbox id="disclaimer">; clicking the
      //    associated <Label htmlFor="disclaimer"> is the most reliable way.
      await page.getByLabel(/confermo di avere base giuridica/i).click();
      await page.getByRole('button', { name: /avvia importazione/i }).click();

      // ── 6. Wait for redirect to the list detail page ──────────────────────
      await page.waitForURL('**/contacts/lists/**', { timeout: 15_000 });

      // ── 7. Wait for Inngest import to complete (up to 60 s in CI) ────────
      //    The list detail page polls every 3 s and updates the count label
      //    once the import pipeline finishes.
      await expect(page.getByText(/95 contatti/i)).toBeVisible({ timeout: 60_000 });

      // ── 8. Verify the contacts table is visible ───────────────────────────
      await expect(page.getByRole('table')).toBeVisible();

      // ── 9. Download the errors artifact and assert 5 invalid rows ─────────
      //    The "Scarica report errori" button appears in the completed state
      //    when total_count > valid_count (100 > 95).
      //    Clicking it calls getImportErrorsUrl (server action) then
      //    window.open(signedUrl, '_blank'), which Playwright captures as a popup.
      const popupPromise = page.waitForEvent('popup', { timeout: 10_000 });
      await page.getByRole('button', { name: /scarica report errori/i }).click();
      const popup = await popupPromise;

      // The errors artifact is stored as a plain JSON array in Supabase Storage.
      // The signed URL is publicly accessible for 1 hour (no additional auth).
      const errorsResponse = await page.request.get(popup.url());
      expect(errorsResponse.ok()).toBeTruthy();

      const errorsArray = (await errorsResponse.json()) as Array<{
        rowIndex: number;
        errors: string[];
      }>;
      // 5 rows with bad phone numbers should appear in the errors file
      expect(errorsArray).toHaveLength(5);
      expect(errorsArray[0]).toHaveProperty('rowIndex');
      expect(errorsArray[0]).toHaveProperty('errors');
      expect(errorsArray[0]!.errors.length).toBeGreaterThan(0);
      await popup.close();

      // ── 10. Mark the first contact as opt-out via the row actions menu ────
      //    Each row has a ghost button with sr-only text "Apri menu" that
      //    opens a <DropdownMenu> with "Segna come opt-out".
      const firstRowMenu = page
        .locator('table tbody tr')
        .first()
        .getByRole('button', { name: /apri menu/i });
      await firstRowMenu.click();

      await page.getByRole('menuitem', { name: /segna come opt-out/i }).click();

      // Sonner toast confirms the action
      await expect(page.getByText(/contatto segnato come opt-out/i)).toBeVisible({
        timeout: 5_000,
      });

      // ── 11. Navigate to the global opt-out tab ────────────────────────────
      await page.goto('/contacts?tab=optout');
      await page.waitForLoadState('networkidle');

      // ── 12. Verify the opted-out contact appears in the table ─────────────
      //    The opt-out tab renders a ContactsTable pre-filtered to opt_out=true.
      //    At least one row must be present (the one we just marked).
      await expect(page.getByRole('table')).toBeVisible();
      const optOutRows = page.locator('table tbody tr');
      await expect(optOutRows).not.toHaveCount(0);
    },
  );
});
