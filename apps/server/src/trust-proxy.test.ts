import type { FastifyInstance } from 'fastify';
import { afterAll, describe, expect, it } from 'vitest';
import { loadConfig } from './config';
import { createTestApp, hasDatabase, type TestApp } from './testing';

const DATABASE_URL = 'postgres://carehub@localhost:5432/carehub';
const CADDY = '172.31.250.2';
const CLIENT = '203.0.113.7';

describe('TRUST_PROXY', () => {
  it('trusts no proxy when unset', () => {
    expect(loadConfig({ DATABASE_URL }).TRUST_PROXY).toBeUndefined();
  });

  it('takes an IP address, a CIDR range or a comma-separated list', () => {
    expect(loadConfig({ DATABASE_URL, TRUST_PROXY: CADDY }).TRUST_PROXY).toEqual([CADDY]);
    const list = loadConfig({ DATABASE_URL, TRUST_PROXY: ` 10.0.0.0/8, ${CADDY} ,::1, fd00::/8` });
    expect(list.TRUST_PROXY).toEqual(['10.0.0.0/8', CADDY, '::1', 'fd00::/8']);
  });

  it('rejects anything else, including "true" and hop counts', () => {
    const values = ['true', '1', '*', 'caddy', '300.1.1.1', '10.0.0.0/33', '::1/129', `${CADDY},`];
    for (const value of values) {
      expect(() => loadConfig({ DATABASE_URL, TRUST_PROXY: value })).toThrow(/TRUST_PROXY/);
    }
  });
});

// The whole server needs Postgres (CI provides DATABASE_URL).
describe.skipIf(!hasDatabase)('the client address', () => {
  const testApps: TestApp[] = [];

  afterAll(async () => {
    await Promise.all(testApps.map((testApp) => testApp.close()));
  });

  async function appWith(env: Record<string, string>): Promise<FastifyInstance> {
    const testApp = await createTestApp({
      env,
      routes: (app) => {
        app.get('/api/test/client-ip', { config: { public: true } }, async (request) => ({
          ip: request.ip,
        }));
      },
    });
    testApps.push(testApp);
    return testApp.app;
  }

  async function clientIp(app: FastifyInstance, remoteAddress: string): Promise<string> {
    const response = await app.inject({
      method: 'GET',
      url: '/api/test/client-ip',
      remoteAddress,
      headers: { 'x-forwarded-for': CLIENT },
    });
    expect(response.statusCode).toBe(200);
    return response.json<{ ip: string }>().ip;
  }

  it('ignores X-Forwarded-For when TRUST_PROXY is unset', async () => {
    const app = await appWith({});
    expect(await clientIp(app, CADDY)).toBe(CADDY);
    expect(await clientIp(app, '127.0.0.1')).toBe('127.0.0.1');
  });

  it('believes X-Forwarded-For only from the proxy in TRUST_PROXY', async () => {
    const app = await appWith({ TRUST_PROXY: CADDY });
    expect(await clientIp(app, CADDY)).toBe(CLIENT);
    expect(await clientIp(app, '198.51.100.20')).toBe('198.51.100.20');
  });
});
