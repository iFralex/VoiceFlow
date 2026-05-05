import { expect, test } from '@playwright/test';

import { createTestUser, deleteTestUser, generateMagicLink } from './helpers/supabase-admin';

/**
 * E2E voice test-call flow — staging only.
 *
 * This test places a real outbound call via the Vapi voice adapter and asserts
 * the full lifecycle: dispatch → call completed → recording and transcript
 * persisted → outcome classified.
 *
 * Requirements:
 *   - App running (staging or local with real Vapi credentials)
 *   - SKIP_E2E_VOICE=false  (must be explicitly opted in)
 *   - E2E_TEST_PHONE        Italian E.164 number that auto-records + auto-hangs-up
 *                           (a Vapi test number, e.g. +393000000000)
 *
 * Skipped in CI by default. The external E2E loop will not run this file
 * unless SKIP_E2E_VOICE is explicitly set to 'false'.
 */

const SKIP =
  process.env['SKIP_E2E_VOICE'] !== 'false' || !process.env['E2E_TEST_PHONE'];

const TEST_PHONE = process.env['E2E_TEST_PHONE'] ?? '+393000000000';

/** Call statuses that indicate the call lifecycle has ended. */
const TERMINAL_STATUSES = ['completed', 'failed', 'no_answer', 'voicemail', 'busy'];

/** All valid call outcome values (mirrors the DB enum). */
const VALID_OUTCOMES = [
  'interested',
  'not_interested',
  'appointment_booked',
  'wrong_number',
  'callback_requested',
  'voicemail_left',
  'voicemail_no_message',
  'do_not_call',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function testEmail(label: string): string {
  return `e2e-voice-${label}-${Date.now()}@example.com`;
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

/**
 * Polls GET /api/internal/calls/:id until the call reaches a terminal status
 * or the timeout expires. Returns the final call JSON.
 */
async function pollCallUntilTerminal(
  page: import('@playwright/test').Page,
  callId: string,
  { intervalMs = 5_000, timeoutMs = 300_000 } = {},
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  let last: Record<string, unknown> = {};

  while (Date.now() < deadline) {
    const response = await page.request.get(`/api/internal/calls/${callId}`);
    if (response.ok()) {
      const data = (await response.json()) as Record<string, unknown>;
      last = data;
      if (TERMINAL_STATUSES.includes(data['status'] as string)) {
        return data;
      }
    }
    await page.waitForTimeout(intervalMs);
  }

  throw new Error(
    `Call ${callId} did not reach a terminal status within ${timeoutMs / 1000}s. Last status: ${last['status'] ?? 'unknown'}`,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Voice test-call end-to-end (staging only)', () => {
  test.skip(SKIP, 'Skipped: set SKIP_E2E_VOICE=false and E2E_TEST_PHONE=+39... to enable');

  // Give the test a generous timeout: call dispatch + up to 5 minutes for the
  // call to complete + artifact persistence + classification.
  test.setTimeout(360_000);

  let userId: string;
  let userEmail: string;

  test.beforeAll(async () => {
    userEmail = testEmail('voice');
    const user = await createTestUser(userEmail);
    userId = user.id;
  });

  test.afterAll(async () => {
    await deleteTestUser(userId).catch(() => {
      // Ignore cleanup failures
    });
  });

  test(
    'dispatch test call → call completes → recording and transcript persisted → outcome classified',
    async ({ page }) => {
      // ── 1. Authenticate ──────────────────────────────────────────────────
      await loginViaGeneratedLink(page, userEmail);
      if (page.url().includes('onboarding')) {
        await completeOnboarding(page, `Voice E2E Org ${Date.now()}`);
      }

      // ── 2. Create a script from the lead-reactivation template ───────────
      await page.goto('/scripts');
      await page.waitForLoadState('networkidle');

      const templateLink = page
        .locator('[href="/scripts/new?template=lead-reactivation"]')
        .first();
      await expect(templateLink).toBeVisible({ timeout: 10_000 });
      await templateLink.click();

      await page.waitForURL('**/scripts/new**', { timeout: 10_000 });
      await page.waitForLoadState('networkidle');

      // Fill in required fields
      await page.getByLabel(/nome script/i).fill('Voice E2E Test Script');
      await page.getByLabel(/dealership_name/i).fill('Concessionaria E2E');
      await page.getByLabel(/brand/i).fill('Volkswagen');
      await page.getByLabel(/salesperson_first_name/i).fill('Marco');
      await page.locator('input[placeholder*="GG/MM"]').first().fill('15/06 10:00');
      await page.getByLabel(/lead_origin_context/i).fill('Test chiamata E2E');

      // Save the script
      await page.getByRole('button', { name: /salva script/i }).click();
      await page.waitForURL('**/scripts/**', { timeout: 15_000 });

      // Confirm we are on the script detail page
      await expect(page.getByRole('heading', { name: /modifica script/i })).toBeVisible({
        timeout: 10_000,
      });

      // ── 3. Open the "Chiamami ora" dialog ────────────────────────────────
      const testCallButton = page.getByRole('button', { name: /chiamami ora/i });
      await expect(testCallButton).toBeVisible({ timeout: 5_000 });
      await testCallButton.click();

      // Fill in the Italian test phone number
      await page.getByLabel(/numero di telefono/i).fill(TEST_PHONE);

      // ── 4. Submit and capture the callId from the API response ───────────
      const [apiResponse] = await Promise.all([
        page.waitForResponse((resp) => resp.url().includes('/api/internal/test-call'), {
          timeout: 30_000,
        }),
        page.getByRole('button', { name: /avvia chiamata/i }).click(),
      ]);

      expect(apiResponse.status()).toBe(200);
      const { callId } = (await apiResponse.json()) as { callId: string };
      expect(callId).toBeTruthy();

      // ── 5. Wait for success toast to confirm dispatch ────────────────────
      await expect(page.getByText(/chiamata di prova avviata/i)).toBeVisible({ timeout: 10_000 });

      // ── 6. Poll /api/internal/calls/:id until the call reaches a terminal status
      const callData = await pollCallUntilTerminal(page, callId, {
        intervalMs: 5_000,
        timeoutMs: 300_000,
      });

      // ── 7. Assert the call completed (not failed / no-answer) ────────────
      expect(callData['status']).toBe('completed');

      // ── 8. Assert recording and transcript are persisted ─────────────────
      expect(callData['recording_path']).toBeTruthy();
      expect(callData['transcript_path']).toBeTruthy();

      // ── 9. Assert outcome is a known enum value ───────────────────────────
      // Outcome is set by tool invocation or the classifier.
      // It may be null only for incomplete calls (which we assert completed above).
      expect(VALID_OUTCOMES).toContain(callData['outcome']);
    },
  );
});
