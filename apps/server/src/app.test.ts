import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { healthResponseSchema } from '@carehub/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { loadConfig } from './config';

const INDEX_HTML =
  '<!doctype html><html lang="en"><title>Care Hub</title><main><h1>Care Hub</h1></main></html>';

const tempDirs: string[] = [];
let app: FastifyInstance;
let appWithoutWeb: FastifyInstance;

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'carehub-server-test-'));
  tempDirs.push(dir);
  return dir;
}

beforeAll(async () => {
  const webDistDir = await makeTempDir();
  await writeFile(join(webDistDir, 'index.html'), INDEX_HTML);
  await writeFile(join(webDistDir, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  app = await buildApp({
    config: loadConfig({ WEB_DIST_DIR: webDistDir, CAREHUB_VERSION: '1.2.3' }),
  });
  appWithoutWeb = await buildApp({ config: loadConfig({ WEB_DIST_DIR: await makeTempDir() }) });
});

afterAll(async () => {
  await Promise.all([app?.close(), appWithoutWeb?.close()]);
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('GET /api/health', () => {
  it('reports ok and the version', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    expect(healthResponseSchema.parse(response.json())).toEqual({
      status: 'ok',
      version: '1.2.3',
    });
  });
});

describe('unknown API routes', () => {
  async function expectJson404(method: 'GET' | 'POST', url: string): Promise<void> {
    const response = await app.inject({ method, url });
    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toMatch(/^application\/json/);
    expect(response.json()).toMatchObject({ statusCode: 404, error: 'Not Found' });
  }

  it('return a JSON 404 instead of the web app', async () => {
    await expectJson404('GET', '/api/does-not-exist');
    await expectJson404('GET', '/api/does-not-exist?page=2');
    await expectJson404('GET', '/api');
    await expectJson404('POST', '/api/health');
  });
});

describe('web app', () => {
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
