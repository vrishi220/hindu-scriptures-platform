import { expect, test } from '@playwright/test';

const backendUnavailableMode =
  process.env.EXPECT_BACKEND_UNAVAILABLE_TESTS === '1' ||
  process.env.API_BASE_URL?.includes('127.0.0.1:9999');

test.describe('API proxy routes backend unavailable', () => {
  test.skip(!backendUnavailableMode, 'Runs only when backend-unavailable mode is enabled');

  test('register route returns structured 502', async ({ request }) => {
    const response = await request.post('/api/auth/register', {
      data: {
        email: `down_${Date.now()}@example.com`,
        username: `down_${Date.now()}`,
        full_name: 'Backend Down Test',
        password: 'StrongPass123',
      },
    });

    expect(response.status()).toBe(502);
    const body = (await response.json()) as { detail?: string };
    expect(body.detail).toBe('Auth service unavailable. Please try again shortly.');
  });

  test('preferences and compilations routes return structured 502', async ({ playwright }) => {
    const freshContext = await playwright.request.newContext({
      baseURL: 'http://localhost:3000',
    });

    const prefResponse = await freshContext.get('/api/preferences');
    expect(prefResponse.status()).toBe(502);
    const prefBody = (await prefResponse.json()) as { detail?: string };
    expect(prefBody.detail).toBe('Auth/content service unavailable. Please try again shortly.');

    const compilationResponse = await freshContext.post('/api/compilations', {
      data: {
        title: 'Backend down compilation',
        schema_type: 'custom',
        items: [{ node_id: 1, order: 1 }],
      },
    });
    expect(compilationResponse.status()).toBe(502);
    const compilationBody = (await compilationResponse.json()) as { detail?: string };
    expect(compilationBody.detail).toBe('Auth/content service unavailable. Please try again shortly.');

    await freshContext.dispose();
  });
});
