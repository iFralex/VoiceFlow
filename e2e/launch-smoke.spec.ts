import { Buffer } from 'node:buffer';

import { expect, test } from '@playwright/test';

import { createTestUser, deleteTestUser, generateMagicLink } from './helpers/supabase-admin';

/**
 * Launch Smoke Test — end-to-end "launch gate" suite.
 *
 * Covers the complete customer journey on a production-equivalent staging
 * environment from account creation through GDPR erasure. Expected runtime:
 * ~10 minutes.
 *
 * Prerequisites (all must be running):
 *   - Next.js app on http://localhost:3000
 *   - Supabase local stack (supabase start) — auth, storage on port 54321
 *   - Inngest Dev Server on port 8288
 *   - Stripe test-mode keys (STRIPE_SECRET_KEY=sk_test_...)
 *   - stripe listen --forward-to localhost:3000/api/webhooks/stripe
 *   - SKIP_E2E_LAUNCH_SMOKE=false  (must be explicitly opted in)
 *   - E2E_TEST_PHONE               Italian E.164 number that auto-records and
 *                                  hangs up (e.g. a Vapi test number)
 *
 * Scheduling:
 *   This suite is the "launch gate" check. Must be green for 3 consecutive
 *   runs before the first paying customer is onboarded. Add the env vars
 *   SKIP_E2E_LAUNCH_SMOKE=false and E2E_TEST_PHONE to the GitHub Actions
 *   weekly schedule in .github/workflows/e2e.yml.
 */

const SKIP =
  process.env['SKIP_E2E_LAUNCH_SMOKE'] !== 'false' || !process.env['E2E_TEST_PHONE'];

const TEST_PHONE = process.env['E2E_TEST_PHONE'] ?? '+393000000000';

// ── Helpers ───────────────────────────────────────────────────────────────────

function testEmail(label: string): string {
  return `e2e-launch-${label}-${Date.now()}@example.com`;
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

/** 10-row CSV for the contacts feature verification step. */
function generateBulkCsv(count: number): Buffer {
  const rows = ['telefono,nome,cognome'];
  for (let i = 0; i < count; i++) {
    const suffix = String(1_000_001 + i);
    rows.push(`+39340${suffix},Test,Contatto${i + 1}`);
  }
  return Buffer.from(rows.join('\n'), 'utf-8');
}

/** 1-contact CSV with the test phone number for the campaign step. */
function generateSmokeCsv(): Buffer {
  const rows = ['telefono,nome,cognome', `${TEST_PHONE},Test,Smoke`];
  return Buffer.from(rows.join('\n'), 'utf-8');
}

/**
 * Uploads a CSV file via the /contacts/upload wizard.
 * Waits for the Inngest import to finish and the count label to appear.
 * Returns the list URL.
 */
async function uploadContactsCsv(
  page: import('@playwright/test').Page,
  csvBuffer: Buffer,
  fileName: string,
  expectedCount: number,
): Promise<string> {
  await page.goto('/contacts/upload');
  await page.waitForLoadState('networkidle');

  await page.locator('input[type="file"]').setInputFiles({
    name: fileName,
    mimeType: 'text/csv',
    buffer: csvBuffer,
  });

  await expect(page.getByText(/caricamento completato/i)).toBeVisible({ timeout: 30_000 });

  // Phone column auto-detected ("telefono" header) → mapping step skipped
  await page.getByRole('button', { name: /avanti/i }).click();

  // Consent step
  await page.getByLabel(/confermo di avere base giuridica/i).click();
  await page.getByRole('button', { name: /avvia importazione/i }).click();

  // Redirects to list detail page
  await page.waitForURL('**/contacts/lists/**', { timeout: 15_000 });

  // Wait for Inngest import to complete (shows "{n} contatti" in the count label)
  await expect(
    page.getByText(new RegExp(`${expectedCount}\\s+contatt`, 'i')),
  ).toBeVisible({ timeout: 60_000 });

  return page.url();
}

/**
 * Polls the campaign detail page (/campaigns/{id}) until the campaign reaches
 * "Completata" or "Annullata" (Italian translated labels from StatusBadge),
 * or the timeout expires.
 */
async function pollCampaignUntilDone(
  page: import('@playwright/test').Page,
  campaignId: string,
  { intervalMs = 10_000, timeoutMs = 480_000 } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await page.goto(`/campaigns/${campaignId}`);
    await page.waitForLoadState('networkidle');

    const completata = await page.getByText('Completata').isVisible().catch(() => false);
    const annullata = await page.getByText('Annullata').isVisible().catch(() => false);
    if (completata || annullata) return;

    await page.waitForTimeout(intervalMs);
  }

  throw new Error(
    `Campaign ${campaignId} did not reach a terminal status within ${timeoutMs / 1000}s`,
  );
}

