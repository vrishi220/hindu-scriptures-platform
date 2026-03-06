import { expect, test } from '@playwright/test';

test('admin media bank density writes persisted preference key', async ({ page }) => {
  await page.route('**/api/me', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 1,
        email: 'admin@example.com',
        role: 'admin',
        permissions: { can_admin: true },
      }),
    });
  });

  await page.route('**/api/preferences', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ admin_media_bank_browser_view: 'list' }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    });
  });

  await page.route('**/api/content/media-bank/assets?**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 101,
          media_type: 'image',
          url: 'https://cdn.example.com/mock-image.jpg',
          metadata_json: { display_name: 'Mock Image' },
        },
      ]),
    });
  });

  await page.route('**/api/content/media-bank/assets', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 102,
        media_type: 'image',
        url: 'https://cdn.example.com/uploaded-image.jpg',
        metadata_json: { display_name: 'Uploaded Image' },
      }),
    });
  });

  await page.route('**/api/content/media-bank/assets/*', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    });
  });

  await page.goto('/admin/media-bank');
  await expect(page.getByRole('button', { name: 'Open view density' })).toBeVisible();

  await page.getByRole('button', { name: 'Open view density' }).click();
  const slider = page.getByLabel('Media bank view density');
  await expect(slider).toBeVisible();
  await slider.fill('4');

  await expect
    .poll(async () =>
      page.evaluate(() => window.localStorage.getItem('admin_media_bank_browser_density'))
    )
    .toBe('4');

  await expect(page.locator('div.grid.gap-2.p-2')).toBeVisible();
});
