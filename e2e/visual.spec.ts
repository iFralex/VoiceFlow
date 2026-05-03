import { expect, test } from '@playwright/test';

/**
 * Visual regression baseline tests.
 *
 * These tests capture screenshots of key pages and compare them against
 * committed baselines. CI fails when visual drift exceeds the configured
 * threshold (maxDiffPixelRatio: 0.02).
 *
 * To update baselines after an intentional design change, see README.md §
 * "Updating visual regression baselines".
 */

test.describe('Visual regression — marketing landing', () => {
  test('full page screenshot', async ({ page }) => {
    await page.goto('/');
    // Wait for the page to be fully rendered
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('marketing-landing.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
    });
  });

  test('hero section', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const hero = page.getByTestId('landing-hero');
    await expect(hero).toHaveScreenshot('marketing-hero.png', {
      maxDiffPixelRatio: 0.02,
    });
  });
});

test.describe('Visual regression — login page', () => {
  test('full page screenshot', async ({ page }) => {
    await page.goto('/accedi');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('login-page.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
    });
  });
});

test.describe('Visual regression — app shell empty state', () => {
  test('dashboard empty state', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('app-shell-dashboard.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
    });
  });
});
