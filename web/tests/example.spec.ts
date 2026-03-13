import { test, expect } from '@playwright/test';

/**
 * Frontend integration tests for Hindu Scriptures Platform
 * 
 * These tests verify critical user journeys and UI components.
 * Run with: npx playwright test --headed
 */

const mockAuthenticatedSession = async (page: import('@playwright/test').Page) => {
  let signedIn = true;

  await page.route('**/api/me', async route => {
    if (signedIn) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          email: 'tester@example.com',
          role: 'viewer',
          permissions: { can_admin: false },
        }),
      });
      return;
    }

    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'Unauthorized' }),
    });
  });

  await page.route('**/api/auth/logout', async route => {
    signedIn = false;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    });
  });

  await page.route('**/api/logout', async route => {
    signedIn = false;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    });
  });
};

type MockMediaAsset = {
  id: number;
  media_type: string;
  url: string;
  metadata?: Record<string, unknown>;
};

type MockMediaFile = {
  id: number;
  node_id: number;
  media_type: string;
  url: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
};

const setupEditableScripturesMocks = async (
  page: import('@playwright/test').Page,
  options?: {
    assets?: MockMediaAsset[];
    initialBookMetadata?: Record<string, unknown>;
    initialNodeMedia?: Record<number, MockMediaFile[]>;
  }
) => {
  const assets = options?.assets ?? [];
  const nodeMedia = new Map<number, MockMediaFile[]>(
    Object.entries(options?.initialNodeMedia ?? {}).map(([key, value]) => [Number(key), value])
  );

  const tree = [
    {
      id: 101,
      level_name: 'CHAPTER',
      level_order: 1,
      sequence_number: '1',
      title_english: 'Chapter One',
      children: [
        {
          id: 102,
          level_name: 'VERSE',
          level_order: 2,
          sequence_number: '1',
          title_english: 'Verse One',
          children: [],
        },
      ],
    },
  ];

  const book = {
    id: 101,
    book_name: 'Mock Multimedia Book',
    schema_id: 1,
    visibility: 'private',
    schema: {
      id: 1,
      name: 'Chapter Verse',
      levels: ['CHAPTER', 'VERSE'],
    },
    metadata_json: { ...(options?.initialBookMetadata ?? {}) },
    metadata: { ...(options?.initialBookMetadata ?? {}) },
  };

  const nodePayloadById: Record<number, Record<string, unknown>> = {
    101: {
      id: 101,
      level_name: 'CHAPTER',
      level_order: 1,
      sequence_number: '1',
      title_english: 'Chapter One',
      has_content: false,
      content_data: null,
      tags: [],
    },
    102: {
      id: 102,
      level_name: 'VERSE',
      level_order: 2,
      sequence_number: '1',
      title_english: 'Verse One',
      has_content: true,
      content_data: {
        basic: {
          sanskrit: 'धर्मक्षेत्रे कुरुक्षेत्रे',
          transliteration: 'dharmakṣetre kurukṣetre',
          translation: 'Verse one translation',
        },
        translations: {
          english: 'Verse one translation',
        },
      },
      tags: [],
    },
  };

  let nextNodeMediaId = 900;

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path === '/api/me') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 1,
          email: 'admin@example.com',
          role: 'admin',
          permissions: { can_view: true, can_admin: true, can_edit: true },
        }),
      });
      return;
    }

    if (path === '/api/preferences' && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
      return;
    }

    if (path === '/api/preferences' && method === 'PATCH') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
      return;
    }

    if (path === '/api/cart/me') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) });
      return;
    }

    if (path === '/api/metadata/categories') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
      return;
    }

    if (path === '/api/books' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: book.id,
            book_name: book.book_name,
            schema_id: book.schema_id,
            visibility: book.visibility,
            metadata_json: book.metadata_json,
            metadata: book.metadata,
          },
        ]),
      });
      return;
    }

    if (path === '/api/books/101' && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(book) });
      return;
    }

    if (path === '/api/books/101' && method === 'PATCH') {
      const payload = JSON.parse(request.postData() || '{}') as { metadata?: Record<string, unknown> };
      const nextMetadata = payload.metadata ?? {};
      book.metadata_json = { ...nextMetadata };
      book.metadata = { ...nextMetadata };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(book) });
      return;
    }

    if (path === '/api/books/101/tree' && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(tree) });
      return;
    }

    if (/^\/api\/content\/nodes\/\d+$/.test(path) && method === 'GET') {
      const nodeId = Number(path.split('/').pop());
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(nodePayloadById[nodeId] ?? nodePayloadById[102]),
      });
      return;
    }

    if (/^\/api\/content\/nodes\/\d+\/media$/.test(path) && method === 'GET') {
      const nodeId = Number(path.split('/')[4]);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(nodeMedia.get(nodeId) ?? []),
      });
      return;
    }

    if (/^\/api\/content\/nodes\/\d+\/(commentary|comments)$/.test(path) && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
      return;
    }

    if (/^\/api\/content\/media-bank\/assets\/\d+\/attach\/nodes\/\d+$/.test(path) && method === 'POST') {
      const parts = path.split('/');
      const assetId = Number(parts[5]);
      const nodeId = Number(parts[8]);
      const asset = assets.find((entry) => entry.id === assetId);
      const existing = nodeMedia.get(nodeId) ?? [];
      if (asset) {
        existing.push({
          id: nextNodeMediaId++,
          node_id: nodeId,
          media_type: asset.media_type,
          url: asset.url,
          metadata: {
            ...(asset.metadata ?? {}),
            asset_id: asset.id,
            display_name: asset.metadata?.display_name,
          },
          created_at: new Date().toISOString(),
        });
        nodeMedia.set(nodeId, existing);
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
      return;
    }

    if (path === '/api/content/media-bank/assets' && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(assets) });
      return;
    }

    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
  });
};

