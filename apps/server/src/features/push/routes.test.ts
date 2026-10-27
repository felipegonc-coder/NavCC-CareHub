import { timePart, toCivil } from '@carehub/team-time';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { errorHandler } from '../../core/errors';
import { createTestApp, createUser, hasDatabase, injectAs } from '../../testing';
import { createTestSubscription, type TestSubscription } from './protocol/testing';
import { generateVapidKeys } from './protocol/vapid';
import pushRoutes, { TEST_COOLDOWN_MS } from './routes';
import { PUSH_OFF_MESSAGE, resolvePushConfig, type PushConfig } from './settings';
import { createMemoryPushStore, type MemoryPushStore } from './testing';

const avery = '0b8f3c52-6d1e-4a7b-9c2d-1e5f7a9b3c41';
const sam = '5c2e9a17-3f4b-4d6c-8e1a-7b9d2f4c6e83';
const chrome =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const endpoint = 'https://fcm.googleapis.com/fcm/send/fictional-laptop';

let app: FastifyInstance | undefined;
let store: MemoryPushStore;
let clock = Date.UTC(2026, 9, 27, 15, 0);
const sent: { endpoint: string; body: Uint8Array }[] = [];

function on(): PushConfig {
  const keys = generateVapidKeys();
  return resolvePushConfig({
    PUSH_VAPID_PUBLIC_KEY: keys.publicKey,
    PUSH_VAPID_PRIVATE_KEY: keys.privateKey,
    PUSH_VAPID_SUBJECT: 'mailto:care-team@example.org',
  });
}

async function build(config: PushConfig = on()): Promise<FastifyInstance> {
  store = createMemoryPushStore();
  sent.length = 0;
  app = Fastify();
  app.setErrorHandler(errorHandler);
  await app.register(pushRoutes, {
    prefix: '/api/push',
    store,
    config,
    now: () => new Date(clock),
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      sent.push({ endpoint: String(input), body: init?.body as Uint8Array });
      return new Response(null, { status: 201 });
    }) as typeof fetch,
    getUserId: (request) => {
      const user = request.headers['x-test-user'];
      return typeof user === 'string' ? user : null;
    },
    getTimeZone: (request) => {
      const zone = request.headers['x-test-zone'];
      return typeof zone === 'string' ? zone : null;
    },
  });
  return app;
}

function call(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  user?: string,
  body?: Record<string, unknown>,
  timeZone?: string,
) {
  if (!app) throw new Error('Call build() first.');
  const headers: Record<string, string> = { 'user-agent': chrome };
  if (user) headers['x-test-user'] = user;
  if (timeZone) headers['x-test-zone'] = timeZone;
  return app.inject({
    method,
    url: `/api/push${url}`,
    headers,
    ...(body ? { payload: body } : {}),
  });
}

