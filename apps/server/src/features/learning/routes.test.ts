import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, hasDatabase, type TestApp } from '../../testing';

const NOT_FOUND = {
  error: { code: 'not_found', message: 'This was deleted, or the link is wrong.' },
};

describe.skipIf(!hasDatabase)('Learning API mount', () => {
  let server: TestApp;

  beforeAll(async () => {
    server = await createTestApp();
  });

  afterAll(async () => {
    await server?.close();
  });

  it('answers unknown paths under /api/learning with a 404 in the error shape', async () => {
    const urls = ['/api/learning/nothing-here', '/api/learning/courses/c1/x', '/api/learning'];
    for (const url of [...urls, '/api/learningx']) {
      const response = await server.app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual(NOT_FOUND);
    }
  });
});
