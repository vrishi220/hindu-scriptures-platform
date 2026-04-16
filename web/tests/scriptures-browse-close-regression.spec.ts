import { expect, test } from '@playwright/test';

const mockScripturesApis = async (page: import('@playwright/test').Page) => {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const path = url.pathname;

    if (path === '/api/me') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 11,
          email: 'viewer@example.com',
          role: 'viewer',
          permissions: { can_view: true, can_admin: false, can_contribute: false },
        }),
      });
      return;
    }

    if (path === '/api/preferences') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          source_language: 'english',
          transliteration_enabled: true,
          transliteration_script: 'iast',
          preview_translation_languages: 'english',
          preview_hidden_levels: '',
        }),
      });
      return;
    }

    if (path === '/api/cart/me') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [] }),
      });
      return;
    }

    if (path === '/api/metadata/categories') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
      return;
    }

    if (path === '/api/books' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { id: 1, book_name: 'Rigveda', book_code: 'rigveda', schema_id: 7, visibility: 'public' },
        ]),
      });
      return;
    }

    if (path === '/api/books/1' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 1,
          book_name: 'Rigveda',
          book_code: 'rigveda',
          schema: { id: 7, levels: ['Book', 'Part', 'Section', 'Entry'] },
          visibility: 'public',
          metadata_json: {},
        }),
      });
      return;
    }

    if (path === '/api/books/1/tree' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 101,
            parent_node_id: null,
            level_name: 'Book',
            sequence_number: '1',
            title_english: 'Mandala 1',
            has_content: false,
            children: [],
          },
        ]),
      });
      return;
    }

    await route.continue();
  });
};

test('closing browse modal returns to base scriptures page (no implicit preview)', async ({ page }) => {
  await mockScripturesApis(page);

  await page.goto('/scriptures?book=1&browse=1');

  const browseHeading = page.getByRole('heading', { name: 'Browse Book' });
  await expect(browseHeading).toBeVisible();

  await page.locator('button:has-text("✕")').first().click();

  await expect(browseHeading).toBeHidden();
  await expect(page).toHaveURL((url) => {
    const params = url.searchParams;
    return (
      url.pathname === '/scriptures' &&
      !params.has('browse') &&
      !params.has('preview') &&
      !params.has('book') &&
      !params.has('node')
    );
  });
});
