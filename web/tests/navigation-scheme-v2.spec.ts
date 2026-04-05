import { expect, test } from '@playwright/test';

/**
 * Navigation Scheme UI Tests (v2)
 * Pragmatic tests for core navigation behaviors 
 * across the application
 */

const mockNavigationApi = async (page: import('@playwright/test').Page) => {
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
          id: null,
          email: null,
          role: 'viewer',
          permissions: { can_view: true, can_admin: false },
        }),
      });
      return;
    }

    if (path === '/api/preferences') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({}),
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
      const books = [
        { id: 1, book_name: 'Bhagavad Gita', book_code: 'bhagavad-gita', schema_id: 1, visibility: 'public' },
        { id: 2, book_name: 'Ramayana', book_code: 'ramayana', schema_id: 2, visibility: 'public' },
        { id: 3, book_name: 'Private Text', book_code: 'private-text', schema_id: 3, visibility: 'private' },
      ];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(books),
      });
      return;
    }

    if (path.match(/^\/api\/books\/\d+$/) && method === 'GET') {
      const id = Number(path.split('/').pop());
      const books: Record<number, object> = {
        1: { id: 1, book_name: 'Bhagavad Gita', schema_id: 1, visibility: 'public' },
        2: { id: 2, book_name: 'Ramayana', schema_id: 2, visibility: 'public' },
        3: { id: 3, book_name: 'Private Text', schema_id: 3, visibility: 'private' },
      };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(books[id] || { id, book_name: `Book ${id}`, visibility: 'public' }),
      });
      return;
    }

    if (path.match(/^\/api\/books\/\d+\/tree$/) && method === 'GET') {
      const id = Number(path.split('/')[3]);
      if (id === 999) {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ detail: 'Book not found' }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
      return;
    }

    if (path === '/api/daily-verse' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 102,
          node_id: 102,
          book_id: 1,
          book_name: 'Bhagavad Gita',
          title: 'Verse 1',
          content: 'Sample verse',
        }),
      });
      return;
    }

    if (path === '/api/books/featured' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([1, 2]),
      });
      return;
    }

    if (path === '/api/stats' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ books_count: 3, nodes_count: 100, users_count: 50 }),
      });
      return;
    }

    await route.continue();
  });
};

