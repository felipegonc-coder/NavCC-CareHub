import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { loadConfig } from '../../config';

let app: FastifyInstance;
let webDistDir: string;

beforeAll(async () => {
  webDistDir = await mkdtemp(join(tmpdir(), 'carehub-learning-test-'));
  app = await buildApp({ config: loadConfig({ WEB_DIST_DIR: webDistDir }) });
});

afterAll(async () => {
  await app?.close();
  await rm(webDistDir, { recursive: true, force: true });
});

describe('Learning API mount', () => {
  it('answers unknown Learning paths in the Learning error shape', async () => {
    for (const url of [
      '/api/learning',
      '/api/learning/nothing-here',
      '/api/learning/courses/c1/x',
    ]) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({
        error: { code: 'not_found', message: 'This was deleted, or the link is wrong.' },
      });
    }
  });

  it('leaves paths outside /api/learning to the app', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/learningx' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ statusCode: 404, error: 'Not Found' });
  });
});
