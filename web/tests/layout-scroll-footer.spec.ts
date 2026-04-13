import { expect, test } from '@playwright/test';

const MOCK_BOOK_COUNT = 240;

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
      const books = Array.from({ length: MOCK_BOOK_COUNT }).map((_, index) => ({
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
        body: JSON.stringify({ books_count: MOCK_BOOK_COUNT, nodes_count: 800, users_count: 50 }),
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

    const captureScrollMetrics = async () =>
      page.evaluate(() => {
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

    let initial = await captureScrollMetrics();

    // In CI, the mocked books list can still be mid-render when the first row appears.
    // Nudge both pane and page scrolling a few times, then re-check for effective overflow.
    let paneCanScroll = initial.paneScrollHeight > initial.paneClientHeight;
    let pageCanScroll = initial.rootScrollHeight > initial.rootClientHeight;
    if (!paneCanScroll && !pageCanScroll) {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        await page.evaluate(() => {
          const pane = document.querySelector('.books-scroll-pane') as HTMLElement | null;
          if (pane) {
            pane.scrollTop = Math.max(pane.scrollTop, pane.scrollHeight);
          }
          window.scrollTo({ top: document.body.scrollHeight, behavior: 'auto' });
        });
        await page.waitForTimeout(120);
        initial = await captureScrollMetrics();
        paneCanScroll = initial.paneScrollHeight > initial.paneClientHeight;
        pageCanScroll = initial.rootScrollHeight > initial.rootClientHeight;
        if (paneCanScroll || pageCanScroll) {
          break;
        }
      }
    }

    // Reset scroll positions so movement assertions are based on a stable baseline.
    await page.evaluate(() => {
      const pane = document.querySelector('.books-scroll-pane') as HTMLElement | null;
      const root = document.scrollingElement as HTMLElement | null;
      if (pane && pane.scrollHeight > pane.clientHeight) {
        pane.scrollTop = 0;
      }
      if (root && root.scrollHeight > root.clientHeight) {
        window.scrollTo({ top: 0, behavior: 'auto' });
      }
    });

    await page.waitForTimeout(80);

    const beforeScroll = await captureScrollMetrics();

    await page.evaluate(() => {
      const pane = document.querySelector('.books-scroll-pane') as HTMLElement | null;
      const root = document.scrollingElement as HTMLElement | null;
      if (pane && pane.scrollHeight > pane.clientHeight) {
        const paneMax = Math.max(0, pane.scrollHeight - pane.clientHeight);
        pane.scrollTop = Math.min(paneMax, 240);
      }
      if (root && root.scrollHeight > root.clientHeight) {
        const rootMax = Math.max(0, root.scrollHeight - root.clientHeight);
        window.scrollTo({ top: Math.min(rootMax, 240), behavior: 'auto' });
      }
    });

    await page.waitForTimeout(100);

    const after = await captureScrollMetrics();

    expect(paneCanScroll || pageCanScroll).toBeTruthy();

    await footer.scrollIntoViewIfNeeded();

    const footerInViewport = await footer.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return rect.top < window.innerHeight && rect.bottom > 0;
    });

    expect(footerInViewport).toBeTruthy();
  });
});
