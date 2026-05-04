import { expect, test } from '@playwright/test';

import { createTestUser, deleteTestUser, generateMagicLink } from './helpers/supabase-admin';

/**
 * E2E billing flow tests — Stripe Checkout and credit ledger reconciliation.
 *
 * Prerequisites (all must be running):
 *   - Next.js app on http://localhost:3000
 *   - Supabase local stack (supabase start)
 *   - Stripe test-mode keys: STRIPE_SECRET_KEY=sk_test_...
 *   - Stripe CLI webhook forwarder:
 *       stripe listen --forward-to localhost:3000/api/webhooks/stripe
 *
 * Skip with SKIP_E2E_BILLING=true (or SKIP_E2E_AUTH=true) when the full
 * Stripe environment is not available. The webhook endpoint smoke tests
 * run unconditionally (they require only the app server).
 */

const SKIP = !!process.env['SKIP_E2E_BILLING'] || !!process.env['SKIP_E2E_AUTH'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function testEmail(label: string): string {
  return `e2e-billing-${label}-${Date.now()}@example.com`;
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

// ── Webhook endpoint smoke test (no Stripe keys required) ─────────────────────

test.describe('Stripe webhook endpoint', () => {
  test('returns 400 for requests without a valid Stripe signature', async ({ request }) => {
    // The endpoint should reject unsigned payloads — this is always testable
    // as it only requires the app server to be running.
    const res = await request.post('/api/webhooks/stripe', {
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({
        type: 'checkout.session.completed',
        id: 'evt_test_unsigned',
        data: { object: {} },
      }),
    });
    // Webhook handler returns 400 on signature failure (not 500)
    expect(res.status()).toBe(400);
  });

  test('returns 400 for completely malformed payload', async ({ request }) => {
    const res = await request.post('/api/webhooks/stripe', {
      headers: { 'Content-Type': 'application/json' },
      data: 'not-json',
    });
    expect(res.status()).toBe(400);
  });
});

// ── Top-up page UI (requires auth, no Stripe interaction) ─────────────────────

test.describe('Credit top-up page', () => {
  test.skip(SKIP, 'Skipped: set SKIP_E2E_BILLING=false and SKIP_E2E_AUTH=false to enable');

  let userEmail: string;
  let userId: string;
  let userPage: import('@playwright/test').Page;

  test.beforeAll(async ({ browser }) => {
    userEmail = testEmail('ui');
    const user = await createTestUser(userEmail);
    userId = user.id;

    userPage = await browser.newPage();
    await loginViaGeneratedLink(userPage, userEmail);
    await completeOnboarding(userPage, `BillingUiOrg ${Date.now()}`);
  });

  test.afterAll(async () => {
    if (userId) await deleteTestUser(userId).catch(() => {});
    await userPage?.close().catch(() => {});
  });

  test('renders the four credit package cards', async () => {
    await userPage.goto('/credit/topup');
    await userPage.waitForLoadState('networkidle');

    // All four packages must be present as buttons
    await expect(userPage.getByRole('button', { name: /test/i }).first()).toBeVisible();
    await expect(userPage.getByRole('button', { name: /starter/i })).toBeVisible();
    await expect(userPage.getByRole('button', { name: /growth/i })).toBeVisible();
    await expect(userPage.getByRole('button', { name: /scale/i })).toBeVisible();

    // Prices are shown in Italian number format (e.g. "299 €" or "1.999 €")
    await expect(userPage.getByText(/299/)).toBeVisible();
    await expect(userPage.getByText(/799/)).toBeVisible();
    await expect(userPage.getByText(/1\.999|1999/)).toBeVisible();

    // Proceed button
    await expect(
      userPage.getByRole('button', { name: /procedi al pagamento/i }),
    ).toBeVisible();
  });

  test('first package is selected by default', async () => {
    await userPage.goto('/credit/topup');
    await userPage.waitForLoadState('networkidle');

    // The Test package card (first one) should start as pressed
    const testCard = userPage.getByRole('button', { name: /test/i }).first();
    await expect(testCard).toHaveAttribute('aria-pressed', 'true');
  });

  test('clicking a package card selects it', async () => {
    await userPage.goto('/credit/topup');
    await userPage.waitForLoadState('networkidle');

    // Click Starter
    const starterCard = userPage.getByRole('button', { name: /starter/i });
    await starterCard.click();
    await expect(starterCard).toHaveAttribute('aria-pressed', 'true');

    // Test card should now be deselected
    const testCard = userPage.getByRole('button', { name: /test/i }).first();
    await expect(testCard).toHaveAttribute('aria-pressed', 'false');
  });

  test('navigating with ?cancelled=1 shows cancellation toast', async () => {
    await userPage.goto('/credit/topup?cancelled=1');
    await userPage.waitForLoadState('networkidle');

    // Sonner toast for payment_cancelled
    await expect(userPage.getByText(/pagamento annullato/i)).toBeVisible({ timeout: 5_000 });
  });
});

// ── Credit ledger page (requires auth, no Stripe interaction) ──────────────────

test.describe('Credit ledger page', () => {
  test.skip(SKIP, 'Skipped: set SKIP_E2E_BILLING=false and SKIP_E2E_AUTH=false to enable');

  let userEmail: string;
  let userId: string;
  let userPage: import('@playwright/test').Page;

  test.beforeAll(async ({ browser }) => {
    userEmail = testEmail('ledger');
    const user = await createTestUser(userEmail);
    userId = user.id;

    userPage = await browser.newPage();
    await loginViaGeneratedLink(userPage, userEmail);
    await completeOnboarding(userPage, `LedgerOrg ${Date.now()}`);
  });

  test.afterAll(async () => {
    if (userId) await deleteTestUser(userId).catch(() => {});
    await userPage?.close().catch(() => {});
  });

  test('credit page shows balance card and ledger section', async () => {
    await userPage.goto('/credit');
    await userPage.waitForLoadState('networkidle');

    // Balance card — "Saldo crediti" label
    await expect(userPage.getByText(/saldo crediti/i)).toBeVisible();

    // Ledger history heading — "Storico movimenti"
    await expect(userPage.getByText(/storico movimenti/i)).toBeVisible();

    // Column headers
    await expect(userPage.getByText(/tipo/i)).toBeVisible();
    await expect(userPage.getByText(/importo/i)).toBeVisible();

    // Empty state message when no transactions exist
    await expect(userPage.getByText(/nessun movimento/i)).toBeVisible();
  });

  test('credit page has a Top-up CTA link to /credit/topup', async () => {
    await userPage.goto('/credit');
    await userPage.waitForLoadState('networkidle');

    const topupLink = userPage.getByRole('link', { name: /ricarica/i });
    await expect(topupLink).toBeVisible();
    await expect(topupLink).toHaveAttribute('href', '/credit/topup');
  });

  test('credit page shows the Export CSV button', async () => {
    await userPage.goto('/credit');
    await userPage.waitForLoadState('networkidle');

    await expect(userPage.getByRole('button', { name: /esporta csv/i })).toBeVisible();
  });

  test('credit page has entry type filter', async () => {
    await userPage.goto('/credit');
    await userPage.waitForLoadState('networkidle');

    // The type filter combobox is visible
    await expect(userPage.getByRole('combobox')).toBeVisible();
  });
});

// ── Full Stripe Checkout flow (requires Stripe test keys + CLI) ────────────────

test.describe('Billing — full Stripe Checkout flow', () => {
  test.skip(SKIP, 'Skipped: set SKIP_E2E_BILLING=false and SKIP_E2E_AUTH=false to enable');

  /**
   * End-to-end top-up flow:
   *   1. Log in and navigate to /credit/topup
   *   2. Select the Starter package (€299 / 700 min)
   *   3. Proceed → Stripe Checkout hosted page
   *   4. Fill test card 4242 4242 4242 4242 and pay
   *   5. Stripe redirects to /credit/topup/success?session_id=...
   *   6. Success page reconciles via polling / Realtime
   *   7. Assert 700 minutes in balance
   *   8. Assert ledger has a "Ricarica" entry
   *
   * Requires:
   *   - stripe listen --forward-to localhost:3000/api/webhooks/stripe
   *   - STRIPE_SECRET_KEY=sk_test_...
   *   - STRIPE_WEBHOOK_SECRET from `stripe listen` output
   */

  let userEmail: string;
  let userId: string;

  test.beforeAll(async () => {
    userEmail = testEmail('checkout');
    const user = await createTestUser(userEmail);
    userId = user.id;
  });

  test.afterAll(async () => {
    if (userId) await deleteTestUser(userId).catch(() => {});
  });

  test('Starter package: card 4242... → success page → 700 min balance', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      // Step 1: Sign in and complete onboarding
      const link = await generateMagicLink(userEmail);
      await page.goto(link);
      await completeOnboarding(page, `CheckoutOrg ${Date.now()}`);

      // Step 2: Navigate to top-up page
      await page.goto('/credit/topup');
      await page.waitForLoadState('networkidle');

      // Step 3: Select Starter package (€299)
      const starterCard = page.getByRole('button', { name: /starter/i });
      await starterCard.click();
      await expect(starterCard).toHaveAttribute('aria-pressed', 'true');

      // Step 4: Proceed to payment → redirects to Stripe Checkout
      await page.getByRole('button', { name: /procedi al pagamento/i }).click();

      // Stripe Checkout is at checkout.stripe.com
      await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30_000 });

      // Step 5: Fill Stripe Checkout card details
      // Email field (may be pre-populated from the Stripe Customer record)
      const emailInput = page.getByLabel(/email/i).first();
      if (await emailInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await emailInput.clear();
        await emailInput.fill(userEmail);
      }

      // Card number — Stripe hosted checkout uses standard placeholder inputs
      const cardNumberInput = page.getByPlaceholder(/1234 1234 1234 1234/i);
      await cardNumberInput.waitFor({ state: 'visible', timeout: 15_000 });
      await cardNumberInput.fill('4242 4242 4242 4242');

      // Expiry
      await page.getByPlaceholder(/mm \/ yy/i).fill('12 / 34');

      // CVC
      await page.getByPlaceholder(/cvc/i).fill('123');

      // Name on card (optional depending on checkout configuration)
      const nameInput = page.getByPlaceholder(/name on card/i);
      if (await nameInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await nameInput.fill('Test Billing User');
      }

      // Billing country (may appear for new customers)
      const countrySelect = page.getByLabel(/country|paese/i);
      if (await countrySelect.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await countrySelect.selectOption('IT');
      }

      // Step 6: Submit payment
      await page.getByRole('button', { name: /pay|paga/i }).click();

      // Step 7: Wait for redirect to success page
      await page.waitForURL('**/credit/topup/success**', { timeout: 60_000 });

      // Step 8: Wait for reconciliation — the success page polls every 2s
      // and resolves once the Stripe webhook fires (requires stripe listen)
      await expect(page.getByText(/pagamento completato/i)).toBeVisible({ timeout: 60_000 });

      // Step 9: Assert 700 minutes shown on success page
      await expect(page.getByText(/700/)).toBeVisible({ timeout: 10_000 });

      // Step 10: Navigate to credit ledger and verify topup entry appears
      await page.goto('/credit');
      await page.waitForLoadState('networkidle');

      // "Ricarica" entry type badge should be visible
      await expect(page.getByText(/ricarica/i).first()).toBeVisible({ timeout: 10_000 });

      // Balance shows 700 minutes
      await expect(page.getByText(/700/)).toBeVisible();
    } finally {
      await page.close();
      await context.close();
    }
  });

  /**
   * SCA test — 3D Secure card (4000 0025 0000 3155).
   *
   * Stripe test mode serves a simulated 3DS challenge. Clicking "Complete
   * authentication" in the challenge iframe approves the payment. This verifies
   * the app handles post-3DS redirects and reconciles correctly.
   *
   * If the 3DS challenge frame is not found (e.g. because the test environment
   * does not trigger SCA for this card), the test records a note and skips the
   * challenge interaction — the redirect flow is still exercised.
   */
  test('SCA card (3DS): 4000 0025 0000 3155 → complete 3DS → success page', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      // Log in as the same test user (already has an org from the previous test)
      const link = await generateMagicLink(userEmail);
      await page.goto(link);
      await page.waitForURL(
        (url) => {
          const p = new URL(url).pathname;
          return p.startsWith('/dashboard') || p.startsWith('/onboarding');
        },
        { timeout: 15_000 },
      );

      if (page.url().includes('/onboarding')) {
        await completeOnboarding(page, `SCAOrg ${Date.now()}`);
      }

      // Navigate to top-up — use the cheapest package (Test, €99) for the SCA test
      await page.goto('/credit/topup');
      await page.waitForLoadState('networkidle');

      await page.getByRole('button', { name: /^test$/i }).first().click();
      await page.getByRole('button', { name: /procedi al pagamento/i }).click();

      await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30_000 });

      // Fill the 3DS test card
      const cardNumberInput = page.getByPlaceholder(/1234 1234 1234 1234/i);
      await cardNumberInput.waitFor({ state: 'visible', timeout: 15_000 });
      await cardNumberInput.fill('4000 0025 0000 3155');
      await page.getByPlaceholder(/mm \/ yy/i).fill('12 / 34');
      await page.getByPlaceholder(/cvc/i).fill('123');

      const nameInput = page.getByPlaceholder(/name on card/i);
      if (await nameInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await nameInput.fill('Test SCA User');
      }

      await page.getByRole('button', { name: /pay|paga/i }).click();

      // 3DS challenge — Stripe test mode shows a simulated challenge in an iframe
      // The challenge frame title varies; we try common patterns.
      const challengeFrame = page.frameLocator(
        '[title*="3D Secure"], [title*="3DS"], [title*="Stripe 3D"]',
      );
      const completeBtn = challengeFrame.getByRole('button', {
        name: /complete|autori|authentication/i,
      });

      if (await completeBtn.isVisible({ timeout: 15_000 }).catch(() => false)) {
        await completeBtn.click();
      } else {
        // 3DS frame not found — environment may not trigger SCA for this card
        test
          .info()
          .annotations.push({ type: 'note', description: '3DS challenge frame not found — skipped' });
      }

      // After 3DS resolution, redirect to success page
      await page.waitForURL('**/credit/topup/success**', { timeout: 60_000 });

      // Success or pending state (webhook reconciles asynchronously)
      await expect(
        page.getByText(/pagamento completato|verifica pagamento|elaborazione/i),
      ).toBeVisible({ timeout: 30_000 });
    } finally {
      await page.close();
      await context.close();
    }
  });
});