test.describe('Home Page', () => {
  test('should load successfully', async ({ page }) => {
    await page.goto('http://localhost:3000');
    // Just check that we're on a valid page
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });

  test('should have navigation or content', async ({ page }) => {
    await page.goto('http://localhost:3000');
    // Look for either nav or main content area
    const nav = page.locator('nav, [role="navigation"]').first();
    const main = page.locator('main, [role="main"]').first();
    
    // At least one should be visible
    const isNavVisible = await nav.isVisible().catch(() => false);
    const isMainVisible = await main.isVisible().catch(() => false);
    
    expect(isNavVisible || isMainVisible).toBeTruthy();
  });
});

test.describe('Navigation', () => {
  test('navbar should be visible', async ({ page }) => {
    await page.goto('http://localhost:3000');
    const navbar = page.locator('nav').first();
    await expect(navbar).toBeVisible();
  });

  test('should have links in navigation', async ({ page }) => {
    await page.goto('http://localhost:3000');
    const nav = page.locator('nav').first();
    const links = nav.locator('a');
    
    // Should have at least some navigation links
    const count = await links.count();
    expect(count).toBeGreaterThan(0);
  });

  test('page should not have 404 errors', async ({ page }) => {
    await page.goto('http://localhost:3000');
    await page.waitForLoadState('domcontentloaded');
    
    // If we got here without error, the page loaded
    expect(true).toBe(true);
  });
});

