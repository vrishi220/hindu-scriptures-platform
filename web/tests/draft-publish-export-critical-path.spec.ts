import { expect, test } from '@playwright/test';
import crypto from 'node:crypto';

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
    password: 'StrongPass123',
  };
};

const registerAndLogin = async (
  request: import('@playwright/test').APIRequestContext,
  identity: Identity,
) => {
  const registerResponse = await request.post('/api/auth/register', {
    data: {
      email: identity.email,
      username: identity.username,
      full_name: 'N04 E2E User',
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

const createSchemaAndSourceBook = async (
  request: import('@playwright/test').APIRequestContext,
  suffix: string,
) => {
  const schemaResponse = await request.post('/api/content/schemas', {
    data: {
      name: `N04 Schema ${suffix}`,
      description: 'N-04 web E2E schema',
      levels: ['Chapter'],
    },
  });
  expect(schemaResponse.status()).toBe(201);
  const schemaPayload = (await schemaResponse.json()) as { id: number };

  const bookResponse = await request.post('/api/books', {
    data: {
      schema_id: schemaPayload.id,
      book_name: `N04 Source Book ${suffix}`,
      book_code: `n04-source-${suffix}`,
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

const createDraft = async (
  request: import('@playwright/test').APIRequestContext,
  title: string,
  sectionStructure: Record<string, unknown>,
) => {
  const draftResponse = await request.post('/api/draft-books', {
    data: {
      title,
      description: 'N-04 critical path draft',
      section_structure: sectionStructure,
    },
  });

  expect(draftResponse.status()).toBe(201);
  const draftPayload = (await draftResponse.json()) as { id: number };
  return draftPayload.id;
};

const cleanupBooks = async (
  request: import('@playwright/test').APIRequestContext,
  bookIds: number[],
) => {
  for (const bookId of bookIds) {
    const response = await request.delete(`/api/books/${bookId}`);
    if (![200, 204, 404].includes(response.status())) {
      await response.body().catch(() => undefined);
    }
  }
};

const cleanupDrafts = async (
  request: import('@playwright/test').APIRequestContext,
  draftIds: number[],
) => {
  for (const draftId of draftIds) {
    const response = await request.delete(`/api/draft-books/${draftId}`);
    if (![200, 204, 404].includes(response.status())) {
      await response.body().catch(() => undefined);
    }
  }
};

const cleanupSchemas = async (
  request: import('@playwright/test').APIRequestContext,
  schemaIds: number[],
) => {
  for (const schemaId of schemaIds) {
    const response = await request.delete(`/api/schemas/${schemaId}`);
    if (![200, 204, 404].includes(response.status())) {
      await response.body().catch(() => undefined);
    }
  }
};

test.describe('N-04 publish/export critical path', () => {
  test('publish success -> export PDF -> deterministic hash -> auth boundaries', async ({ request, playwright }) => {
    const createdBookIds: number[] = [];
    const createdSchemaIds: number[] = [];
    const createdDraftIds: number[] = [];
    const owner = uniqueIdentity('n04_owner');
    await registerAndLogin(request, owner);
    try {
      const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
      const { schemaId, sourceBookId } = await createSchemaAndSourceBook(request, suffix);
      createdSchemaIds.push(schemaId);
      createdBookIds.push(sourceBookId);

      const allowedNodeId = await createSourceNode(
        request,
        sourceBookId,
        '1',
        'Allowed Publish Node',
        'CC-BY-SA-4.0',
      );

      const allowedDraftId = await createDraft(request, `N04 Allowed Draft ${suffix}`, {
        front: [],
        body: [
          {
            node_id: allowedNodeId,
            source_type: 'library_reference',
            source_book_id: sourceBookId,
            title: 'Allowed Publish Item',
          },
        ],
        back: [],
      });
      createdDraftIds.push(allowedDraftId);

      const publishResponse = await request.post(`/api/draft-books/${allowedDraftId}/publish`, {
        data: {},
      });
      expect(publishResponse.status()).toBe(201);

      const publishPayload = (await publishResponse.json()) as {
        snapshot: { id: number; draft_book_id: number; immutable: boolean; version: number };
        license_policy: { status: 'pass' | 'warn' | 'block' };
      };

      expect(publishPayload.snapshot.draft_book_id).toBe(allowedDraftId);
      expect(publishPayload.snapshot.immutable).toBe(true);
      expect(['pass', 'warn']).toContain(publishPayload.license_policy.status);

      const snapshotId = publishPayload.snapshot.id;

      const exportResponse1 = await request.get(`/api/edition-snapshots/${snapshotId}/export/pdf`);
      expect(exportResponse1.status()).toBe(200);
      expect(exportResponse1.headers()['content-type'] || '').toContain('application/pdf');
      const pdfBytes1 = await exportResponse1.body();
      expect(pdfBytes1.subarray(0, 4).toString()).toBe('%PDF');

      const exportResponse2 = await request.get(`/api/edition-snapshots/${snapshotId}/export/pdf`);
      expect(exportResponse2.status()).toBe(200);
      const pdfBytes2 = await exportResponse2.body();

      const hash1 = crypto.createHash('sha256').update(pdfBytes1).digest('hex');
      const hash2 = crypto.createHash('sha256').update(pdfBytes2).digest('hex');
      expect(hash1).toBe(hash2);

      const unauthContext = await playwright.request.newContext({
        baseURL: 'http://localhost:3000',
      });

      const unauthPublish = await unauthContext.post(`/api/draft-books/${allowedDraftId}/publish`, {
        data: {},
      });
      expect([401, 404]).toContain(unauthPublish.status());

      const unauthExport = await unauthContext.get(`/api/edition-snapshots/${snapshotId}/export/pdf`);
      expect([401, 404]).toContain(unauthExport.status());

      await unauthContext.dispose();

      const nonOwnerIdentity = uniqueIdentity('n04_non_owner');
      const nonOwnerContext = await playwright.request.newContext({
        baseURL: 'http://localhost:3000',
      });
      await registerAndLogin(nonOwnerContext, nonOwnerIdentity);

      const nonOwnerPublish = await nonOwnerContext.post(`/api/draft-books/${allowedDraftId}/publish`, {
        data: {},
      });
      expect(nonOwnerPublish.status()).toBe(404);

      const nonOwnerExport = await nonOwnerContext.get(`/api/edition-snapshots/${snapshotId}/export/pdf`);
      expect(nonOwnerExport.status()).toBe(404);

      await nonOwnerContext.dispose();
    } finally {
      await cleanupDrafts(request, createdDraftIds);
      await cleanupBooks(request, createdBookIds);
      await cleanupSchemas(request, createdSchemaIds);
    }
  });

  test('publish is blocked when draft contains disallowed license', async ({ request }) => {
    const createdBookIds: number[] = [];
    const createdSchemaIds: number[] = [];
    const createdDraftIds: number[] = [];
    const owner = uniqueIdentity('n04_blocked_owner');
    await registerAndLogin(request, owner);
    try {
      const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
      const { schemaId, sourceBookId } = await createSchemaAndSourceBook(request, suffix);
      createdSchemaIds.push(schemaId);
      createdBookIds.push(sourceBookId);

      const blockedNodeId = await createSourceNode(
        request,
        sourceBookId,
        '2',
        'Blocked Publish Node',
        'ALL-RIGHTS-RESERVED',
      );

      const blockedDraftId = await createDraft(request, `N04 Blocked Draft ${suffix}`, {
        front: [],
        body: [
          {
            node_id: blockedNodeId,
            source_type: 'library_reference',
            source_book_id: sourceBookId,
            title: 'Blocked Publish Item',
          },
        ],
        back: [],
      });
      createdDraftIds.push(blockedDraftId);

      const publishResponse = await request.post(`/api/draft-books/${blockedDraftId}/publish`, {
        data: {},
      });

      expect(publishResponse.status()).toBe(409);
      const payload = (await publishResponse.json()) as { detail?: string };
      expect(payload.detail?.toLowerCase() || '').toContain('publish blocked by license policy');
    } finally {
      await cleanupDrafts(request, createdDraftIds);
      await cleanupBooks(request, createdBookIds);
      await cleanupSchemas(request, createdSchemaIds);
    }
  });
});