function subscribe(user: string, browser: TestSubscription, at = endpoint, extra = {}) {
  return call('POST', '/subscriptions', user, {
    endpoint: at,
    expirationTime: null,
    keys: browser.keys,
    ...extra,
  });
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('push routes', () => {
  it('need a signed-in person', async () => {
    await build();
    for (const [method, url] of [
      ['GET', '/key'],
      ['GET', '/subscriptions'],
      ['DELETE', '/subscriptions'],
      ['POST', '/test'],
      ['GET', '/preferences'],
      ['PUT', '/pause'],
      ['DELETE', '/pause'],
    ] as const) {
      const response = await call(method, url);
      expect(response.statusCode, url).toBe(401);
      expect(response.json()).toMatchObject({ error: { code: 'signed_out' } });
    }
  });
});

describe('GET /api/push/key', () => {
  it('gives the public key while push is on, and null while it is off', async () => {
    const config = on();
    await build(config);
    const key = config.enabled ? config.publicKey : '';
    expect((await call('GET', '/key', avery)).json()).toEqual({ publicKey: key });
    await app?.close();
    await build(resolvePushConfig({}));
    expect((await call('GET', '/key', avery)).json()).toEqual({ publicKey: null });
  });
});

describe('/api/push/subscriptions', () => {
  it('saves this browser and lists it without its endpoint or keys', async () => {
    await build();
    const browser = createTestSubscription();
    const response = await subscribe(avery, browser);
    expect(response.statusCode).toBe(201);
    const { subscription } = response.json();
    expect(Object.keys(subscription).sort()).toEqual(['createdAt', 'device', 'id', 'lastUsedAt']);
    expect(subscription).toMatchObject({
      device: 'Chrome on Windows',
      createdAt: '2026-10-27T15:00:00.000Z',
      lastUsedAt: '2026-10-27T15:00:00.000Z',
    });
    expect(store.subscriptions).toMatchObject([{ userId: avery, endpoint, keys: browser.keys }]);
    const list = await call('GET', '/subscriptions', avery);
    expect(list.json()).toEqual({ subscriptions: [subscription] });
    expect(list.body).not.toContain('fcm.googleapis.com');
    expect((await call('GET', '/subscriptions', sam)).json()).toEqual({ subscriptions: [] });
  });

  it('refuses endpoints outside the push services, and unusable keys', async () => {
    await build();
    const browser = createTestSubscription();
    const elsewhere = await subscribe(avery, browser, 'https://203.0.113.7/push');
    expect(elsewhere.statusCode).toBe(400);
    expect(elsewhere.json()).toMatchObject({
      error: {
        code: 'invalid',
        message: "Care Hub only sends notifications through the browsers' own push services.",
      },
    });
    const badKeys = await call('POST', '/subscriptions', avery, {
      endpoint,
      keys: { p256dh: browser.keys.auth, auth: browser.keys.auth },
    });
    expect(badKeys.statusCode).toBe(400);
    expect(store.subscriptions).toEqual([]);
  });

  it('answers 409 with the plain message while push is off', async () => {
    await build(resolvePushConfig({}));
    const response = await subscribe(avery, createTestSubscription());
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: { code: 'conflict', message: PUSH_OFF_MESSAGE },
    });
    const test = await call('POST', '/test', avery);
    expect(test.statusCode).toBe(409);
    expect(test.json()).toMatchObject({ error: { message: PUSH_OFF_MESSAGE } });
  });

  it('deletes this browser by endpoint, and another device by id', async () => {
    await build();
    await subscribe(avery, createTestSubscription());
    const phone = (
      await subscribe(avery, createTestSubscription(), 'https://web.push.apple.com/fictional-phone')
    ).json().subscription;
    expect((await call('DELETE', '/subscriptions', avery, { endpoint })).statusCode).toBe(204);
    expect((await call('DELETE', `/subscriptions/${phone.id}`, sam)).statusCode).toBe(404);
    expect((await call('DELETE', '/subscriptions/not-an-id', avery)).statusCode).toBe(404);
    expect((await call('DELETE', `/subscriptions/${phone.id}`, avery)).statusCode).toBe(204);
    expect(store.subscriptions).toEqual([]);
  });
});

describe('POST /api/push/test', () => {
  it("sends a test notification to the person's browsers, then waits before another", async () => {
    await build();
    const browser = createTestSubscription();
    await subscribe(avery, browser);
    const response = await call('POST', '/test', avery);
    expect(response.json()).toEqual({ sent: 1, removed: 0, failed: 0 });
    expect(sent.map((request) => request.endpoint)).toEqual([endpoint]);
    expect(
      JSON.parse(new TextDecoder().decode(browser.decrypt(sent[0]?.body ?? new Uint8Array()))),
    ).toEqual({
      title: 'Care Hub',
      body: 'Test notification · Notifications work on this device.',
      url: '/settings/notifications',
      tag: 'push-test',
    });
    const again = await call('POST', '/test', avery);
    expect(again.statusCode).toBe(429);
    expect(again.json()).toMatchObject({ error: { code: 'rate_limited' } });
    expect((await call('POST', '/test', sam)).json()).toEqual({ sent: 0, removed: 0, failed: 0 });
    clock += TEST_COOLDOWN_MS;
    expect((await call('POST', '/test', avery)).statusCode).toBe(200);
  });
});

describe('/api/push/preferences', () => {
  it('starts from the defaults and changes only what is sent', async () => {
    await build();
    expect((await call('GET', '/preferences', avery)).json()).toEqual({
      preferences: { notifyAbout: 'all', showText: true, pause: null },
    });
    const changed = await call('PATCH', '/preferences', avery, { showText: false });
    expect(changed.json()).toEqual({
      preferences: { notifyAbout: 'all', showText: false, pause: null },
    });
    expect((await call('GET', '/preferences', avery)).json()).toEqual(changed.json());
    expect((await call('GET', '/preferences', sam)).json()).toEqual({
      preferences: { notifyAbout: 'all', showText: true, pause: null },
    });
    const unknown = await call('PATCH', '/preferences', avery, { notifyAbout: 'everything' });
    expect(unknown.statusCode).toBe(400);
  });
});

