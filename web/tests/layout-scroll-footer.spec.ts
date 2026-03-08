import { expect, test } from '@playwright/test';

const mockScripturesApi = async (page: import('@playwright/test').Page) => {
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
          email: 'layout-tester@example.com',
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
      const books = Array.from({ length: 40 }).map((_, index) => ({
        id: index + 100,
        book_name: `Scroll Regression Book ${index + 1}`,
        visibility: 'private',
      }));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(books),
      });
      return;
    }

    if (path.match(/^\/api\/books\/\d+$/) && method === 'GET') {
      const id = Number(path.split('/').pop());
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id, book_name: `Book ${id}`, schema_id: null, visibility: 'private' }),
      });
      return;
    }

    if (path.match(/^\/api\/books\/\d+\/tree$/) && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
      return;
    }

    if (path === '/api/stats' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ books_count: 40, nodes_count: 800, users_count: 50 }),
      });
      return;
    }

    if (path === '/api/daily-verse' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 1,
          title: 'Verse',
          content: 'Verse content',
          book_name: 'Book 1',
          book_id: 101,
          node_id: 1001,
        }),
      });
      return;
    }

    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
  });
};

test.describe('Layout Scroll Footer Regression', () => {
  test('home footer is reachable and visible', async ({ page }) => {
    await page.goto('http://localhost:3000');
    await page.waitForLoadState('domcontentloaded');

    const footer = page.locator('footer');
    await expect(footer).toBeVisible();
    await footer.scrollIntoViewIfNeeded();

    const footerInViewport = await footer.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return rect.top < window.innerHeight && rect.bottom > 0;
    });

    expect(footerInViewport).toBeTruthy();
  });

  test('scriptures has effective scrolling and reachable footer', async ({ page }) => {
    await mockScripturesApi(page);

    await page.goto('http://localhost:3000/scriptures');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByRole('button', { name: 'Scroll Regression Book 1', exact: true })).toBeVisible();

    const footer = page.locator('footer');
    await expect(footer).toBeVisible();

    const initial = await page.evaluate(() => {
      const pane = document.querySelector('.books-scroll-pane') as HTMLElement | null;
      const root = document.scrollingElement as HTMLElement | null;
      return {
        paneClientHeight: pane?.clientHeight ?? 0,
        paneScrollHeight: pane?.scrollHeight ?? 0,
        paneScrollTop: pane?.scrollTop ?? 0,
        rootClientHeight: root?.clientHeight ?? 0,
        rootScrollHeight: root?.scrollHeight ?? 0,
        rootScrollTop: root?.scrollTop ?? 0,
      };
    });

    await page.evaluate(() => {
      const pane = document.querySelector('.books-scroll-pane') as HTMLElement | null;
      if (pane) {
        pane.scrollTop = Math.max(200, Math.floor(pane.scrollHeight / 3));
      }
    });

    await page.waitForTimeout(100);

    const after = await page.evaluate(() => {
      const pane = document.querySelector('.books-scroll-pane') as HTMLElement | null;
      const root = document.scrollingElement as HTMLElement | null;
      return {
        paneScrollTop: pane?.scrollTop ?? 0,
        rootScrollTop: root?.scrollTop ?? 0,
      };
    });

    const paneCanScroll = initial.paneScrollHeight > initial.paneClientHeight;
    const pageCanScroll = initial.rootScrollHeight > initial.rootClientHeight;
    expect(paneCanScroll || pageCanScroll).toBeTruthy();

    const paneMoved = after.paneScrollTop > initial.paneScrollTop;
    const pageMoved = after.rootScrollTop > initial.rootScrollTop;
    expect(paneMoved || pageMoved).toBeTruthy();

    await footer.scrollIntoViewIfNeeded();

    const footerInViewport = await footer.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return rect.top < window.innerHeight && rect.bottom > 0;
    });

    expect(footerInViewport).toBeTruthy();
  });
});
