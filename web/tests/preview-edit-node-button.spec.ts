import { expect, test } from '@playwright/test';

const BOOK_ID = 1;
const NODE_ID = 101;
const EDITOR_USER_ID = 42;
const VIEWER_USER_ID = 11;
const BOOK_OWNER_ID = 99; // different from both users so isCurrentBookOwner = false

const mockBaseRoutes = async (
  page: import('@playwright/test').Page,
  role: 'editor' | 'viewer',
) => {
  const userId = role === 'editor' ? EDITOR_USER_ID : VIEWER_USER_ID;

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
          id: userId,
          email: `${role}@example.com`,
          role,
          permissions: {
            can_view: true,
            can_edit: role === 'editor',
            can_admin: false,
            can_contribute: role === 'editor',
          },
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
          transliteration_enabled: false,
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
          {
            id: BOOK_ID,
            book_name: 'Test Scripture',
            book_code: 'test-scripture',
            schema_id: 1,
            visibility: 'public',
            owner_id: BOOK_OWNER_ID,
          },
        ]),
      });
      return;
    }

    if (path === `/api/books/${BOOK_ID}` && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: BOOK_ID,
          book_name: 'Test Scripture',
          book_code: 'test-scripture',
          schema: { id: 1, levels: ['Chapter', 'Verse'] },
          visibility: 'public',
          owner_id: BOOK_OWNER_ID,
          metadata_json: {},
        }),
      });
      return;
    }

    if (path === `/api/books/${BOOK_ID}/tree` && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: NODE_ID,
            parent_node_id: null,
            level_name: 'Chapter',
            sequence_number: '1',
            title_english: 'Chapter 1',
            has_content: true,
            children: [],
          },
        ]),
      });
      return;
    }

    if (path === `/api/books/${BOOK_ID}/preview/render` && method === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          book_id: BOOK_ID,
          book_name: 'Test Scripture',
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
                source_node_id: NODE_ID,
                title: 'Chapter 1',
                content: {
                  level_name: 'Chapter',
                  sequence_number: '1',
                  rendered_lines: [
                    { field: 'english', label: 'English', value: 'Sample verse content.' },
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
        }),
      });
      return;
    }

    await route.continue();
  });
};

test.describe('preview Edit node button visibility', () => {
  test('Edit node button is visible in preview blocks for an editor', async ({ page }) => {
    await mockBaseRoutes(page, 'editor');

    await page.goto(`/scriptures?book=${BOOK_ID}&preview=book`);
    await page.waitForURL(/preview=book/, { timeout: 10000 });

    // Wait for at least one preview block to render
    await expect(page.getByText('Sample verse content.')).toBeVisible({ timeout: 10000 });

    // The "Edit node" button should appear in the block header
    await expect(
      page.getByRole('button', { name: 'Open full node editor' }),
    ).toBeVisible({ timeout: 5000 });
  });

  test('Edit node button is absent in preview blocks for a viewer', async ({ page }) => {
    await mockBaseRoutes(page, 'viewer');

    await page.goto(`/scriptures?book=${BOOK_ID}&preview=book`);
    await page.waitForURL(/preview=book/, { timeout: 10000 });

    // Wait for preview content to render
    await expect(page.getByText('Sample verse content.')).toBeVisible({ timeout: 10000 });

    // No edit button for viewers
    await expect(
      page.getByRole('button', { name: 'Open full node editor' }),
    ).toHaveCount(0);
  });
});
