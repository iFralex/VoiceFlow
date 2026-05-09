import { expect, test } from '@playwright/test';

/**
 * E2E recording-player tests.
 *
 * The recording player lives on `/calls/[id]` and depends on a real call row
 * with stored recording_path + transcript_path so that the page can render a
 * signed audio URL and a transcript JSON. Because uploading those artifacts
 * requires a fully running stack (Vapi webhook → storage → DB), this suite is
 * opt-in: set E2E_RECORDING_CALL_ID to the id of a seeded call to enable.
 *
 * Without the env var the suite still runs a 404 smoke test against the call
 * detail route to confirm authentication routing wires through.
 *
 * Skip with SKIP_E2E_RECORDING=true (or SKIP_E2E_AUTH=true).
 */

const SKIP = !!process.env['SKIP_E2E_RECORDING'] || !!process.env['SKIP_E2E_AUTH'];
const SEEDED_CALL_ID = process.env['E2E_RECORDING_CALL_ID'] ?? null;

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Recording player — call detail route', () => {
  test.skip(SKIP, 'Skipped: set SKIP_E2E_RECORDING=false and SKIP_E2E_AUTH=false to enable');

  test('unauthenticated request to /calls/:id redirects to /login', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/calls/00000000-0000-0000-0000-000000000000');
    await page.waitForURL('**/login**', { timeout: 10_000 });
    await expect(page.getByRole('button', { name: /invia link/i })).toBeVisible();
  });
});

test.describe('Recording player — seeded call interactions', () => {
  test.skip(
    SKIP || !SEEDED_CALL_ID,
    'Requires E2E_RECORDING_CALL_ID pointing at a seeded call with recording + transcript',
  );

  // The seeded user must already be authenticated for this URL to render.
  // Because the call belongs to a specific org, we rely on the loop runner
  // having pre-authenticated a browser context (storageState) or having set
  // E2E_RECORDING_LOGIN_COOKIE; otherwise the request will redirect to /login
  // and the test will fail loudly.
  test('plays, pauses, seeks, and seeks-by-transcript-click', async ({ page }) => {
    const id = SEEDED_CALL_ID!;
    await page.goto(`/calls/${id}`);
    await page.waitForLoadState('networkidle');

    // Sanity: we landed on the detail page (not /login).
    expect(page.url()).toContain(`/calls/${id}`);

    // The "Registrazione" tab is the default; assert the player mounted.
    const player = page.locator('[data-slot="recording-player"]');
    await expect(player).toBeVisible({ timeout: 15_000 });

    const audio = page.locator('audio').first();
    await expect(audio).toHaveCount(1);

    // ── Play ──────────────────────────────────────────────────────────────
    const playBtn = page.getByRole('button', { name: /^riproduci$/i });
    await playBtn.click();
    // After the click the icon button switches its aria-label to "Pausa".
    await expect(page.getByRole('button', { name: /^pausa$/i })).toBeVisible({
      timeout: 5_000,
    });

    // The audio element should report not-paused.
    const playing = await audio.evaluate(
      (el) => !(el as HTMLAudioElement).paused,
    );
    expect(playing).toBe(true);

    // ── Pause ─────────────────────────────────────────────────────────────
    await page.getByRole('button', { name: /^pausa$/i }).click();
    await expect(page.getByRole('button', { name: /^riproduci$/i })).toBeVisible({
      timeout: 5_000,
    });
    const paused = await audio.evaluate(
      (el) => (el as HTMLAudioElement).paused,
    );
    expect(paused).toBe(true);

    // ── Seek via the "Avanti di 15 secondi" button ───────────────────────
    const seekDisplay = page.locator('[data-slot="recording-time"]');
    const before = (await seekDisplay.textContent()) ?? '';
    await page.getByRole('button', { name: /avanti di 15 secondi/i }).click();
    await expect(async () => {
      const after = (await seekDisplay.textContent()) ?? '';
      expect(after).not.toBe(before);
    }).toPass({ timeout: 5_000 });

    // ── Click a transcript segment to seek to its start ───────────────────
    // The transcript renders inside an <ol> with role-button list items.
    const segments = page.locator('ol > li[role="button"]');
    const segmentCount = await segments.count();
    expect(segmentCount).toBeGreaterThan(0);

    if (segmentCount > 1) {
      // Click the second segment to force a non-zero seek even if the
      // first segment starts at 0ms (which is the typical pattern).
      const target = segments.nth(1);
      await target.click();

      // The clicked segment should be marked aria-current="true".
      await expect(target).toHaveAttribute('aria-current', 'true', { timeout: 5_000 });

      // currentTime should reflect the segment's start (extracted from the
      // formatted time label inside the segment, e.g. "0:02").
      const label = (await target.locator('span.tabular-nums').textContent()) ?? '0:00';
      const [m, s] = label.split(':').map((n) => Number.parseInt(n, 10));
      const expectedStart = (m ?? 0) * 60 + (s ?? 0);
      const currentTime = await audio.evaluate(
        (el) => (el as HTMLAudioElement).currentTime,
      );
      // Allow a 1.5s tolerance for browser-specific seek rounding.
      expect(Math.abs(currentTime - expectedStart)).toBeLessThanOrEqual(1.5);
    }
  });
});