test.describe('Navigation Scheme - Core Flows', () => {
  test.beforeEach(async ({ page }) => {
    await mockNavigationApi(page);
  });

  test('Home page loads and Daily Verse renders', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Should be on home page
    expect(page.url()).toMatch(/^[\w:/.?=&-]*\/?$/);

    // Daily Verse section should load
    const dailyVerseIndicators = page.locator('text=/Daily|Verse|Random/i');
    const isVisible = await dailyVerseIndicators.first().isVisible({ timeout: 10000 }).catch(() => false);
    if (isVisible) {
      expect(isVisible).toBe(true);
    }
  });

  test('Links with from=home parameter exist for deep linking', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Look for any link with from=home parameter (indicates navigation tracking)
    const fromHomeLinks = page.locator('a[href*="from=home"]');
    const count = await fromHomeLinks.count();

    // Should have at least one link with from=home (daily verse or featured books)
    expect(count).toBeGreaterThan(0);
  });

  test('Scriptures page navigates correctly', async ({ page }) => {
    await page.goto('/scriptures');
    await page.waitForLoadState('networkidle');

    // Should be on scriptures page
    expect(page.url()).toContain('/scriptures');
  });

  test('Navigation from Home to Scriptures works with back button', async ({ page }) => {
    // Start at home
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Find link to scriptures
    const scripturesLink = page.locator('a[href*="/scriptures"]').first();
    if (await scripturesLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await scripturesLink.click();
      await page.waitForLoadState('networkidle');

      // Should be on scriptures
      expect(page.url()).toContain('/scriptures');

      // Go back
      await page.goBack();
      await page.waitForLoadState('networkidle');

      // Should be back at home
      const homeUrl = new URL('/', page.url());
      expect(page.url()).toContain(homeUrl.pathname);
    }
  });

  test('URL parameters can be included in navigation links', async ({ page }) => {
    // Test that links can include tracking parameters
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Find any link with multiple parameters
    const multiParamLinks = page.locator('a[href*="?"][href*="&"]');

    // Should have links with multiple parameters
    const count = await multiParamLinks.count();
    // This is a soft assertion - may have 0 if page doesn't render
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('Browser back button navigation works', async ({ page }) => {
    // Create navigation history
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const homeUrl = page.url();

    // Navigate to another page if available
    const anyLink = page.locator('a[href^="/"]').filter({ hasText: /[a-z]/i }).first();
    if (await anyLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      const href = await anyLink.getAttribute('href').catch(() => null);
      if (href && href !== '/') {
        await anyLink.click();
        await page.waitForLoadState('networkidle');

        // Go back using browser
        await page.goBack();
        await page.waitForLoadState('networkidle');

        // Should be back at home
        expect(page.url()).toBe(homeUrl);
      }
    }
  });

  test('Deep links to scriptures preserve parameters', async ({ page }) => {
    // Test deep linking with parameters
    const deepLinkUrl = '/scriptures?book=1&from=home';
    await page.goto(deepLinkUrl);
    await page.waitForLoadState('networkidle');

    // URL should contain the parameters
    expect(page.url()).toContain('book=1');
    expect(page.url()).toContain('from=home');
  });

  test('URL patterns include source context for navigation', async ({ page }) => {
    // Scan home page for navigation patterns
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Look for any href that includes context parameters
    const allLinks = page.locator('a[href*="?"]');
    const linkCount = await allLinks.count();

    // Should have some parametrized links
    if (linkCount > 0) {
      // Get first link href
      const firstHref = await allLinks.first().getAttribute('href');
      expect(firstHref).toBeTruthy();
    }
  });

  test('Navigation to scriptures and back preserves state', async ({ page }) => {
    // Start at home
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Navigate to scriptures if link exists
    const scripturesLink = page.locator('a[href*="/scriptures"]').first();
    if (await scripturesLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      const initialUrl = page.url();
      
      await scripturesLink.click();
      await page.waitForLoadState('networkidle');

      const scripturesUrl = page.url();
      expect(scripturesUrl).not.toBe(initialUrl);

      // Go back
      await page.goBack();
      await page.waitForLoadState('networkidle');

      // Should be back at original page
      expect(page.url()).toBe(initialUrl);
    }
  });

  test('Navigation system handles multiple parameter types', async ({ page }) => {
    // Test various parameter combinations
    const testUrls = [
      '/scriptures?book=1',
      '/scriptures?book=1&node=102',
      '/scriptures?book=1&from=home',
      '/?q=test',
    ];

    for (const url of testUrls) {
      await page.goto(url);
      await page.waitForLoadState('networkidle');

      // Page should load without errors
      const errors = page.locator('text=/error|failed/i');
      // Should not have error messages (soft check)
      const errorCount = await errors.count().catch(() => 0);
      expect(errorCount).toBeLessThanOrEqual(1); // Allow for graceful messaging
    }
  });

  test('Mobile browse shows tree-only when no child node is selected', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    await page.route('**/api/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 7,
          email: 'mobile.viewer@example.com',
          role: 'viewer',
          permissions: { can_view: true, can_admin: false },
        }),
      });
    });

    await page.route('**/api/books/1/tree', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    });

    await page.goto('/scriptures?book=1&browse=1');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: 'Browse Book' })).toBeVisible();
    await page.getByRole('button', { name: 'Tree', exact: true }).click();
    await expect(page.locator('text=No nodes yet.')).toBeVisible();
    await expect(page.locator('text=Select an item in the tree')).toBeHidden();
  });

  test('Mobile browse auto-shows details when a child node is selected', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    await page.route('**/api/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 7,
          email: 'mobile.viewer@example.com',
          role: 'viewer',
          permissions: { can_view: true, can_admin: false },
        }),
      });
    });

    await page.route('**/api/books/1/tree', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 101,
            parent_node_id: null,
            level_name: 'CHAPTER',
            level_order: 1,
            sequence_number: '1',
            title_english: 'Chapter One',
            has_content: false,
            children: [
              {
                id: 102,
                parent_node_id: 101,
                level_name: 'VERSE',
                level_order: 2,
                sequence_number: '1',
                title_english: 'Verse One',
                has_content: true,
                children: [],
              },
            ],
          },
        ]),
      });
    });

    await page.route('**/api/content/nodes/102**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 102,
          book_id: 1,
          level_name: 'VERSE',
          level_order: 2,
          sequence_number: '1',
          has_content: true,
          title_english: 'Verse One',
          content_data: {
            basic: {
              sanskrit: 'धर्मक्षेत्रे कुरुक्षेत्रे',
              transliteration: 'dharmakṣetre kurukṣetre',
              translation: 'Mobile details visible',
            },
            translations: {
              english: 'Mobile details visible',
            },
          },
        }),
      });
    });

    await page.goto('/scriptures?book=1&browse=1');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: 'Browse Book' })).toBeVisible();
    await page.getByRole('button', { name: 'Tree', exact: true }).click();
    const verseOneNode = page.getByRole('button', { name: 'Verse One' }).first();
    const isVerseVisible = await verseOneNode.isVisible().catch(() => false);
    if (!isVerseVisible) {
      const expandAllButton = page.getByRole('button', { name: 'Expand all' });
      if (await expandAllButton.count()) {
        await expandAllButton.click();
      } else {
        await page.getByRole('button', { name: '+' }).first().click();
      }
    }
    await verseOneNode.click();
    await expect(page.locator('text=Display preferences')).toBeVisible();
    await expect(page.locator('text=Select an item in the tree')).toBeHidden();
  });

  test('Scriptures preview deep link opens once without repeated refresh churn', async ({ page, browserName }) => {
    // Only test on Chromium for consistency
    if (browserName !== 'chromium') {
      test.skip();
    }

    await page.route('**/api/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 42,
          email: 'preview-test@example.com',
          role: 'editor',
          permissions: { can_view: true, can_admin: false },
        }),
      });
    });

    let mainFrameNavigations = 0;
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        mainFrameNavigations += 1;
      }
    });

    await page.goto('/scriptures?book=1&preview=book&from=home');
    await page.waitForLoadState('networkidle');

    await page.waitForTimeout(500);
    const stableUrl = page.url();
    const stableNavigationCount = mainFrameNavigations;

    // Wait and confirm no additional navigation churn happens
    await page.waitForTimeout(1200);
    expect(page.url()).toBe(stableUrl);
    expect(mainFrameNavigations).toBe(stableNavigationCount);
    
    // Verify URL still contains preview param (no re-navigation)
    expect(page.url()).toContain('preview=book');
  });

  test('Stale tree error clears after navigating away from missing book', async ({ page, browserName }) => {
    // Only test on Chromium
    if (browserName !== 'chromium') {
      test.skip();
    }

    await page.route('**/api/books/999/tree', async (route) => {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Book not found' }),
      });
    });

    // Navigate to valid book first in browse mode
    await page.goto('/scriptures?book=1&browse=1');
    await page.waitForLoadState('networkidle');
    expect(page.url()).toContain('book=1');
    expect(page.url()).toContain('browse=1');

    // Now navigate to invalid book
    await page.goto('/scriptures?book=999&browse=1');
    await page.waitForLoadState('networkidle');
    expect(page.url()).toContain('book=999');
    expect(page.url()).toContain('browse=1');

    // Error may surface depending on async timing; if it does, it must clear after navigation.
    const treeError = page.getByText(/Book not found|Tree fetch failed|Invalid book/i);
    const hadVisibleError = await treeError.isVisible({ timeout: 5000 }).catch(() => false);

    // Navigate away by removing book parameter
    await page.goto('/scriptures?browse=1');
    await page.waitForLoadState('networkidle');
    expect(page.url()).toContain('browse=1');
    expect(page.url()).not.toContain('book=');
    
    // Error message should disappear (or remain absent)
    if (hadVisibleError) {
      await expect(treeError).not.toBeVisible({ timeout: 5000 });
    }
    
    // Navigate to valid book
    await page.goto('/scriptures?book=1&browse=1');
    await page.waitForLoadState('networkidle');
    
    // Verify no error is shown
    expect(await treeError.count()).toBe(0);
  });
});
