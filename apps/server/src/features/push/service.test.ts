import { describe, expect, it } from 'vitest';
import type { PushNotice } from './payload';
import { createTestSubscription, type TestSubscription } from './protocol/testing';
import { generateVapidKeys } from './protocol/vapid';
import { topicFor } from './sender';
import { pushToUser, type PushRuntime } from './service';
import { resolvePushConfig } from './settings';
import { createMemoryPushStore } from './testing';

const now = new Date('2026-10-27T15:00:00Z');
const avery = '0b8f3c52-6d1e-4a7b-9c2d-1e5f7a9b3c41';
const notice: PushNotice = {
  kind: 'message',
  from: 'Riley Chen',
  text: 'Stand-up moved to 10:30.',
  url: '/messages/chat-1',
  tag: 'chat:chat-1',
};

function config() {
  const keys = generateVapidKeys();
  return resolvePushConfig({
    PUSH_VAPID_PUBLIC_KEY: keys.publicKey,
    PUSH_VAPID_PRIVATE_KEY: keys.privateKey,
    PUSH_VAPID_SUBJECT: 'mailto:care-team@example.org',
  });
}

async function setup(statusFor: (endpoint: string) => number = () => 201) {
  const store = createMemoryPushStore();
  const browsers = new Map<string, TestSubscription>();
  const requests: { endpoint: string; headers: Record<string, string>; body: Uint8Array }[] = [];
  const warnings: Record<string, unknown>[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const endpoint = String(input);
    requests.push({
      endpoint,
      headers: init?.headers as Record<string, string>,
      body: init?.body as Uint8Array,
    });
    return new Response(null, { status: statusFor(endpoint) });
  }) as typeof globalThis.fetch;
  const runtime: PushRuntime = {
    store,
    config: config(),
    fetch,
    now: () => now,
    log: { warn: (details) => warnings.push(details) },
  };
  async function addBrowser(name: string, expiresAt: Date | null = null) {
    const browser = createTestSubscription();
    const endpoint = `https://fcm.googleapis.com/fcm/send/${name}`;
    browsers.set(endpoint, browser);
    const earlier = new Date(now.getTime() - 60_000);
    return store.saveSubscription(
      { userId: avery, endpoint, keys: browser.keys, device: 'Chrome on Windows', expiresAt },
      earlier,
    );
  }
  const read = (request: { endpoint: string; body: Uint8Array } | undefined) => {
    const browser = request ? browsers.get(request.endpoint) : undefined;
    if (!request || !browser) throw new Error('No such request.');
    return JSON.parse(new TextDecoder().decode(browser.decrypt(request.body)));
  };
  return { store, runtime, requests, warnings, addBrowser, read };
}

