import { test, expect } from '@playwright/test';

test('marketing landing page loads', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('landing-hero')).toBeVisible();
});
