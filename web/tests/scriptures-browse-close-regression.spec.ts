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
            children: [
              {
                id: 102,
                parent_node_id: 101,
                level_name: 'Part',
                sequence_number: '1',
                title_english: 'Anuvaka 1',
                has_content: false,
                children: [],
              },
            ],
          },
        ]),
      });
      return;
    }

    if (path === '/api/content/nodes/101' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 101,
          level_name: 'Book',
          level_order: 1,
          sequence_number: '1',
          title_english: 'Mandala 1',
          has_content: false,
          content_data: null,
          tags: [],
        }),
      });
      return;
    }

    if (path === '/api/books/1/preview/render' && method === 'POST') {
      const body = JSON.parse(request.postData() || '{}') as { node_id?: number };
      const isNodePreview = typeof body.node_id === 'number';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          isNodePreview
            ? {
                book_id: 1,
                book_name: 'Rigveda',
                preview_scope: 'node',
                root_node_id: 101,
                root_title: 'Mandala 1',
                reader_hierarchy_path: '1',
                section_order: ['body'],
                sections: {
                  body: [
                    {
                      section: 'body',
                      order: 1,
                      template_key: 'default',
                      source_node_id: 101,
                      title: 'Mandala 1',
                      content: {
                        level_name: 'Book',
                        sequence_number: '1',
                        rendered_lines: [
                          {
                            field: 'english',
                            label: 'English',
                            value: 'Mandala preview content',
                          },
                        ],
                      },
                    },
                  ],
                },
                render_settings: {
                  show_sanskrit: false,
                  show_transliteration: false,
                  show_english: true,
                  show_metadata: false,
                  show_media: false,
                  text_order: ['english'],
                },
                warnings: [],
                offset: 0,
                limit: 5000,
                total_blocks: 1,
                has_more: false,
              }
            : {
                book_id: 1,
                book_name: 'Rigveda',
                preview_scope: 'book',
                root_node_id: null,
                root_title: null,
                reader_hierarchy_path: null,
                section_order: ['body'],
                sections: {
                  body: [
                    {
                      section: 'body',
                      order: 1,
                      template_key: 'default',
                      source_node_id: null,
                      title: 'Rigveda',
                      content: {
                        level_name: null,
                        sequence_number: null,
                        rendered_lines: [
                          {
                            field: 'english',
                            label: 'English',
                            value: 'Full book preview content',
                          },
                        ],
                      },
                    },
                  ],
                },
                render_settings: {
                  show_sanskrit: false,
                  show_transliteration: false,
                  show_english: true,
                  show_metadata: false,
                  show_media: false,
                  text_order: ['english'],
                },
                warnings: [],
                offset: 0,
                limit: 50,
                total_blocks: 1,
                has_more: false,
              }
        ),
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

  await page.getByRole('button', { name: 'Close browse' }).click();

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

test('closing node preview opened from browse does not reopen full book preview', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('Mobile'), 'Tree selection controls differ on mobile layout.');
  await mockScripturesApis(page);

  await page.goto('/scriptures?book=1&browse=1');

  const browseHeading = page.getByRole('heading', { name: 'Browse Book' });
  await expect(browseHeading).toBeVisible();

  await page.locator('#tree-node-101').click();
  await expect(page.getByRole('button', { name: 'Node actions' })).toBeVisible();

  await page.getByRole('button', { name: 'Node actions' }).click();
  await page.getByRole('button', { name: /Preview/i }).first().click();

  const readerHeading = page.getByRole('heading', { name: 'Reader View (1)' });
  await expect(readerHeading).toBeVisible();

  await page.getByRole('button', { name: 'Close preview' }).click();

  await expect(readerHeading).toBeHidden();
  await expect(browseHeading).toBeVisible();
  await expect(page).toHaveURL(/\/scriptures\?.*book=1.*browse=1/);
  await expect(page).not.toHaveURL(/preview=book/);
  await expect(page.getByRole('heading', { name: 'Book Preview' })).toHaveCount(0);
});
