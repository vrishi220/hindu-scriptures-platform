import { expect, test } from '@playwright/test';

const uniqueIdentity = () => {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  return {
    email: `proxy_${suffix}@example.com`,
    username: `proxy_${suffix}`,
    password: 'StrongPass123!',
  };
};

test.describe('API proxy routes', () => {
  test('register route creates a user via frontend proxy', async ({ request }) => {
    const identity = uniqueIdentity();

    const response = await request.post('/api/auth/register', {
      data: {
        email: identity.email,
        username: identity.username,
        full_name: 'Proxy Register Test',
        password: identity.password,
      },
    });

    expect(response.status()).toBe(201);
    const body = (await response.json()) as {
      email: string;
      username: string;
      role: string;
      id: number;
    };
    expect(body.email).toBe(identity.email);
    expect(body.username).toBe(identity.username);
    expect(body.role).toBe('viewer');
    expect(typeof body.id).toBe('number');
  });

  test('authenticated preferences and compilations work via frontend proxy', async ({ request }) => {
    const identity = uniqueIdentity();
    const updatedUsername = `proxy_updated_${Date.now()}`;

    const registerResponse = await request.post('/api/auth/register', {
      data: {
        email: identity.email,
        username: identity.username,
        full_name: 'Proxy Flow Test',
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

    const meGetResponse = await request.get('/api/me');
    expect(meGetResponse.status()).toBe(200);
    const me = (await meGetResponse.json()) as {
      email: string;
      username: string;
      full_name: string;
    };
    expect(me.email).toBe(identity.email);
    expect(me.username).toBe(identity.username);

    const mePatchResponse = await request.patch('/api/me', {
      data: {
        full_name: 'Proxy Flow Updated Name',
        username: updatedUsername,
      },
    });
    expect(mePatchResponse.status()).toBe(200);
    const patchedMe = (await mePatchResponse.json()) as {
      email: string;
      username: string;
      full_name: string;
    };
    expect(patchedMe.email).toBe(identity.email);
    expect(patchedMe.full_name).toBe('Proxy Flow Updated Name');
    expect(patchedMe.username).toBe(updatedUsername);

    const prefGetResponse = await request.get('/api/preferences');
    expect(prefGetResponse.status()).toBe(200);
    const prefs = (await prefGetResponse.json()) as {
      source_language: string;
      transliteration_script: string;
    };
    expect(prefs.source_language).toBeTruthy();
    expect(prefs.transliteration_script).toBeTruthy();

    const prefPatchResponse = await request.patch('/api/preferences', {
      data: {
        source_language: 'sanskrit',
        transliteration_enabled: true,
        transliteration_script: 'iast',
        show_roman_transliteration: true,
        show_only_preferred_script: true,
        preview_show_titles: true,
        preview_show_labels: true,
        preview_show_details: true,
        preview_show_sanskrit: true,
        preview_show_transliteration: true,
        preview_show_english: false,
        preview_transliteration_script: 'harvard_kyoto',
      },
    });
    expect(prefPatchResponse.status()).toBe(200);
    const updatedPrefs = (await prefPatchResponse.json()) as {
      source_language: string;
      transliteration_script: string;
      show_roman_transliteration: boolean;
      show_only_preferred_script: boolean;
      preview_show_titles: boolean;
      preview_show_labels: boolean;
      preview_show_details: boolean;
      preview_show_sanskrit: boolean;
      preview_show_transliteration: boolean;
      preview_show_english: boolean;
      preview_transliteration_script: string;
    };
    expect(updatedPrefs.source_language).toBe('sanskrit');
    expect(updatedPrefs.transliteration_script).toBe('iast');
    expect(updatedPrefs.show_roman_transliteration).toBe(true);
    expect(updatedPrefs.show_only_preferred_script).toBe(true);
    expect(updatedPrefs.preview_show_titles).toBe(true);
    expect(updatedPrefs.preview_show_labels).toBe(true);
    expect(updatedPrefs.preview_show_details).toBe(true);
    expect(updatedPrefs.preview_show_sanskrit).toBe(true);
    expect(updatedPrefs.preview_show_transliteration).toBe(true);
    expect(updatedPrefs.preview_show_english).toBe(false);
    expect(updatedPrefs.preview_transliteration_script).toBe('harvard_kyoto');

    const compilationResponse = await request.post('/api/compilations', {
      data: {
        title: 'Proxy Compilation Test',
        description: 'Created by Playwright proxy route test',
        schema_type: 'custom',
        items: [{ node_id: 1, order: 1 }],
        metadata: { source: 'playwright-proxy-test' },
        status: 'draft',
        is_public: false,
      },
    });
    expect(compilationResponse.status()).toBe(201);
    const compilation = (await compilationResponse.json()) as {
      id: number;
      title: string;
      status: string;
    };
    expect(typeof compilation.id).toBe('number');
    expect(compilation.title).toBe('Proxy Compilation Test');
    expect(compilation.status).toBe('draft');
  });

  test('unauthenticated preferences and compilation routes are protected', async ({ playwright }) => {
    const freshContext = await playwright.request.newContext({
      baseURL: 'http://localhost:3000',
    });

    const prefResponse = await freshContext.get('/api/preferences');
    expect(prefResponse.status()).toBe(401);

    const compilationResponse = await freshContext.post('/api/compilations', {
      data: {
        title: 'Unauthorized',
        schema_type: 'custom',
        items: [{ node_id: 1, order: 1 }],
      },
    });
    expect(compilationResponse.status()).toBe(401);

    await freshContext.dispose();
  });
});