describe('pushToUser', () => {
  it("sends to each of the person's browsers and marks them as used", async () => {
    const { store, runtime, requests, addBrowser, read } = await setup();
    await addBrowser('laptop');
    await addBrowser('phone');
    expect(await pushToUser(runtime, avery, notice)).toEqual({ sent: 2, removed: 0, failed: 0 });
    expect(requests.map((request) => request.endpoint).sort()).toEqual([
      'https://fcm.googleapis.com/fcm/send/laptop',
      'https://fcm.googleapis.com/fcm/send/phone',
    ]);
    for (const request of requests) {
      expect(read(request)).toEqual({
        title: 'Riley Chen',
        body: 'Stand-up moved to 10:30.',
        url: '/messages/chat-1',
        tag: 'chat:chat-1',
      });
      expect(request.headers.Topic).toBe(topicFor('chat:chat-1'));
      expect(request.headers.Urgency).toBe('normal');
    }
    const used = await store.listSubscriptions(avery);
    expect(used.map((subscription) => subscription.lastUsedAt)).toEqual([now, now]);
  });

  it('hides the text when the person turned "Show message text" off', async () => {
    const { store, runtime, requests, addBrowser, read } = await setup();
    await addBrowser('laptop');
    await store.updatePreferences(avery, { showText: false }, now);
    await pushToUser(runtime, avery, notice, { urgency: 'high' });
    expect(read(requests[0])).toMatchObject({ title: 'Riley Chen', body: 'New message' });
    expect(requests[0]?.headers.Urgency).toBe('high');
  });

  it('deletes subscriptions that are gone or expired, and logs other failures', async () => {
    const statuses: Record<string, number> = {
      'https://fcm.googleapis.com/fcm/send/gone': 410,
      'https://fcm.googleapis.com/fcm/send/busy': 503,
    };
    const { store, runtime, requests, warnings, addBrowser } = await setup(
      (endpoint) => statuses[endpoint] ?? 201,
    );
    await addBrowser('laptop');
    await addBrowser('gone');
    await addBrowser('busy');
    await addBrowser('expired', new Date(now.getTime() - 1000));
    expect(await pushToUser(runtime, avery, notice)).toEqual({ sent: 1, removed: 2, failed: 1 });
    expect(requests).toHaveLength(3);
    const left = await store.listSubscriptions(avery);
    expect(left.map((subscription) => subscription.endpoint).sort()).toEqual([
      'https://fcm.googleapis.com/fcm/send/busy',
      'https://fcm.googleapis.com/fcm/send/laptop',
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ result: 'retry', status: 503 });
    expect(JSON.stringify(warnings)).not.toContain('fcm.googleapis.com');
    expect(JSON.stringify(warnings)).not.toContain('Stand-up');
  });

  it("counts a browser it can't reach as failed and still sends to the others", async () => {
    const { runtime, warnings, addBrowser } = await setup();
    await addBrowser('laptop');
    const broken = await addBrowser('broken');
    const fetch = runtime.fetch;
    runtime.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) === broken.endpoint) throw new Error('Unexpected');
      return fetch(input, init);
    }) as typeof globalThis.fetch;
    // sendPush answers "retry" for network errors.
    expect(await pushToUser(runtime, avery, notice)).toEqual({ sent: 1, removed: 0, failed: 1 });
    expect(warnings).toHaveLength(1);
  });

  it('sends nothing while the person paused notifications, except the test', async () => {
    const { store, runtime, requests, addBrowser } = await setup();
    await addBrowser('laptop');
    const until = new Date(now.getTime() + 60 * 60 * 1000);
    await store.updatePreferences(avery, { pause: { until } }, now);
    expect(await pushToUser(runtime, avery, notice)).toEqual({ sent: 0, removed: 0, failed: 0 });
    expect(requests).toHaveLength(0);
    const test = await pushToUser(runtime, avery, notice, { evenIfPaused: true });
    expect(test).toEqual({ sent: 1, removed: 0, failed: 0 });
    runtime.now = () => until;
    expect(await pushToUser(runtime, avery, notice)).toEqual({ sent: 1, removed: 0, failed: 0 });
  });

  it('sends no message to a locked account, not even the test', async () => {
    const { store, runtime, requests, addBrowser } = await setup();
    await addBrowser('laptop');
    store.locked.add(avery);
    expect(await pushToUser(runtime, avery, notice)).toEqual({ sent: 0, removed: 0, failed: 0 });
    const test = await pushToUser(runtime, avery, notice, { evenIfPaused: true });
    expect(test).toEqual({ sent: 0, removed: 0, failed: 0 });
    expect(requests).toHaveLength(0);
    store.locked.delete(avery);
    expect(await pushToUser(runtime, avery, notice)).toEqual({ sent: 1, removed: 0, failed: 0 });
  });

  it('sends nothing while push is off or the person has no browsers', async () => {
    const { runtime, requests, addBrowser } = await setup();
    expect(await pushToUser(runtime, avery, notice)).toEqual({ sent: 0, removed: 0, failed: 0 });
    await addBrowser('laptop');
    const off = { ...runtime, config: resolvePushConfig({}) };
    expect(await pushToUser(off, avery, notice)).toEqual({ sent: 0, removed: 0, failed: 0 });
    expect(requests).toHaveLength(0);
  });
});
