import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import { loadConfig, testHooksEnabled } from '../config';
import { createTestApp, hasDatabase } from '../testing';
import { isTestHookRoute, registerTestHooks } from './test-hooks';

const DATABASE_URL = 'postgres://carehub@localhost:5432/carehub';
/** Test hooks on, as the browser tests start the server. */
const ON = {
  CAREHUB_TEST_HOOKS: '1',
  HOST: '127.0.0.1',
  CAREHUB_PUBLIC_URL: 'http://127.0.0.1:38080',
};
const REFUSED = /The test hooks work only on this computer/;

describe('testHooksEnabled', () => {
  it('is true only for exactly "1"', () => {
    expect(testHooksEnabled({ CAREHUB_TEST_HOOKS: '1' })).toBe(true);
    for (const value of [undefined, '0', 'true', 'yes', ' 1', '1 ']) {
      expect(testHooksEnabled({ CAREHUB_TEST_HOOKS: value }), String(value)).toBe(false);
    }
  });
});

describe('loadConfig with the test hooks on', () => {
  const load = (env: Record<string, string | undefined>) => loadConfig({ DATABASE_URL, ...env });

  it('starts when only this computer can reach the server', () => {
    expect(testHooksEnabled(load(ON))).toBe(true);
    expect(testHooksEnabled(load({ ...ON, NODE_ENV: 'production' }))).toBe(true);
    expect(
      testHooksEnabled(load({ ...ON, HOST: '::1', CAREHUB_PUBLIC_URL: 'http://localhost:5173' })),
    ).toBe(true);
    expect(
      testHooksEnabled(load({ ...ON, HOST: 'localhost', CAREHUB_PUBLIC_URL: 'http://[::1]:3000' })),
    ).toBe(true);
  });

  it('refuses to start where others could reach it', () => {
    for (const env of [
      { ...ON, HOST: '0.0.0.0' },
      { ...ON, HOST: '::' },
      { ...ON, HOST: '192.168.1.20' },
      { CAREHUB_TEST_HOOKS: '1', CAREHUB_PUBLIC_URL: 'http://127.0.0.1:38080' },
      { CAREHUB_TEST_HOOKS: '1', HOST: '127.0.0.1' },
      { ...ON, CAREHUB_PUBLIC_URL: 'https://carehub.example.test' },
      { ...ON, CAREHUB_PUBLIC_URL: 'http://192.168.1.20:3000' },
    ]) {
      expect(() => load(env), JSON.stringify(env)).toThrow(REFUSED);
    }
  });

  it('checks nothing while they are off', () => {
    expect(testHooksEnabled(load({ HOST: '0.0.0.0' }))).toBe(false);
    expect(
      testHooksEnabled(
        load({ CAREHUB_TEST_HOOKS: '0', CAREHUB_PUBLIC_URL: 'https://carehub.example.test' }),
      ),
    ).toBe(false);
  });
});

describe('isTestHookRoute', () => {
  it('matches /api/<feature>/test/... only', () => {
    for (const url of [
      '/api/learning/test/reminders',
      '/api/learning/test/assignments/:id',
      '/api/jobs/test/periodic/:name',
      '/api/example/TEST/x',
    ]) {
      expect(isTestHookRoute(url), url).toBe(true);
    }
    for (const url of [
      '/api/push/test',
      '/api/test/private',
      '/api/learning/tests/x',
      '/api/learning/courses/test/x',
      '/test/x',
      '/learning/test/x',
    ]) {
      expect(isTestHookRoute(url), url).toBe(false);
    }
  });
});

describe('registerTestHooks', () => {
  /** A bare app with the switch, and `routes` in a feature plugin at `prefix`. */
  async function start(
    enabled: boolean,
    routes: (feature: FastifyInstance) => void,
    prefix = '/api/example',
  ) {
    const app = Fastify();
    registerTestHooks(app, enabled);
    await app.register(async (feature) => routes(feature), { prefix });
    await app.ready();
    return app;
  }

  it('stops start-up when a test hook is registered while they are off', async () => {
    await expect(
      start(false, (feature) => feature.post('/test/reminders', async () => ({ sent: 0 }))),
    ).rejects.toThrow('/api/example/test/reminders is a test hook');
  });

  it('lets protected test hooks in while they are on', async () => {
    const app = await start(true, (feature) => {
      feature.post('/test/reminders', async () => ({ sent: 0 }));
      feature.post('/test/assignments/:id', async () => ({}));
    });
    expect(app.testHooks).toBe(true);
    expect(app.hasRoute({ method: 'POST', url: '/api/example/test/assignments/:id' })).toBe(true);
    await app.close();
  });

  it('refuses a public test hook', async () => {
    await expect(
      start(true, (feature) =>
        feature.post('/test/open', { config: { public: true } }, async () => ({})),
      ),
    ).rejects.toThrow("/api/example/test/open is a test hook, so it can't be public");
  });

  it('leaves ordinary routes alone, such as POST /api/push/test', async () => {
    const app = await start(
      false,
      (feature) => feature.post('/test', async () => ({ sent: true })),
      '/api/push',
    );
    expect(app.testHooks).toBe(false);
    expect(app.hasRoute({ method: 'POST', url: '/api/push/test' })).toBe(true);
    await app.close();
  });
});

describe.skipIf(!hasDatabase)('the whole server', () => {
  it('has no test hooks while they are off', async () => {
    const { app, close } = await createTestApp();
    try {
      expect(app.testHooks).toBe(false);
      expect(app.hasRoute({ method: 'POST', url: '/api/learning/test/reminders' })).toBe(false);
      expect(app.hasRoute({ method: 'POST', url: '/api/learning/test/assignments/:id' })).toBe(
        false,
      );
    } finally {
      await close();
    }
  });

  it('refuses to start with a test hook while they are off', async () => {
    const routes = (app: FastifyInstance) => {
      app.post('/api/example/test/thing', async () => ({ ok: true }));
    };
    await expect(createTestApp({ routes })).rejects.toThrow(
      '/api/example/test/thing is a test hook',
    );
  });

  it('keeps a test hook behind sign-in while they are on', async () => {
    const { app, close } = await createTestApp({
      env: ON,
      routes: (instance) => {
        instance.post('/api/example/test/thing', async () => ({ ok: true }));
      },
    });
    try {
      expect(app.testHooks).toBe(true);
      expect(
        (await app.inject({ method: 'POST', url: '/api/example/test/thing' })).statusCode,
      ).toBe(401);
    } finally {
      await close();
    }
  });
});
