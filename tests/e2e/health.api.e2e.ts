import { expect, test } from '@playwright/test';

// Runs in the desktop-light project only (see playwright.config.ts).
test('GET /api/health answers ok', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.ok()).toBe(true);
  expect(await response.json()).toMatchObject({ status: 'ok', version: expect.any(String) });
});
