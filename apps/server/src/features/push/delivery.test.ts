import { notifyDecision } from '@carehub/team-chat';
import { describe, expect, it } from 'vitest';
import type { NoticeSummary } from '../notices';
import { createPushDelivery, type DeliverySources } from './delivery';
import { createTestSubscription, type TestSubscription } from './protocol/testing';
import { generateVapidKeys } from './protocol/vapid';
import { topicFor } from './sender';
import type { PushRuntime } from './service';
import { resolvePushConfig, type PushConfig } from './settings';
import { createMemoryPushStore } from './testing';

const now = new Date('2026-10-27T15:00:00Z');
const avery = '0b8f3c52-6d1e-4a7b-9c2d-1e5f7a9b3c41';
const sam = '5c2e9a17-3f4b-4d6c-8e1a-7b9d2f4c6e83';
const commentId = 'a3f1c9e2-5b7d-4e8a-9c1f-6d2b4e8a0c53';

function notice(changes: Partial<NoticeSummary> = {}): NoticeSummary {
  return {
    id: commentId,
    workspaceId: '9d4e2b61-7a3c-4f8e-b5d1-2c6a8e0f4b97',
    userId: avery,
    kind: 'comment',
    title: 'Commented on a page you follow',
    text: 'Can you check the follow-up dates?',
    senderName: 'Sam Ortiz',
    link: '/p/page-1',
    createdAt: now,
    latestAt: now,
    ...changes,
  };
}

function on(): PushConfig {
  const keys = generateVapidKeys();
  return resolvePushConfig({
    PUSH_VAPID_PUBLIC_KEY: keys.publicKey,
    PUSH_VAPID_PRIVATE_KEY: keys.privateKey,
    PUSH_VAPID_SUBJECT: 'mailto:care-team@example.org',
  });
}

function setup(
  options: {
    config?: PushConfig;
    tabOpen?: boolean;
    getNotice?: DeliverySources['getNotice'];
  } = {},
) {
  const store = createMemoryPushStore();
  const browsers = new Map<string, TestSubscription>();
  const notices = new Map<string, NoticeSummary>();
  const requests: { endpoint: string; headers: Record<string, string>; body: Uint8Array }[] = [];
  const warnings: Record<string, unknown>[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({
      endpoint: String(input),
      headers: init?.headers as Record<string, string>,
      body: init?.body as Uint8Array,
    });
    return new Response(null, { status: 201 });
  }) as typeof globalThis.fetch;
  const runtime: PushRuntime = {
    store,
    config: options.config ?? on(),
    fetch,
    now: () => now,
    log: { warn: (details) => warnings.push(details) },
  };
  const delivery = createPushDelivery(runtime, {
    hasOpenTabs: () => options.tabOpen ?? false,
    getNotice: options.getNotice ?? (async (noticeId) => notices.get(noticeId) ?? null),
    decide: notifyDecision,
  });

  async function addBrowser(userId: string, name: string) {
    const browser = createTestSubscription();
    const endpoint = `https://fcm.googleapis.com/fcm/send/${name}`;
    browsers.set(endpoint, browser);
    await store.saveSubscription(
      { userId, endpoint, keys: browser.keys, device: 'Chrome on Windows', expiresAt: null },
      now,
    );
  }
  /** Saves the notice, as notices does, and then handles its `notices.notice.created`. */
  function send(sent: NoticeSummary) {
    notices.set(sent.id, sent);
    return delivery.noticeCreated({ userId: sent.userId, noticeId: sent.id });
  }
  function read(index: number) {
    const request = requests[index];
    const browser = request ? browsers.get(request.endpoint) : undefined;
    if (!request || !browser) throw new Error('No such request.');
    return JSON.parse(new TextDecoder().decode(browser.decrypt(request.body)));
  }
  return { store, delivery, requests, warnings, addBrowser, send, read };
}

const pushedTo = (browsers: number) => ({ pushed: { sent: browsers, removed: 0, failed: 0 } });