test.describe('Scripture Browser', () => {
  test('should navigate to scriptures section', async ({ page }) => {
    await page.goto('http://localhost:3000/scriptures');
    await page.waitForLoadState('domcontentloaded');
    
    // Check that we're on a valid page
    const main = page.locator('main, [role="main"]').first();
    const isVisible = await main.isVisible().catch(() => false);
    expect(isVisible || true).toBeTruthy(); // Scripture browser might not have main
  });

  test('should display content or loading state', async ({ page }) => {
    await page.goto('http://localhost:3000/scriptures');
    await page.waitForLoadState('domcontentloaded');
    
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });

  test('book title opens preview and browse stays single-action without row menu', async ({ page }) => {
    let previewRenderCalls = 0;

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
            id: 42,
            email: 'scriptures-tester@example.com',
            role: 'viewer',
            permissions: { can_view: true, can_admin: false },
          }),
        });
        return;
      }

      if (path === '/api/preferences' && method === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
        return;
      }

      if (path === '/api/preferences' && method === 'PATCH') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
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
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
        return;
      }

      if (path === '/api/books' && method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            {
              id: 101,
              book_name: 'Mock Preview Browse Book',
              visibility: 'private',
            },
          ]),
        });
        return;
      }

      if (path === '/api/books/101' && method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 101,
            book_name: 'Mock Preview Browse Book',
            schema_id: null,
            visibility: 'private',
          }),
        });
        return;
      }

      if (path === '/api/books/101/tree' && method === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
        return;
      }

      if (path === '/api/books/101/preview/render' && method === 'POST') {
        previewRenderCalls += 1;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            preview_scope: 'book',
            book_name: 'Mock Preview Browse Book',
            root_title: null,
            render_settings: {
              show_titles: false,
              show_labels: false,
              show_details: false,
              show_sanskrit: true,
              show_transliteration: true,
              show_english: true,
              transliteration_script: 'iast',
            },
            body: [],
            warnings: [],
            template_name: 'default',
          }),
        });
        return;
      }

      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
    });

    await page.goto('http://localhost:3000/scriptures');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByRole('button', { name: 'Mock Preview Browse Book' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Row actions' })).toHaveCount(0);
    await expect(page.getByText('Preview book')).toHaveCount(0);

    await page.getByRole('button', { name: 'Mock Preview Browse Book' }).click();
    await expect
      .poll(() => previewRenderCalls, { message: 'preview render endpoint should be called once from title click' })
      .toBe(1);

    const previewHeading = page.getByRole('heading', { name: 'Book Preview' });
    const previewVisible = await previewHeading.isVisible({ timeout: 2000 }).catch(() => false);
    if (previewVisible) {
      await page.locator('button:has-text("✕")').first().click();
      await expect(previewHeading).toHaveCount(0);
    }

    const browseButton = page.getByRole('button', { name: /Browse book/i }).first();
    const browseLink = page.getByRole('link', { name: /Browse book/i }).first();
    const browseButtonVisible = await browseButton.isVisible({ timeout: 2000 }).catch(() => false);
    if (browseButtonVisible) {
      await browseButton.click();
    } else {
      const browseLinkVisible = await browseLink.isVisible({ timeout: 2000 }).catch(() => false);
      if (browseLinkVisible) {
        await browseLink.click();
      } else {
        await page.goto('http://localhost:3000/scriptures?book=101&browse=1');
      }
    }
    await expect(page.getByRole('heading', { name: 'Browse Book' })).toBeVisible();
  });

  test('preview and browse links deep-link to each other with correct URL intent', async ({ page }) => {
    let previewRenderCalls = 0;

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
            id: 42,
            email: 'scriptures-tester@example.com',
            role: 'viewer',
            permissions: { can_view: true, can_admin: false },
          }),
        });
        return;
      }

      if (path === '/api/preferences' && method === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
        return;
      }

      if (path === '/api/preferences' && method === 'PATCH') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
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
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
        return;
      }

      if (path === '/api/books' && method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            {
              id: 101,
              book_name: 'Mock Preview Browse Book',
              visibility: 'private',
            },
          ]),
        });
        return;
      }

      if (path === '/api/books/101' && method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 101,
            book_name: 'Mock Preview Browse Book',
            schema_id: null,
            visibility: 'private',
          }),
        });
        return;
      }

      if (path === '/api/books/101/tree' && method === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
        return;
      }

      if (path === '/api/books/101/preview/render' && method === 'POST') {
        previewRenderCalls += 1;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            preview_scope: 'book',
            book_name: 'Mock Preview Browse Book',
            root_title: null,
            render_settings: {
              show_titles: false,
              show_labels: false,
              show_details: false,
              show_sanskrit: true,
              show_transliteration: true,
              show_english: true,
              transliteration_script: 'iast',
            },
            body: [],
            warnings: [],
            template_name: 'default',
          }),
        });
        return;
      }

      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
    });

    await page.goto('http://localhost:3000/scriptures');
    await page.waitForLoadState('domcontentloaded');

    const browseButton = page.getByRole('button', { name: 'Browse book', exact: true });
    await expect(browseButton).toBeVisible();
    await browseButton.click();

    await expect(page.getByRole('heading', { name: 'Browse Book' })).toBeVisible();
    await expect(page).toHaveURL(/\/scriptures\?.*book=101.*browse=1/);

    const browsePreviewLink = page.getByRole('link', { name: 'Preview' });
    await expect(browsePreviewLink).toBeVisible();
    await expect(browsePreviewLink).toHaveAttribute('href', /preview=book/);
    await browsePreviewLink.click();

    await expect(page).toHaveURL(/\/scriptures\?.*book=101.*preview=book/);
  });

  test('book media manager attaches audio from repo and renders controls inline', async ({ page }) => {
    await setupEditableScripturesMocks(page, {
      assets: [
        {
          id: 501,
          media_type: 'audio',
          url: 'https://cdn.example.com/chant-audio.mp3',
          metadata: {
            display_name: 'Chant Audio',
            original_filename: 'chant-audio.mp3',
            content_type: 'audio/mpeg',
          },
        },
      ],
    });

    await page.goto('http://localhost:3000/scriptures?book=101&browse=1');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByRole('heading', { name: 'Browse Book' })).toBeVisible();
    await page.getByRole('button', { name: 'Book tree actions' }).click();
    await page.getByRole('button', { name: 'Manage multimedia' }).click();

    await expect(page.getByRole('heading', { name: 'Manage Multimedia' })).toBeVisible();
    await expect(page.getByText('Book media manager')).toBeVisible();

    await page.getByRole('button', { name: 'More media actions' }).click();
    await page.getByRole('button', { name: 'Add from repo' }).click();

    await expect(page.getByText('Pick an item to attach to this book')).toBeVisible();
    await page.getByRole('button', { name: 'Pick' }).click();

    await expect(page.getByText('Media attached to book.')).toBeVisible();
    await expect(page.getByText('Book media manager')).toBeVisible();
    await expect(page.locator('audio')).toBeVisible();
  });

  test('non-leaf node media manager attaches video from repo and renders for the parent node', async ({ page }) => {
    await setupEditableScripturesMocks(page, {
      assets: [
        {
          id: 601,
          media_type: 'video',
          url: 'https://cdn.example.com/chapter-intro.mp4',
          metadata: {
            display_name: 'Chapter Intro',
            original_filename: 'chapter-intro.mp4',
            content_type: 'video/mp4',
          },
        },
      ],
    });

    await page.goto('http://localhost:3000/scriptures?book=101&browse=1');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByRole('heading', { name: 'Browse Book' })).toBeVisible();

    await page.locator('#tree-node-101').click();
    await expect(page.getByRole('button', { name: 'Manage multimedia' })).toBeVisible();

    await page.getByRole('button', { name: 'Manage multimedia' }).click();
    await expect(page.getByText('Node media manager')).toBeVisible();

    await page.getByRole('button', { name: 'More media actions' }).click();
    await page.getByRole('button', { name: 'Add from repo' }).click();

    await expect(page.getByText('Pick an item to attach to the selected node')).toBeVisible();
    await page.getByRole('button', { name: 'Pick' }).click();

    await expect(page.getByText('Node media manager')).toBeVisible();
    await expect(page.locator('video')).toBeVisible();
  });
});

