import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, hasDatabase, type TestApp } from '../testing';
import { errorHandler, httpError } from './errors';
import {
  PERMISSIONS_POLICY,
  STARTER_EMBED_ORIGINS,
  contentSecurityPolicy,
  frameSourceList,
  registerFrameSources,
  securityHeaders,
  type SecurityHeadersOptions,
} from './security';

/** The CSP as { directive: sources }. */
function directives(policy: string | string[] | number | undefined): Record<string, string[]> {
  expect(typeof policy).toBe('string');
  return Object.fromEntries(
    String(policy)
      .split(';')
      .map((part) => part.trim().split(/\s+/))
      .map(([name = '', ...sources]) => [name, sources]),
  );
}

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': PERMISSIONS_POLICY,
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
};

function expectSecurityHeaders(headers: Record<string, unknown>, what: string): void {
  expect(headers, what).toMatchObject(SECURITY_HEADERS);
  expect(directives(headers['content-security-policy'] as string)['default-src'], what).toEqual([
    "'self'",
  ]);
  expect(headers['cross-origin-embedder-policy'], what).toBeUndefined();
}

async function smallApp(options: SecurityHeadersOptions = {}): Promise<FastifyInstance> {
  const app = Fastify();
  app.setErrorHandler(errorHandler);
  await app.register(securityHeaders, options);
  app.get('/api/thing', async () => ({ ok: true }));
  app.get('/api/broken', async () => {
    throw httpError(403, 'forbidden');
  });
  app.get('/api/crash', async () => {
    throw new Error('Fictional crash');
  });
  app.get('/api/sandboxed', async (_request, reply) =>
    reply.header('content-security-policy', 'sandbox').send('fictional file'),
  );
  app.get('/sw.js', async (_request, reply) =>
    reply.header('cache-control', 'public, max-age=0').type('text/javascript').send('// sw'),
  );
  app.get('/theme-init.js', async (_request, reply) =>
    reply.header('cache-control', 'public, max-age=0').type('text/javascript').send('// theme'),
  );
  return app;
}

const apps: FastifyInstance[] = [];
async function appWith(options: SecurityHeadersOptions = {}): Promise<FastifyInstance> {
  const app = await smallApp(options);
  apps.push(app);
  return app;
}

afterEach(() => {
  registerFrameSources('fictional-lane', []);
  registerFrameSources('other-lane', []);
});

afterAll(async () => {
  await Promise.all(apps.map((app) => app.close()));
});

describe('the Content-Security-Policy', () => {
  it('is the strict policy from decision 0007', () => {
    const policy = directives(contentSecurityPolicy());
    expect(policy).toEqual({
      'default-src': ["'self'"],
      'script-src': ["'self'", "'wasm-unsafe-eval'"],
      'style-src': ["'self'", "'unsafe-inline'"],
      'img-src': ["'self'", 'data:', 'blob:'],
      'media-src': ["'self'", 'blob:'],
      'connect-src': ["'self'"],
      'worker-src': ["'self'"],
      'manifest-src': ["'self'"],
      'frame-src': frameSourceList(),
      'object-src': ["'none'"],
      'base-uri': ["'none'"],
      'form-action': ["'self'"],
      'frame-ancestors': ["'none'"],
    });
  });

  it('lets pages frame the starter list of embed sites', () => {
    const frames = directives(contentSecurityPolicy())['frame-src'];
    expect(frames).toEqual(expect.arrayContaining([...STARTER_EMBED_ORIGINS]));
    expect(frames).toEqual([...new Set(frames)].sort());
  });

  it('never allows inline scripts, eval or blob: workers', () => {
    const policy = contentSecurityPolicy('wss://carehub.example.test');
    expect(policy).not.toContain("'unsafe-eval'");
    expect(directives(policy)['script-src']).not.toContain("'unsafe-inline'");
    expect(directives(policy)['worker-src']).toEqual(["'self'"]);
    expect(policy).not.toMatch(/[\r\n,]/);
  });

  it('adds the WebSocket origin to connect-src', () => {
    expect(directives(contentSecurityPolicy('wss://carehub.example.test'))['connect-src']).toEqual([
      "'self'",
      'wss://carehub.example.test',
    ]);
  });
});

