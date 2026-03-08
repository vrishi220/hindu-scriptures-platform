import { expect, test } from '@playwright/test';

type Identity = {
  email: string;
  username: string;
  password: string;
};

const uniqueIdentity = (prefix: string): Identity => {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  return {
    email: `${prefix}_${suffix}@example.com`,
    username: `${prefix}_${suffix}`,
    password: 'StrongPass123!',
  };
};

const registerAndLoginInBrowserContext = async (
  request: import('@playwright/test').APIRequestContext,
  identity: Identity,
) => {
  const registerResponse = await request.post('/api/auth/register', {
    data: {
      email: identity.email,
      username: identity.username,
      full_name: 'N04 Browser Journey User',
      password: identity.password,
    },
  });
  expect(registerResponse.status()).toBe(201);

  const loginResponse = await request.post('/api/auth/login', {
    data: {
      email: identity.email,
      password: identity.password,
    },
  });
  expect(loginResponse.status()).toBe(200);
};

const createSchemaAndBook = async (
  request: import('@playwright/test').APIRequestContext,
  suffix: string,
) => {
  const schemaResponse = await request.post('/api/content/schemas', {
    data: {
      name: `N04 Browser Schema ${suffix}`,
      description: 'N-04 browser journey schema',
      levels: ['Chapter'],
    },
  });
  expect(schemaResponse.status()).toBe(201);
  const schemaPayload = (await schemaResponse.json()) as { id: number };

  const bookResponse = await request.post('/api/books', {
    data: {
      schema_id: schemaPayload.id,
      book_name: `N04 Browser Source Book ${suffix}`,
      book_code: `n04-browser-source-${suffix}`,
      language_primary: 'sanskrit',
    },
  });
  expect(bookResponse.status()).toBe(201);
  const bookPayload = (await bookResponse.json()) as { id: number };

  return {
    schemaId: schemaPayload.id,
    sourceBookId: bookPayload.id,
  };
};

const createSourceNode = async (
  request: import('@playwright/test').APIRequestContext,
  sourceBookId: number,
  sequenceNumber: string,
  title: string,
  licenseType: string,
) => {
  const nodeResponse = await request.post('/api/content/nodes', {
    data: {
      book_id: sourceBookId,
      parent_node_id: null,
      level_name: 'Chapter',
      level_order: 1,
      sequence_number: sequenceNumber,
      title_english: title,
      has_content: false,
      license_type: licenseType,
    },
  });

  expect(nodeResponse.status()).toBe(201);
  const nodePayload = (await nodeResponse.json()) as { id: number };
  return nodePayload.id;
};

const cleanupBooks = async (
  request: import('@playwright/test').APIRequestContext,
  bookIds: number[],
) => {
  await Promise.allSettled(
    bookIds.map(async (bookId) => {
      try {
        const response = await request.delete(`/api/books/${bookId}`, { timeout: 2500 });
        if (![200, 204, 404].includes(response.status())) {
          await response.body().catch(() => undefined);
        }
      } catch {}
    }),
  );
};

const cleanupDrafts = async (
  request: import('@playwright/test').APIRequestContext,
  draftIds: number[],
) => {
  await Promise.allSettled(
    draftIds.map(async (draftId) => {
      try {
        const response = await request.delete(`/api/draft-books/${draftId}`, { timeout: 2500 });
        if (![200, 204, 404].includes(response.status())) {
          await response.body().catch(() => undefined);
        }
      } catch {}
    }),
  );
};

const withCleanupTimeout = async (operation: Promise<unknown>, timeoutMs = 4000) => {
  await Promise.race([
    operation,
    new Promise<void>((resolve) => {
      setTimeout(resolve, timeoutMs);
    }),
  ]);
};