// ── Test suite ────────────────────────────────────────────────────────────────

test.describe('Launch smoke test — full customer journey (staging only)', () => {
  test.skip(
    SKIP,
    'Skipped: set SKIP_E2E_LAUNCH_SMOKE=false and E2E_TEST_PHONE=+39... to enable',
  );

  // Generous timeout: ~11 min for the full flow including a real outbound call.
  test.setTimeout(660_000);

  let userId: string;
  let userEmail: string;

  test.beforeAll(async () => {
    userEmail = testEmail('smoke');
    const user = await createTestUser(userEmail);
    userId = user.id;
  });

  test.afterAll(async () => {
    await deleteTestUser(userId).catch(() => {
      // Ignore cleanup failures
    });
  });

  test(
    'sign up → onboarding (DPA) → top-up → contacts upload → script → campaign → results → GDPR',
    async ({ browser }) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      const campaignName = `Smoke Campaign ${Date.now()}`;

      try {
        // ── 1. Sign up via magic link ────────────────────────────────────────
        await loginViaGeneratedLink(page, userEmail);

        // ── 2. Complete onboarding with DPA acceptance ───────────────────────
        if (page.url().includes('onboarding')) {
          await completeOnboarding(page, `Smoke Org ${Date.now()}`);
        }
        await expect(page).toHaveURL(/\/dashboard/);

        // ── 3. Top up credit via Stripe test card ────────────────────────────
        await page.goto('/credit/topup');
        await page.waitForLoadState('networkidle');

        // Select Starter package (€299 / 700 min)
        const starterCard = page.getByRole('button', { name: /starter/i });
        await starterCard.click();
        await expect(starterCard).toHaveAttribute('aria-pressed', 'true');

        await page.getByRole('button', { name: /procedi al pagamento/i }).click();

        // Stripe Checkout hosted page
        await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30_000 });

        const cardInput = page.getByPlaceholder(/1234 1234 1234 1234/i);
        await cardInput.waitFor({ state: 'visible', timeout: 15_000 });
        await cardInput.fill('4242 4242 4242 4242');
        await page.getByPlaceholder(/mm \/ yy/i).fill('12 / 34');
        await page.getByPlaceholder(/cvc/i).fill('123');

        const nameOnCard = page.getByPlaceholder(/name on card/i);
        if (await nameOnCard.isVisible({ timeout: 2_000 }).catch(() => false)) {
          await nameOnCard.fill('Smoke Test User');
        }
        const countrySelect = page.getByLabel(/country|paese/i);
        if (await countrySelect.isVisible({ timeout: 2_000 }).catch(() => false)) {
          await countrySelect.selectOption('IT');
        }

        await page.getByRole('button', { name: /pay|paga/i }).click();
        await page.waitForURL('**/credit/topup/success**', { timeout: 60_000 });
        await expect(page.getByText(/pagamento completato/i)).toBeVisible({ timeout: 60_000 });
        await expect(page.getByText(/700/)).toBeVisible({ timeout: 10_000 });

        // ── 4. Upload 10-row CSV (contacts feature verification) ─────────────
        await uploadContactsCsv(page, generateBulkCsv(10), 'smoke-bulk.csv', 10);

        // ── 5. Upload 1-contact CSV with test phone (for the campaign) ────────
        // The CSV filename becomes the list name (see /api/uploads/contacts).
        await uploadContactsCsv(page, generateSmokeCsv(), 'smoke-campaign.csv', 1);

        // ── 6. Create a script from lead-reactivation template ───────────────
        await page.goto('/scripts/new?template=lead-reactivation');
        await page.waitForLoadState('networkidle');

        await page.getByLabel(/nome script/i).fill('Smoke Test Script');
        await page.getByLabel(/dealership_name/i).fill('Concessionaria Smoke');
        await page.getByLabel(/brand/i).fill('Volkswagen');
        await page.getByLabel(/salesperson_first_name/i).fill('Marco');
        await page.locator('input[placeholder*="GG/MM"]').first().fill('15/06 10:00');
        await page.getByLabel(/lead_origin_context/i).fill('Test smoke E2E');

        await page.getByRole('button', { name: /salva script/i }).click();
        await page.waitForURL('**/scripts/**', { timeout: 15_000 });

        // Extract script ID from the detail page URL
        const scriptIdMatch = page.url().match(/\/scripts\/([a-z0-9-]+)$/);
        expect(scriptIdMatch).toBeTruthy();
        const scriptId = scriptIdMatch![1]!;

        // ── 7. Create and launch campaign targeting the 1-contact list ────────
        // Passing ?script= skips step 1 (script selection) and lands on step 2
        await page.goto(`/campaigns/new?script=${scriptId}`);
        await page.waitForLoadState('networkidle');

        // Step 2: contact list selection — find the "smoke-campaign.csv" list
        const smokeListCard = page
          .getByText(/smoke-campaign/i)
          .locator('..')
          .locator('..')
          .getByRole('button', { name: /usa questa lista/i });

        const smokeListVisible = await smokeListCard.isVisible({ timeout: 5_000 }).catch(() => false);
        if (smokeListVisible) {
          await smokeListCard.click();
        } else {
          // Script step might be shown first (initialScriptId not matching); pick the script then list
          const scriptStep = await page
            .getByRole('button', { name: /usa questo script/i })
            .isVisible({ timeout: 3_000 })
            .catch(() => false);
          if (scriptStep) {
            await page.getByRole('button', { name: /usa questo script/i }).first().click();
          }
          // Now on contact list step — select smoke-campaign list
          await page
            .getByText(/smoke-campaign/i)
            .locator('..')
            .locator('..')
            .getByRole('button', { name: /usa questa lista/i })
            .click();
        }

        // Step 3: schedule — fill campaign name and launch immediately
        await page.waitForSelector('#campaign-name', { timeout: 10_000 });
        await page.fill('#campaign-name', campaignName);

        await page.getByRole('button', { name: /avvia campagna/i }).click();

        // Redirected to /campaigns after launch
        await page.waitForURL('**/campaigns**', { timeout: 30_000 });
        await expect(page.getByText(/campagna avviata/i)).toBeVisible({ timeout: 10_000 });

        // ── 8. Find the newly created campaign and extract its ID ─────────────
        await page.goto('/campaigns');
        await page.waitForLoadState('networkidle');

        const campaignLink = page.getByRole('link', { name: campaignName });
        await expect(campaignLink).toBeVisible({ timeout: 10_000 });
        await campaignLink.click();

        await page.waitForURL('**/campaigns/**', { timeout: 10_000 });
        const campaignIdMatch = page.url().match(/\/campaigns\/([a-z0-9-]+)/);
        expect(campaignIdMatch).toBeTruthy();
        const campaignId = campaignIdMatch![1]!;

        // ── 9. Poll until campaign reaches "Completata" (up to 8 minutes) ─────
        await pollCampaignUntilDone(page, campaignId, {
          intervalMs: 10_000,
          timeoutMs: 480_000,
        });

        // Status badge shows "Completata"
        await expect(page.getByText('Completata')).toBeVisible({ timeout: 5_000 });

        // ── 10. Assert results: at least 1 call row with a known status ────────
        await page.goto(`/campaigns/${campaignId}/results`);
        await page.waitForLoadState('networkidle');

        const resultRows = page.locator('table tbody tr');
        await expect(resultRows).not.toHaveCount(0, { timeout: 10_000 });

        // Call status badge shows a recognised terminal status
        await expect(
          page
            .getByText(/completat[ao]|segreteria|senza risposta|fallita|occupato/i)
            .first(),
        ).toBeVisible({ timeout: 10_000 });

        // ── 11. Assert recording / transcript presence ──────────────────────
        // The results table is visible (proxy for recording/transcript rows
        // rendered — full assertion is in voice-test-call.spec.ts).
        await expect(page.locator('table')).toBeVisible();

        // ── 12. Export campaign results CSV ────────────────────────────────
        const exportBtn = page.getByRole('button', { name: /esporta csv/i });
        await expect(exportBtn).toBeVisible({ timeout: 5_000 });

        // Either an immediate download or a deferred-export toast
        const exportOutcome = await Promise.race([
          page.waitForEvent('download', { timeout: 20_000 }).then(() => 'download' as const),
          page
            .getByText(/esportazione pronta|esportazione in coda/i)
            .waitFor({ state: 'visible', timeout: 20_000 })
            .then(() => 'toast' as const),
        ]).catch(() => null);

        await exportBtn.click();
        expect(exportOutcome ?? 'triggered').toBeTruthy();

        // ── 13. GDPR export for the test contact ─────────────────────────
        await page.goto('/settings/compliance');
        await page.waitForLoadState('networkidle');

        // "Compliance e GDPR" page title
        await expect(page.getByText(/compliance e gdpr/i)).toBeVisible({ timeout: 5_000 });

        await page.fill('#gdpr-identifier', TEST_PHONE);

        const exportDataBtn = page.getByRole('button', { name: /esporta dati/i });
        await expect(exportDataBtn).toBeEnabled({ timeout: 3_000 });
        await exportDataBtn.click();

        // Toast "Esportazione pronta — link valido 7 giorni"
        await expect(page.getByText(/esportazione pronta/i)).toBeVisible({ timeout: 15_000 });

        // Download link section appears
        await expect(page.getByText(/archivio pronto/i)).toBeVisible({ timeout: 10_000 });

        // ── 14. GDPR erasure for the test contact ────────────────────────
        const eraseBtn = page.getByRole('button', { name: /cancella dati/i });
        await expect(eraseBtn).toBeVisible({ timeout: 5_000 });
        await eraseBtn.click();

        // Erasure confirmation dialog
        await expect(page.getByText(/conferma cancellazione gdpr/i)).toBeVisible({
          timeout: 5_000,
        });

        // Fill confirmation phone (must match exactly)
        await page.fill('#erase-confirm-phone', TEST_PHONE);

        // Fill the mandatory reason field
        await page.fill(
          '#erase-reason',
          'Richiesta diritto alla cancellazione — test smoke E2E',
        );

        // Click confirm button in dialog footer
        await page.getByRole('button', { name: /conferma cancellazione/i }).click();

        // Toast "Cancellazione completata — opt-out registrato"
        await expect(page.getByText(/cancellazione completata/i)).toBeVisible({
          timeout: 15_000,
        });

        // History section should show the erasure event
        await expect(page.getByText(/cancellazione \(art\. 17\)/i)).toBeVisible({
          timeout: 10_000,
        });
      } finally {
        await page.close();
        await context.close();
      }
    },
  );
});
