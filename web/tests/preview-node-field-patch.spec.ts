import { expect, test } from '@playwright/test';

const uniqueIdentity = () => {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  return {
    email: `field_patch_${suffix}@example.com`,
    username: `field_patch_${suffix}`,
    password: 'StrongPass123!',
  };
};

const registerAndLogin = async (
  request: import('@playwright/test').APIRequestContext,
  identity: ReturnType<typeof uniqueIdentity>,
) => {
  const reg = await request.post('/api/auth/register', {
    data: {
      email: identity.email,
      username: identity.username,
      full_name: 'Field Patch Test User',
      password: identity.password,
    },
  });
  expect(reg.status()).toBe(201);

  const login = await request.post('/api/auth/login', {
    data: { email: identity.email, password: identity.password },
  });
  expect(login.status()).toBe(200);
};

const createSchemaBookNode = async (
  request: import('@playwright/test').APIRequestContext,
) => {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;

  const schemaResp = await request.post('/api/content/schemas', {
    data: { name: `FPatch Schema ${suffix}`, description: 'test', levels: ['Verse'] },
  });
  expect(schemaResp.status()).toBe(201);
  const { id: schemaId } = (await schemaResp.json()) as { id: number };

  const bookResp = await request.post('/api/books', {
    data: {
      schema_id: schemaId,
      book_name: `FPatch Book ${suffix}`,
      book_code: `fpatch-book-${suffix}`,
      language_primary: 'sanskrit',
    },
  });
  expect(bookResp.status()).toBe(201);
  const { id: bookId } = (await bookResp.json()) as { id: number };

  const nodeResp = await request.post('/api/content/nodes', {
    data: {
      book_id: bookId,
      parent_node_id: null,
      level_name: 'Verse',
      level_order: 1,
      sequence_number: '1',
      has_content: true,
    },
  });
  expect(nodeResp.status()).toBe(201);
  const { id: nodeId } = (await nodeResp.json()) as { id: number };

  return { schemaId, bookId, nodeId };
};

const cleanup = async (
  request: import('@playwright/test').APIRequestContext,
  bookIds: number[],
  schemaIds: number[],
) => {
  await Promise.allSettled([
    ...bookIds.map((id) =>
      request.delete(`/api/books/${id}`, { timeout: 3000 }).catch(() => undefined),
    ),
    ...schemaIds.map((id) =>
      request.delete(`/api/schemas/${id}`, { timeout: 3000 }).catch(() => undefined),
    ),
  ]);
};

test.describe('preview node field PATCH proxy route', () => {
  test('returns 401 when not authenticated', async ({ request }) => {
    const response = await request.patch('/api/content/nodes/999/field', {
      data: {
        field_path: 'content_data.translation_variants.0.text',
        value: 'test',
      },
    });
    expect(response.status()).toBe(401);
  });

  test('returns 422 for missing field_path in request body', async ({ request }) => {
    const identity = uniqueIdentity();
    await registerAndLogin(request, identity);

    const response = await request.patch('/api/content/nodes/999/field', {
      data: { value: 'test' },
    });
    expect(response.status()).toBe(422);
  });

  test('returns 422 for unsupported field_path schema validation', async ({ request }) => {
    const identity = uniqueIdentity();
    await registerAndLogin(request, identity);

    const { schemaId, bookId, nodeId } = await createSchemaBookNode(request);

    try {
      const resp = await request.patch(`/api/content/nodes/${nodeId}/field`, {
        data: { field_path: 'some_unknown_field', value: 'test' },
      });
      expect(resp.status()).toBe(422);
    } finally {
      await cleanup(request, [bookId], [schemaId]);
    }
  });

  test('patches translation_variants.text, author, and language', async ({ request }) => {
    const identity = uniqueIdentity();
    await registerAndLogin(request, identity);

    const { schemaId, bookId, nodeId } = await createSchemaBookNode(request);

    try {
      // Set up translation_variants via the standard node PATCH
      const setupResp = await request.patch(`/api/content/nodes/${nodeId}`, {
        data: {
          content_data: {
            translation_variants: [
              { text: 'Original translation', author: 'Old Author', language: 'english' },
            ],
          },
          has_content: true,
        },
      });
      expect(setupResp.status()).toBe(200);

      // Patch text
      const textResp = await request.patch(`/api/content/nodes/${nodeId}/field`, {
        data: {
          field_path: 'content_data.translation_variants.0.text',
          value: 'Updated translation text',
        },
      });
      expect(textResp.status()).toBe(200);
      const textBody = (await textResp.json()) as {
        content_data: { translation_variants: { text: string }[] };
      };
      expect(textBody.content_data.translation_variants[0].text).toBe('Updated translation text');

      // Patch author
      const authorResp = await request.patch(`/api/content/nodes/${nodeId}/field`, {
        data: {
          field_path: 'content_data.translation_variants.0.author',
          value: 'New Author',
        },
      });
      expect(authorResp.status()).toBe(200);
      const authorBody = (await authorResp.json()) as {
        content_data: { translation_variants: { author: string }[] };
      };
      expect(authorBody.content_data.translation_variants[0].author).toBe('New Author');

      // Patch language — backend lowercases the value
      const langResp = await request.patch(`/api/content/nodes/${nodeId}/field`, {
        data: {
          field_path: 'content_data.translation_variants.0.language',
          value: 'HINDI',
        },
      });
      expect(langResp.status()).toBe(200);
      const langBody = (await langResp.json()) as {
        content_data: { translation_variants: { language: string }[] };
      };
      expect(langBody.content_data.translation_variants[0].language).toBe('hindi');
    } finally {
      await cleanup(request, [bookId], [schemaId]);
    }
  });

  test('patches commentary_variants.text field', async ({ request }) => {
    const identity = uniqueIdentity();
    await registerAndLogin(request, identity);

    const { schemaId, bookId, nodeId } = await createSchemaBookNode(request);

    try {
      const setupResp = await request.patch(`/api/content/nodes/${nodeId}`, {
        data: {
          content_data: {
            commentary_variants: [
              { text: 'Original commentary', author: 'Commentator', language: 'english' },
            ],
          },
          has_content: true,
        },
      });
      expect(setupResp.status()).toBe(200);

      const patchResp = await request.patch(`/api/content/nodes/${nodeId}/field`, {
        data: {
          field_path: 'content_data.commentary_variants.0.text',
          value: 'Updated commentary',
        },
      });
      expect(patchResp.status()).toBe(200);
      const body = (await patchResp.json()) as {
        content_data: { commentary_variants: { text: string }[] };
      };
      expect(body.content_data.commentary_variants[0].text).toBe('Updated commentary');
    } finally {
      await cleanup(request, [bookId], [schemaId]);
    }
  });

  test('returns 400 for out-of-bounds variant index', async ({ request }) => {
    const identity = uniqueIdentity();
    await registerAndLogin(request, identity);

    const { schemaId, bookId, nodeId } = await createSchemaBookNode(request);

    try {
      const setupResp = await request.patch(`/api/content/nodes/${nodeId}`, {
        data: {
          content_data: {
            translation_variants: [{ text: 'Only variant', author: '', language: 'english' }],
          },
          has_content: true,
        },
      });
      expect(setupResp.status()).toBe(200);

      const resp = await request.patch(`/api/content/nodes/${nodeId}/field`, {
        data: {
          field_path: 'content_data.translation_variants.5.text',
          value: 'Out of bounds',
        },
      });
      expect(resp.status()).toBe(400);
    } finally {
      await cleanup(request, [bookId], [schemaId]);
    }
  });
});