describe('registerFrameSources', () => {
  it("adds a lane's origins to frame-src, once each", () => {
    registerFrameSources('fictional-lane', [
      'https://player.example.com',
      'https://*.media.example.org',
      'https://videos.example.net:8443',
      'https://www.youtube-nocookie.com',
    ]);
    const frames = directives(contentSecurityPolicy())['frame-src'];
    expect(frames).toEqual(
      expect.arrayContaining([
        ...STARTER_EMBED_ORIGINS,
        'https://player.example.com',
        'https://*.media.example.org',
        'https://videos.example.net:8443',
      ]),
    );
    expect(frames?.filter((source) => source === 'https://www.youtube-nocookie.com')).toHaveLength(
      1,
    );
  });

  it("replaces the feature's earlier list, and an empty list removes it", () => {
    registerFrameSources('fictional-lane', ['https://one.example.com']);
    registerFrameSources('other-lane', ['https://two.example.com']);
    registerFrameSources('fictional-lane', ['https://three.example.com']);
    expect(frameSourceList()).toContain('https://three.example.com');
    expect(frameSourceList()).toContain('https://two.example.com');
    expect(frameSourceList()).not.toContain('https://one.example.com');
    registerFrameSources('fictional-lane', []);
    expect(frameSourceList()).not.toContain('https://three.example.com');
  });

  it('writes host names in lowercase', () => {
    registerFrameSources('fictional-lane', ['https://Player.Example.COM']);
    expect(frameSourceList()).toContain('https://player.example.com');
  });

  it.each([
    'http://player.example.com',
    'wss://player.example.com',
    '//player.example.com',
    'player.example.com',
    'https://player.example.com/',
    'https://player.example.com/embed',
    'https://player.example.com?x=1',
    'https://player.example.com#top',
    'https://user@player.example.com',
    'https://*',
    'https://*.com',
    'https://*example.com',
    'https://media.*.example.com',
    'https://*.*.example.com',
    'https://10.0.0.1',
    'https://[::1]',
    'https://localhost',
    'https://player.example.com:0',
    'https://player.example.com:65536',
    'https://player.example.com.',
    'https://-player.example.com',
    'https://player_one.example.com',
    'https://player.example.com https://other.example.com',
    'https://player.example.com; script-src *',
    "https://player.example.com 'unsafe-inline'",
    'https://player.example.com\r\nx-injected: 1',
    '*',
    "'self'",
    'https:',
    '',
  ])('refuses %j', (origin) => {
    const before = frameSourceList();
    expect(() => registerFrameSources('fictional-lane', [origin])).toThrow(TypeError);
    expect(() =>
      registerFrameSources('fictional-lane', ['https://player.example.com', origin]),
    ).toThrow(TypeError);
    expect(frameSourceList()).toEqual(before);
  });

  it('needs a feature name', () => {
    expect(() => registerFrameSources('', ['https://player.example.com'])).toThrow(TypeError);
  });

  it('is used by apps that are already running', async () => {
    const app = await appWith();
    registerFrameSources('fictional-lane', ['https://late.example.com']);
    const response = await app.inject({ method: 'GET', url: '/api/thing' });
    expect(directives(response.headers['content-security-policy'])['frame-src']).toContain(
      'https://late.example.com',
    );
  });
});

describe('security headers', () => {
  it('are on answers, errors and 404s', async () => {
    const app = await appWith();
    for (const url of ['/api/thing', '/api/broken', '/api/crash', '/api/missing', '/missing']) {
      const response = await app.inject({ method: 'GET', url });
      expectSecurityHeaders(response.headers, url);
    }
    const head = await app.inject({ method: 'HEAD', url: '/api/thing' });
    expectSecurityHeaders(head.headers, 'HEAD');
  });

  it("keep a route's own Content-Security-Policy", async () => {
    const app = await appWith();
    const response = await app.inject({ method: 'GET', url: '/api/sandboxed' });
    expect(response.headers['content-security-policy']).toBe('sandbox');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('send HSTS only when Care Hub is served over HTTPS', async () => {
    const hsts = async (options: SecurityHeadersOptions, headers: Record<string, string> = {}) =>
      (await (await appWith(options)).inject({ method: 'GET', url: '/api/thing', headers }))
        .headers['strict-transport-security'];
    expect(await hsts({ publicUrl: 'https://carehub.example.test' })).toBe('max-age=31536000');
    expect(await hsts({ publicUrl: 'http://127.0.0.1:3000' })).toBeUndefined();
    expect(await hsts({})).toBeUndefined();
    // Without a trusted proxy, anybody could send the header.
    expect(await hsts({}, { 'x-forwarded-proto': 'https' })).toBeUndefined();
  });

  it('allow the WebSocket origin of the public address', async () => {
    const connect = async (publicUrl?: string) =>
      directives(
        (await (await appWith({ publicUrl })).inject({ method: 'GET', url: '/api/thing' })).headers[
          'content-security-policy'
        ],
      )['connect-src'];
    expect(await connect('https://carehub.example.test')).toEqual([
      "'self'",
      'wss://carehub.example.test',
    ]);
    expect(await connect('http://127.0.0.1:3000/')).toEqual(["'self'", 'ws://127.0.0.1:3000']);
    expect(await connect()).toEqual(["'self'"]);
  });

  it('serve /sw.js with Cache-Control: no-cache, and nothing else', async () => {
    const app = await appWith();
    for (const url of ['/sw.js', '/sw.js?v=2']) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.headers['cache-control'], url).toBe('no-cache');
      expectSecurityHeaders(response.headers, url);
    }
    const other = await app.inject({ method: 'GET', url: '/theme-init.js' });
    expect(other.headers['cache-control']).toBe('public, max-age=0');
  });
});

describe.skipIf(!hasDatabase)('security headers in the whole server', () => {
  let testApp: TestApp;
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'carehub-security-test-'));
    await writeFile(join(dir, 'index.html'), '<!doctype html><title>Care Hub</title><main></main>');
    await writeFile(join(dir, 'sw.js'), "self.addEventListener('push', () => {});");
    testApp = await createTestApp({
      env: { WEB_DIST_DIR: dir, CAREHUB_PUBLIC_URL: 'https://carehub.example.test' },
      routes: (app) => {
        app.get('/api/test/private', async () => ({ ok: true }));
      },
    });
  });

  afterAll(async () => {
    await testApp?.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('are on the web app, the API, its errors and 404s', async () => {
    for (const url of ['/', '/settings', '/api/health', '/api/test/private', '/api/missing']) {
      const response = await testApp.app.inject({ method: 'GET', url });
      expectSecurityHeaders(response.headers, url);
      expect(response.headers['strict-transport-security'], url).toBe('max-age=31536000');
      expect(directives(response.headers['content-security-policy'])['connect-src'], url).toEqual([
        "'self'",
        'wss://carehub.example.test',
      ]);
    }
    expect((await testApp.app.inject({ method: 'GET', url: '/api/test/private' })).statusCode).toBe(
      401,
    );
  });

  it('serve the service worker with Cache-Control: no-cache', async () => {
    const response = await testApp.app.inject({ method: 'GET', url: '/sw.js' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-cache');
    expectSecurityHeaders(response.headers, '/sw.js');
  });
});
