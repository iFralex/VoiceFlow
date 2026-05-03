import { test, expect } from '@playwright/test';

test('marketing page renders placeholder title', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'VoiceFlow' })).toBeVisible();
});