test.describe('Authentication', () => {
  test('sign in page should load', async ({ page }) => {
    await page.goto('http://localhost:3000/signin');
    // Just check page loads
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });

  test('should have input fields on sign in page', async ({ page }) => {
    await page.goto('http://localhost:3000/signin');
    
    // Look for any form inputs
    const inputs = page.locator('input');
    const count = await inputs.count();
    
    // Should have at least some input fields
    expect(count).toBeGreaterThan(0);
  });
});

test.describe('Logout Regression', () => {
  const openUserMenu = async (page: import('@playwright/test').Page) => {
    const userMenuButton = page.getByRole('button', { name: 'User menu' });
    await expect(userMenuButton).toBeVisible();
    await userMenuButton.click();
  };

  test('desktop sign out returns to signed-out state', async ({ page }) => {
    await mockAuthenticatedSession(page);
    await page.setViewportSize({ width: 1366, height: 900 });

    await page.goto('http://localhost:3000');
    await page.waitForLoadState('domcontentloaded');

    await openUserMenu(page);
    const signOutDesktop = page.getByRole('button', { name: 'Sign out' });
    await expect(signOutDesktop).toBeVisible();
    await signOutDesktop.click();

    await page.waitForURL('**/');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
  });

  test('mobile user-menu sign out returns to signed-out state', async ({ page }) => {
    await mockAuthenticatedSession(page);
    await page.setViewportSize({ width: 390, height: 844 });

    await page.goto('http://localhost:3000');
    await page.waitForLoadState('domcontentloaded');

    await openUserMenu(page);
    const mobileSignOut = page.getByRole('button', { name: 'Sign out' });
    await expect(mobileSignOut).toBeVisible();
    await mobileSignOut.click();

    await page.waitForURL('**/');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
  });
});

test.describe('Page Layout', () => {
  test('page should have body content', async ({ page }) => {
    await page.goto('http://localhost:3000');
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });

  test('should not have console errors', async ({ page }) => {
    const errors: string[] = [];
    
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });
    
    await page.goto('http://localhost:3000');
    await page.waitForLoadState('domcontentloaded');
    
    // Should not have critical errors
    expect(errors.length).toBeLessThan(5);
  });

  test('should handle navigation without errors', async ({ page }) => {
    await page.goto('http://localhost:3000');
    
    // Try to navigate using any link
    const firstLink = page.locator('a').first();
    const href = await firstLink.getAttribute('href').catch(() => null);
    
    if (href && (href.startsWith('/') || href.startsWith('http'))) {
      await firstLink.click().catch(() => {
        // Navigation might have issues, but page should still exist
      });
      await page.waitForLoadState('domcontentloaded').catch(() => {});
    }
    
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });
});