const findDraftIdByTitle = async (
  request: import('@playwright/test').APIRequestContext,
  title: string,
) => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await request.get('/api/draft-books/my');
    if (response.ok()) {
      const payload = (await response.json()) as { id: number; title: string }[];
      const match = payload.find((item) => item.title === title);
      if (match) {
        return match.id;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  return null;
};

const cleanupSchemas = async (
  request: import('@playwright/test').APIRequestContext,
  schemaIds: number[],
) => {
  for (const schemaId of schemaIds) {
    try {
      const response = await request.delete(`/api/schemas/${schemaId}`, { timeout: 5000 });
      if (![200, 204, 404].includes(response.status())) {
        await response.body().catch(() => undefined);
      }
    } catch {}
  }
};

test.describe('N-04 browser draft editor and viewer journeys', () => {
  test.describe.configure({ timeout: 120_000 });

  test('editor creates draft in browser, publishes, and opens reader journey', async ({ page }) => {
    test.setTimeout(120_000);

    const createdBookIds: number[] = [];
    const createdSchemaIds: number[] = [];
    const createdDraftIds: number[] = [];
    const identity = uniqueIdentity('n04_browser_editor');
    await registerAndLoginInBrowserContext(page.request, identity);

    try {
      const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
      const { schemaId, sourceBookId } = await createSchemaAndBook(page.request, suffix);
      createdSchemaIds.push(schemaId);
      createdBookIds.push(sourceBookId);
      const allowedNodeId = await createSourceNode(
        page.request,
        sourceBookId,
        '1',
        'N04 Browser Allowed Node',
        'CC-BY-SA-4.0',
      );

      const draftTitle = `N04 Browser Draft ${suffix}`;
      const draftStructure = {
        front: [],
        body: [
          {
            node_id: allowedNodeId,
            source_type: 'library_reference',
            source_book_id: sourceBookId,
            title: 'Browser Allowed Item',
          },
        ],
        back: [],
      };

      await page.goto('/drafts');
      await page.waitForLoadState('domcontentloaded');

      await page.getByPlaceholder('Draft title').fill(draftTitle);
      await page.getByPlaceholder('Description (optional)').fill('N04 browser journey draft');
      await page.getByRole('button', { name: 'Create Draft' }).click();

      let draftId: number | null = null;
      for (let attempt = 0; attempt < 12 && draftId === null; attempt += 1) {
        draftId = await findDraftIdByTitle(page.request, draftTitle);
        if (draftId === null) {
          await page.waitForTimeout(500);
        }
      }

      expect(draftId).not.toBeNull();
      if (draftId !== null) {
        createdDraftIds.push(draftId);
      }

      const draftCard = page.locator('div.rounded-2xl.border').filter({ hasText: draftTitle }).first();
      await expect(draftCard).toBeVisible({ timeout: 15000 });

      if (draftId === null) {
        throw new Error('Draft id not found after creation');
      }

      const saveResponse = await page.request.patch(`/api/draft-books/${draftId}`, {
        data: {
          section_structure: draftStructure,
        },
      });
      expect(saveResponse.status()).toBe(200);

      const publishResponse = await page.request.post(`/api/draft-books/${draftId}/publish`, {
        data: {},
      });
      expect(publishResponse.status()).toBe(201);
      const publishPayload = (await publishResponse.json()) as {
        snapshot: { id: number };
      };

      await page.goto(`/editions/${publishPayload.snapshot.id}`);

      await expect(page).toHaveURL(/\/editions\/\d+$/);
      await expect(page.getByRole('heading', { name: 'Published Edition' })).toBeVisible();
      await expect(page.locator('text=Section Navigation')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Provenance Appendix' })).toBeVisible();

      const pdfLink = page.getByRole('link', { name: 'Download PDF' });
      await expect(pdfLink).toBeVisible();
      await expect(pdfLink).toHaveAttribute('href', /\/api\/edition-snapshots\/\d+\/export\/pdf/);
    } finally {
      await withCleanupTimeout(cleanupDrafts(page.request, createdDraftIds));
      await withCleanupTimeout(cleanupBooks(page.request, createdBookIds));
      await withCleanupTimeout(cleanupSchemas(page.request, createdSchemaIds));
    }
  });

  test('editor publish is blocked in browser when draft contains disallowed license', async ({ page }) => {
    test.setTimeout(120_000);

    const createdBookIds: number[] = [];
    const createdSchemaIds: number[] = [];
    const createdDraftIds: number[] = [];
    const identity = uniqueIdentity('n04_browser_blocked_editor');
    await registerAndLoginInBrowserContext(page.request, identity);

    try {
      const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
      const { schemaId, sourceBookId } = await createSchemaAndBook(page.request, suffix);
      createdSchemaIds.push(schemaId);
      createdBookIds.push(sourceBookId);
      const blockedNodeId = await createSourceNode(
        page.request,
        sourceBookId,
        '2',
        'N04 Browser Blocked Node',
        'ALL-RIGHTS-RESERVED',
      );

      const blockedDraftTitle = `N04 Browser Blocked Draft ${suffix}`;
      const createDraftResponse = await page.request.post('/api/draft-books', {
        data: {
          title: blockedDraftTitle,
          description: 'N04 blocked publish browser journey draft',
          section_structure: {
            front: [],
            body: [
              {
                node_id: blockedNodeId,
                source_type: 'library_reference',
                source_book_id: sourceBookId,
                title: 'Browser Blocked Item',
              },
            ],
            back: [],
          },
        },
      });
      expect(createDraftResponse.status()).toBe(201);
      const createdDraft = (await createDraftResponse.json()) as { id: number };
      createdDraftIds.push(createdDraft.id);

      await page.goto(`/drafts?draftId=${createdDraft.id}`);
      await page.waitForLoadState('domcontentloaded');

      const highlightedCard = page.locator('div.rounded-2xl.border').filter({ hasText: blockedDraftTitle }).first();
      await expect(highlightedCard).toBeVisible();
      const manageButton = highlightedCard.getByRole('button', { name: 'Manage' });
      if (await manageButton.isVisible()) {
        await manageButton.click();
      }

      const publishButton = highlightedCard.getByRole('button', { name: 'Publish' });
      await expect(publishButton).toBeVisible();

      await publishButton.click();

      await expect(page.locator('text=publish blocked by license policy')).toBeVisible();
      await expect(highlightedCard).toBeVisible();
    } finally {
      await withCleanupTimeout(cleanupDrafts(page.request, createdDraftIds));
      await withCleanupTimeout(cleanupBooks(page.request, createdBookIds));
      await withCleanupTimeout(cleanupSchemas(page.request, createdSchemaIds));
    }
  });
});