describe('push delivery for new notices', () => {
  it("pushes a new notice to each of the person's browsers", async () => {
    const { requests, addBrowser, send, read } = setup();
    await addBrowser(avery, 'laptop');
    await addBrowser(avery, 'phone');
    expect(await send(notice())).toEqual(pushedTo(2));
    expect(requests.map((request) => request.headers.Urgency)).toEqual(['normal', 'normal']);
    expect(read(0)).toEqual({
      title: 'Sam Ortiz',
      body: 'Commented on a page you follow · Can you check the follow-up dates?',
      url: '/p/page-1',
      tag: `notice:${commentId}`,
    });
  });

  it('words reminders and mentions their own way, and hurries reminders and alerts', async () => {
    const { requests, addBrowser, send, read } = setup();
    await addBrowser(avery, 'laptop');
    await send(
      notice({
        id: 'c7b2e4f1-8a3d-4b6e-9f2c-1d5a7e9b3c62',
        kind: 'reminder',
        title: 'Reminder',
        text: 'Call the pharmacy about the refill.',
        senderName: 'Reminders',
        link: '/home',
      }),
    );
    await send(
      notice({
        id: 'e5d8a2c4-1f7b-4e9a-8c3d-6b2f4a8e0d71',
        kind: 'mention',
        title: 'Mentioned you in a comment',
        text: 'Could you look at this, Avery?',
      }),
    );
    await send(
      notice({
        id: 'b1f4d7a9-3c6e-4a2b-8d5f-9e7c1a3b5d84',
        kind: 'alert',
        title: 'New sign-in to your account',
        text: null,
        senderName: 'Care Hub',
      }),
    );
    expect(requests.map((request) => request.headers.Urgency)).toEqual(['high', 'normal', 'high']);
    expect(read(0)).toMatchObject({
      title: 'Reminder',
      body: 'Call the pharmacy about the refill.',
    });
    expect(read(1)).toMatchObject({
      title: 'Sam Ortiz mentioned you',
      body: 'Could you look at this, Avery?',
    });
    expect(read(2)).toMatchObject({ title: 'Care Hub', body: 'New sign-in to your account' });
  });

  it('replaces the notification of a grouped notice with its newest part', async () => {
    const { requests, addBrowser, send, read } = setup();
    await addBrowser(avery, 'laptop');
    await send(notice({ title: 'Replied in a thread you follow', text: 'First reply' }));
    await send(notice({ title: '2 new replies', text: 'Second reply' }));
    const topic = topicFor(`notice:${commentId}`);
    expect(requests.map((request) => request.headers.Topic)).toEqual([topic, topic]);
    expect(read(1)).toMatchObject({
      body: '2 new replies · Second reply',
      tag: `notice:${commentId}`,
    });
  });

  it('follows Settings → Notifications', async () => {
    const { store, requests, addBrowser, send, read } = setup();
    await addBrowser(avery, 'laptop');
    await store.updatePreferences(avery, { notifyAbout: 'nothing' }, now);
    expect(await send(notice())).toEqual({ skipped: 'turned-off' });
    // Only direct messages, @mentions and notices: notices still come.
    await store.updatePreferences(avery, { notifyAbout: 'mentions', showText: false }, now);
    expect(await send(notice())).toEqual(pushedTo(1));
    expect(requests).toHaveLength(1);
    // Without message text: who and what kind, never the text.
    expect(read(0)).toMatchObject({ title: 'Sam Ortiz', body: 'Commented on a page you follow' });
  });

  it('sends nothing while notifications are paused, and again once the pause ends', async () => {
    const { store, requests, addBrowser, send } = setup();
    await addBrowser(avery, 'laptop');
    await store.updatePreferences(avery, { pause: { until: null } }, now);
    expect(await send(notice())).toEqual({ skipped: 'paused' });
    await store.updatePreferences(avery, { pause: { until: now } }, now);
    expect(await send(notice())).toEqual(pushedTo(1));
    expect(requests).toHaveLength(1);
  });

  it('sends no notice to a locked account', async () => {
    const { store, requests, addBrowser, send } = setup();
    await addBrowser(avery, 'laptop');
    store.locked.add(avery);
    expect(await send(notice())).toEqual(pushedTo(0));
    expect(requests).toHaveLength(0);
    store.locked.delete(avery);
    expect(await send(notice())).toEqual(pushedTo(1));
  });

  it('sends nothing while a Care Hub tab is open, push is off or there is no browser', async () => {
    const tab = setup({ tabOpen: true });
    await tab.addBrowser(avery, 'laptop');
    expect(await tab.send(notice())).toEqual({ skipped: 'tab-open' });

    const off = setup({ config: resolvePushConfig({}) });
    await off.addBrowser(avery, 'laptop');
    expect(await off.send(notice())).toEqual({ skipped: 'push-off' });

    const elsewhere = setup();
    await elsewhere.addBrowser(sam, 'laptop');
    expect(await elsewhere.send(notice())).toEqual({ skipped: 'no-device' });
    expect([...tab.requests, ...off.requests, ...elsewhere.requests]).toHaveLength(0);
  });

  it("shows a notice only to the person whose 🔔 chat it's in", async () => {
    const { delivery, requests, addBrowser, send } = setup();
    await addBrowser(avery, 'laptop');
    await addBrowser(sam, 'phone');
    expect(await send(notice())).toEqual(pushedTo(1));
    expect(await delivery.noticeCreated({ userId: sam, noticeId: commentId })).toEqual({
      skipped: 'not-found',
    });
    const missing = 'f0e1d2c3-b4a5-4697-8879-6a5b4c3d2e1f';
    expect(await delivery.noticeCreated({ userId: avery, noticeId: missing })).toEqual({
      skipped: 'not-found',
    });
    expect(requests.map((request) => request.endpoint)).toEqual([
      'https://fcm.googleapis.com/fcm/send/laptop',
    ]);
  });

  it('opens the 🔔 chat when the link is not a Care Hub path', async () => {
    const { addBrowser, send, read } = setup();
    await addBrowser(avery, 'laptop');
    await send(notice({ link: 'https://example.org/elsewhere' }));
    expect(read(0).url).toBe('/messages/care-hub');
  });

  it('logs a failure and never throws', async () => {
    const { delivery, requests, warnings, addBrowser } = setup({
      getNotice: async () => {
        throw new Error('Connection reset');
      },
    });
    await addBrowser(avery, 'laptop');
    expect(await delivery.noticeCreated({ userId: avery, noticeId: commentId })).toEqual({
      skipped: 'failed',
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.noticeId).toBe(commentId);
    expect(warnings[0]?.err).toBeInstanceOf(Error);
    expect(requests).toHaveLength(0);
  });
});