describe('/api/push/pause', () => {
  const HOUR = 60 * 60 * 1000;
  const pauseOf = async (user: string) =>
    (await call('GET', '/preferences', user)).json().preferences.pause;

  beforeEach(() => {
    clock = Date.UTC(2026, 9, 27, 15, 0); // 9:00 AM in Denver
  });

  it('pauses for an hour, which then reads as no pause', async () => {
    await build();
    const until = new Date(clock + HOUR).toISOString();
    const paused = await call('PUT', '/pause', avery, { ends: 'in_an_hour' });
    expect(paused.json()).toEqual({
      preferences: { notifyAbout: 'all', showText: true, pause: { until } },
    });
    expect(await pauseOf(avery)).toEqual({ until });
    expect(await pauseOf(sam)).toBeNull();
    clock += HOUR;
    expect(await pauseOf(avery)).toBeNull();
  });

  it("pauses until 8:00 AM tomorrow in the person's time zone", async () => {
    await build();
    const london = await call('PUT', '/pause', sam, { ends: 'tomorrow_8am' }, 'Europe/London');
    expect(london.json().preferences.pause).toEqual({ until: '2026-10-28T08:00:00.000Z' });
    // Without a time zone: America/Denver.
    const denver = await call('PUT', '/pause', avery, { ends: 'tomorrow_8am' });
    expect(denver.json().preferences.pause).toEqual({ until: '2026-10-28T14:00:00.000Z' });
  });

  it('pauses until turned back on, also while push is off, and turns back on', async () => {
    await build(resolvePushConfig({}));
    await call('PATCH', '/preferences', avery, { notifyAbout: 'mentions' });
    const paused = await call('PUT', '/pause', avery, { ends: 'when_turned_on' });
    expect(paused.json().preferences.pause).toEqual({ until: null });
    clock += 30 * 24 * HOUR;
    expect(await pauseOf(avery)).toEqual({ until: null });
    const resumed = await call('DELETE', '/pause', avery);
    expect(resumed.json()).toEqual({
      preferences: { notifyAbout: 'mentions', showText: true, pause: null },
    });
    expect(await pauseOf(avery)).toBeNull();
  });

  it('refuses other lengths, and settings changes leave a pause alone', async () => {
    await build();
    for (const body of [{ ends: 'forever' }, { until: '2026-10-27T16:00:00.000Z' }, {}]) {
      const refused = await call('PUT', '/pause', avery, body);
      expect(refused.statusCode, JSON.stringify(body)).toBe(400);
      expect(refused.json()).toMatchObject({ error: { code: 'invalid' } });
    }
    const viaSettings = await call('PATCH', '/preferences', avery, { pause: null });
    expect(viaSettings.statusCode).toBe(400);
    expect(await pauseOf(avery)).toBeNull();

    await call('PUT', '/pause', avery, { ends: 'in_an_hour' });
    await call('PATCH', '/preferences', avery, { showText: false });
    expect(await pauseOf(avery)).toEqual({ until: new Date(clock + HOUR).toISOString() });
  });
});

describe.skipIf(!hasDatabase)('/api/push in the app', () => {
  it('is registered behind sign-in, with push off until the keys are set', async () => {
    const testApp = await createTestApp();
    try {
      const riley = await createUser(testApp.db, { name: 'Riley Chen' });
      const signedOut = await testApp.app.inject({ method: 'GET', url: '/api/push/key' });
      expect(signedOut.statusCode).toBe(401);
      const key = await injectAs(testApp.app, riley, { method: 'GET', url: '/api/push/key' });
      expect(key.json()).toEqual({ publicKey: null });
      const saved = await injectAs(testApp.app, riley, {
        method: 'PATCH',
        url: '/api/push/preferences',
        payload: { notifyAbout: 'mentions' },
      });
      expect(saved.json()).toEqual({
        preferences: { notifyAbout: 'mentions', showText: true, pause: null },
      });
      // Riley has the default time zone, America/Denver.
      const paused = await injectAs(testApp.app, riley, {
        method: 'PUT',
        url: '/api/push/pause',
        payload: { ends: 'tomorrow_8am' },
      });
      const { until } = paused.json().preferences.pause;
      expect(timePart(toCivil(new Date(until), 'America/Denver'))).toBe('08:00');
      const resumed = await injectAs(testApp.app, riley, {
        method: 'DELETE',
        url: '/api/push/pause',
      });
      expect(resumed.json().preferences).toEqual({
        notifyAbout: 'mentions',
        showText: true,
        pause: null,
      });
    } finally {
      await testApp.close();
    }
  });
});
