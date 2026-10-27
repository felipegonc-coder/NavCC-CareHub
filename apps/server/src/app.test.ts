import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { healthResponseSchema } from '@carehub/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, hasDatabase, type TestApp } from './testing';

const INDEX_HTML =
  '<!doctype html><html lang="en"><title>Care Hub</title><main><h1>Care Hub</h1></main></html>';

const tempDirs: string[] = [];
const testApps: TestApp[] = [];
let app: FastifyInstance;
let appWithoutWeb: FastifyInstance;

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'carehub-server-test-'));
  tempDirs.push(dir);
  return dir;
}

// The server needs Postgres (CI provides DATABASE_URL).
beforeAll(async () => {
  if (!hasDatabase) return;
  const webDistDir = await makeTempDir();
  await writeFile(join(webDistDir, 'index.html'), INDEX_HTML);
  await writeFile(join(webDistDir, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  const withWeb = await createTestApp({
    env: { WEB_DIST_DIR: webDistDir, CAREHUB_VERSION: '1.2.3' },
  });
  testApps.push(withWeb);
  app = withWeb.app;
  const withoutWeb = await createTestApp({ env: { WEB_DIST_DIR: await makeTempDir() } });
  testApps.push(withoutWeb);
  appWithoutWeb = withoutWeb.app;
});

afterAll(async () => {
  await Promise.all(testApps.map((testApp) => testApp.close()));
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe.skipIf(!hasDatabase)('GET /api/health', () => {
  it('reports ok and the version', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    expect(healthResponseSchema.parse(response.json())).toEqual({
      status: 'ok',
      version: '1.2.3',
    });
  });
});

describe.skipIf(!hasDatabase)('unknown API routes', () => {
  async function expectJson404(method: 'GET' | 'POST', url: string): Promise<void> {
    const response = await app.inject({ method, url });
    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toMatch(/^application\/json/);
    expect(response.json()).toEqual({
      error: { code: 'not_found', message: 'This was deleted, or the link is wrong.' },
    });
  }

  it('return a JSON 404 instead of the web app', async () => {
    await expectJson404('GET', '/api/does-not-exist');
    await expectJson404('GET', '/api/does-not-exist?page=2');
    await expectJson404('GET', '/api');
    await expectJson404('POST', '/api/health');
  });
});

describe.skipIf(!hasDatabase)('web app', () => {
  it('serves index.html at the root', async () => {
    const response = await app.inject({ method: 'GET', url: '/' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^text\/html/);
    expect(response.body).toContain('<h1>Care Hub</h1>');
  });

  it('falls back to index.html for page routes', async () => {
    for (const url of ['/pages/some-page', '/settings?tab=profile', '/apiary']) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode, url).toBe(200);
      expect(response.headers['content-type'], url).toMatch(/^text\/html/);
      expect(response.body, url).toContain('<h1>Care Hub</h1>');
    }
  });

  it('serves static files', async () => {
    const response = await app.inject({ method: 'GET', url: '/favicon.svg' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^image\/svg\+xml/);
  });

  it('returns 404 for missing files and non-GET requests', async () => {
    expect((await app.inject({ method: 'GET', url: '/assets/missing.js' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/pages/some-page' })).statusCode).toBe(404);
  });

  it('returns 404 for page routes when the web app is not built', async () => {
    const response = await appWithoutWeb.inject({ method: 'GET', url: '/pages/some-page' });
    expect(response.statusCode).toBe(404);
  });
});
