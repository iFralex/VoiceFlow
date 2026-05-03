import { expect, test } from '@playwright/test';

/**
 * Definition of Done verification suite for the design system plan.
 *
 * Covers:
 * - App shell renders correctly at desktop, tablet and mobile breakpoints
 * - Italian and English locales render navigation and marketing copy
 * - Theme switcher works (light / dark / system)
 * - Shadcn primitives render without console errors on the dashboard
 */

// ---------------------------------------------------------------------------
// Breakpoint helpers
// ---------------------------------------------------------------------------
const DESKTOP = { width: 1280, height: 800 };
const TABLET = { width: 768, height: 1024 };
const MOBILE = { width: 375, height: 812 };

// ---------------------------------------------------------------------------
// App shell — breakpoints
// ---------------------------------------------------------------------------
test.describe('App shell breakpoints', () => {
  test('desktop: sidebar visible, topbar visible', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    const sidebar = page.getByTestId('app-sidebar');
    await expect(sidebar).toBeVisible();
    const topbar = page.getByTestId('app-topbar');
    await expect(topbar).toBeVisible();
    // Hamburger hidden on desktop
    const hamburger = topbar.getByRole('button', { name: /apri menu|open menu/i });
    await expect(hamburger).not.toBeVisible();
  });

  test('tablet: sidebar visible, topbar visible', async ({ page }) => {
    await page.setViewportSize(TABLET);
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    const sidebar = page.getByTestId('app-sidebar');
    await expect(sidebar).toBeVisible();
    const topbar = page.getByTestId('app-topbar');
    await expect(topbar).toBeVisible();
  });

  test('mobile: sidebar hidden, hamburger visible', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    // Desktop sidebar is hidden on mobile (md:flex → hidden below md)
    const sidebar = page.getByTestId('app-sidebar');
    await expect(sidebar).not.toBeVisible();

    // Hamburger button is visible
    const topbar = page.getByTestId('app-topbar');
    const hamburger = topbar.getByRole('button').first();
    await expect(hamburger).toBeVisible();
  });

  test('mobile: hamburger opens drawer', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    const topbar = page.getByTestId('app-topbar');
    const hamburger = topbar.getByRole('button').first();
    await hamburger.click();

    // Sheet / drawer should open and show a nav link
    await expect(page.getByRole('link', { name: /dashboard/i }).first()).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Italian locale — nav labels and marketing copy
// ---------------------------------------------------------------------------
test.describe('Italian locale (default)', () => {
  test('navigation shows Italian labels', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    // Primary nav items should use Italian labels
    await expect(page.getByRole('link', { name: 'Campagne' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Contatti' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Credito' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Impostazioni' })).toBeVisible();
  });

  test('marketing landing shows Italian copy', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Hero title contains Italian car dealership copy
    const hero = page.getByTestId('landing-hero');
    await expect(hero).toBeVisible();
    await expect(hero.getByRole('heading')).not.toBeEmpty();

    // Sign-in CTA in marketing nav
    await expect(page.getByRole('link', { name: 'Accedi' })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// English locale (via cookie)
// ---------------------------------------------------------------------------
test.describe('English locale', () => {
  test.beforeEach(async ({ page }) => {
    // Set locale cookie before navigating
    await page.context().addCookies([
      {
        name: 'locale',
        value: 'en',
        domain: 'localhost',
        path: '/',
      },
    ]);
  });

  test('navigation shows English labels', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('link', { name: 'Campaigns' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Contacts' })).toBeVisible();
  });

  test('marketing landing shows English copy', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Marketing sign-in link should use English label (marketing_sign_in = "Sign In")
    await expect(page.getByRole('link', { name: /sign in/i })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Theme switcher
// ---------------------------------------------------------------------------
test.describe('Theme switcher', () => {
  test('page defaults to light theme', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    const html = page.locator('html');
    // next-themes sets class="light" or no class when in light mode
    // Either no class or class="light" is acceptable
    const cls = await html.getAttribute('class');
    // Should not be dark by default
    expect(cls ?? '').not.toContain('dark');
  });

  test('user menu opens and contains theme submenu trigger', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    // Open user menu via testid
    await page.getByTestId('user-menu-trigger').click();

    // Dropdown should be open with the theme submenu trigger
    await expect(page.getByTestId('user-menu-content')).toBeVisible();
    await expect(page.getByTestId('user-menu-tema-trigger')).toBeVisible();
  });

  test('theme submenu contains light, dark, system options', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    await page.getByTestId('user-menu-trigger').click();
    await expect(page.getByTestId('user-menu-content')).toBeVisible();

    // Open the theme submenu
    await page.getByTestId('user-menu-tema-trigger').click();
    await expect(page.getByTestId('user-menu-theme-light')).toBeVisible();
    await expect(page.getByTestId('user-menu-theme-dark')).toBeVisible();
    await expect(page.getByTestId('user-menu-theme-system')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Primitives — no console errors on dashboard
// ---------------------------------------------------------------------------
test('shadcn primitives: dashboard loads without console errors', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  await page.goto('/dashboard');
  await page.waitForLoadState('networkidle');

  // Filter out known benign errors (e.g., network requests that are always
  // expected to fail in a dev environment with no backend)
  const realErrors = consoleErrors.filter(
    (e) => !e.includes('net::ERR_') && !e.includes('Failed to fetch'),
  );

  expect(realErrors).toHaveLength(0);
});
