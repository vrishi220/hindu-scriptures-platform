import { test, expect } from '@playwright/test';

test('minimal test', async ({ page }) => {
  await page.goto('/');
  await expect(page).toBeTruthy();
});
