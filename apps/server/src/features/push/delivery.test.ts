import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { registerEvents } from '../../core/events';
import {
  createPushDelivery,
  type DeliverySources,
  type MessageForPush,
  type NoticeForPush,
  type NotifyDecision,
  type NotifyInput,
} from './delivery';
import { createTestSubscription, type TestSubscription } from './protocol/testing';
import { generateVapidKeys } from './protocol/vapid';
import pushRoutes from './routes';
import type { PushRuntime } from './service';
import { resolvePushConfig, type PushConfig } from './settings';
import { createMemoryPushStore } from './testing';

const now = new Date('2026-10-27T15:00:00Z');
const avery = '0b8f3c52-6d1e-4a7b-9c2d-1e5f7a9b3c41';
const sam = '5c2e9a17-3f4b-4d6c-8e1a-7b9d2f4c6e83';
const riley = '9d4f6b28-1c3e-4a5d-8f7b-2e6c9a1d3f57';
const chatId = '3e7a9c15-5b2d-4f8e-a1c6-9d3b7e5f2a84';
const messageId = '7b1d3f59-2e4c-4a6b-9d8f-1c5e7a3b9d26';
const noticeId = '6a2c4e8f-9b1d-4f3a-8c5e-7d9b1f3a5c62';

const reminder: NoticeForPush = {
  id: noticeId,
  userId: avery,
  kind: 'reminder',
  title: 'Reminder',
  text: 'Call the pharmacy about the refill.',
  senderName: 'Reminders',
  link: `/p/4c8e2a6f-1b3d-4e5f-9a7c-2d4f6b8e1a3c`,
};

function message(changes: Partial<MessageForPush> = {}): MessageForPush {
  return {
    chatId,
    messageId,
    chatType: 'group',
    chatName: 'Night shift',
    senderName: 'Jordan Patel',
    text: 'Handover notes are in the binder.',
    mentionsUser: false,
    muted: false,
    ...changes,
  };
}

/** Close to team-chat's rules, enough to see delivery follow the answer. */
function fakeDecide(input: NotifyInput): NotifyDecision {
  if (input.own) return { notify: false, reason: 'own' };
  if (input.settings.notifyAbout === 'nothing') return { notify: false, reason: 'setting' };
  if (input.membership?.muted && !input.mentionsUser) return { notify: false, reason: 'muted' };
  const quiet = input.settings.notifyAbout === 'mentions' && input.chatType === 'group';
  if (quiet && !input.mentionsUser) return { notify: false, reason: 'setting' };
  if (input.tabOpen) return { notify: true, via: 'tab' };
  return input.hasPushDevice ? { notify: true, via: 'push' } : { notify: false, reason: 'device' };
}

function pushOn(): PushConfig {
  const keys = generateVapidKeys();
  return resolvePushConfig({
    PUSH_VAPID_PUBLIC_KEY: keys.publicKey,
    PUSH_VAPID_PRIVATE_KEY: keys.privateKey,
    PUSH_VAPID_SUBJECT: 'mailto:care-team@example.org',
  });
}

function setup(config: PushConfig = pushOn()) {
  const store = createMemoryPushStore();
  const browsers = new Map<string, TestSubscription>();
  const requests: { endpoint: string; headers: Record<string, string>; body: Uint8Array }[] = [];
  const warnings: Record<string, unknown>[] = [];
  const decisions: NotifyInput[] = [];
  const looked: string[] = [];
  const openTabs = new Set<string>();
  const notices = new Map<string, NoticeForPush>([[noticeId, reminder]]);
  const messages = new Map<string, MessageForPush | Error>();
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({
      endpoint: String(input),
      headers: init?.headers as Record<string, string>,
      body: init?.body as Uint8Array,
    });
    return new Response(null, { status: 201 });
  }) as typeof globalThis.fetch;
  const sources: DeliverySources = {
    hasOpenTabs: (userId) => openTabs.has(userId),
    getNotice: async (id) => {
      looked.push(`notice:${id}`);
      return notices.get(id) ?? null;
    },
    getMessage: async (id, userId) => {
      looked.push(`message:${id}:${userId}`);
      const found = messages.get(userId);
      if (found instanceof Error) throw found;
      return found ?? null;
    },
    decide: (input) => {
      decisions.push(input);
      return fakeDecide(input);
    },
  };
  const runtime: PushRuntime = {
    store,
    config,
    fetch,
    now: () => now,
    log: { warn: (details) => warnings.push(details) },
  };
  async function addBrowser(userId: string, name: string) {
    const browser = createTestSubscription();
    const endpoint = `https://fcm.googleapis.com/fcm/send/${name}`;
    browsers.set(endpoint, browser);
    await store.saveSubscription(
      { userId, endpoint, keys: browser.keys, device: 'Chrome on Android', expiresAt: null },
      new Date(now.getTime() - 60_000),
    );
  }
  const shown = () =>
    requests.map(({ endpoint, body }) => {
      const browser = browsers.get(endpoint);
      if (!browser) throw new Error(`No browser for ${endpoint}.`);
      return JSON.parse(new TextDecoder().decode(browser.decrypt(body)));
    });
  const delivery = createPushDelivery(runtime, sources);
  return {
    store,
    delivery,
    sources,
    requests,
    warnings,
    decisions,
    looked,
    openTabs,
    notices,
    messages,
    addBrowser,
    shown,
  };
}

describe('push delivery for notices', () => {
  it("pushes a reminder to the person's browsers at high urgency", async () => {
    const { delivery, requests, decisions, addBrowser, shown } = setup();
    await addBrowser(avery, 'phone');
    const outcome = await delivery.noticeCreated({ userId: avery, noticeId });
    expect(outcome).toEqual({ userId: avery, pushed: { sent: 1, removed: 0, failed: 0 } });
    expect(shown()).toEqual([
      {
        title: 'Reminder',
        body: 'Call the pharmacy about the refill.',
        url: reminder.link,
        tag: `notice:${noticeId}`,
      },
    ]);
    expect(requests[0]?.headers).toMatchObject({ Urgency: 'high' });
    expect(decisions).toEqual([
      {
        settings: { notifyAbout: 'all', showText: true },
        membership: null,
        chatType: 'careHub',
        kind: 'notice',
        own: false,
        mentionsUser: false,
        readingChat: false,
        tabOpen: false,
        hasPushDevice: true,
      },
    ]);
  });

  it('words other notices with their sender and generic title, at normal urgency', async () => {
    const { delivery, notices, requests, addBrowser, shown } = setup();
    await addBrowser(avery, 'laptop');
    notices.set(noticeId, {
      ...reminder,
      kind: 'shared',
      title: 'Page shared with you',
      text: null,
      senderName: 'Sam Ortiz',
      link: '//attacker.example.com/p/1',
    });
    await delivery.noticeCreated({ userId: avery, noticeId });
    expect(shown()).toEqual([
      {
        title: 'Sam Ortiz',
        body: 'Page shared with you',
        url: '/messages/care-hub',
        tag: `notice:${noticeId}`,
      },
    ]);
    expect(requests[0]?.headers).toMatchObject({ Urgency: 'normal' });
  });

  it('says who mentioned the person, and hides the text when they asked', async () => {
    const { delivery, notices, store, decisions, addBrowser, shown } = setup();
    await addBrowser(avery, 'phone');
    await store.updatePreferences(avery, { showText: false }, now);
    notices.set(noticeId, {
      ...reminder,
      kind: 'mention',
      title: 'Mentioned you',
      senderName: 'Riley Chen',
    });
    await delivery.noticeCreated({ userId: avery, noticeId });
    expect(shown()).toEqual([
      {
        title: 'Riley Chen mentioned you',
        body: '',
        url: reminder.link,
        tag: `notice:${noticeId}`,
      },
    ]);
    expect(decisions[0]).toMatchObject({ mentionsUser: true, settings: { showText: false } });
  });

  it('skips people with a tab open, without browsers, or paused, before looking anything up', async () => {
    const { delivery, store, openTabs, looked, requests, addBrowser } = setup();
    expect(await delivery.noticeCreated({ userId: avery, noticeId })).toEqual({
      userId: avery,
      skipped: 'no-browser',
    });
    await addBrowser(avery, 'phone');
    openTabs.add(avery);
    expect(await delivery.noticeCreated({ userId: avery, noticeId })).toEqual({
      userId: avery,
      skipped: 'tab-open',
    });
    openTabs.clear();
    await store.updatePreferences(avery, { pause: { until: new Date(now.getTime() + 1) } }, now);
    expect(await delivery.noticeCreated({ userId: avery, noticeId })).toEqual({
      userId: avery,
      skipped: 'paused',
    });
    await store.updatePreferences(avery, { pause: { until: null } }, now);
    expect(await delivery.noticeCreated({ userId: avery, noticeId })).toMatchObject({
      skipped: 'paused',
    });
    expect(looked).toEqual([]);
    expect(requests).toEqual([]);
  });

  it('pushes again once a pause has ended', async () => {
    const { delivery, store, requests, addBrowser } = setup();
    await addBrowser(avery, 'phone');
    await store.updatePreferences(avery, { pause: { until: now } }, now);
    expect(await delivery.noticeCreated({ userId: avery, noticeId })).toMatchObject({
      pushed: { sent: 1 },
    });
    expect(requests).toHaveLength(1);
  });

  it("skips missing notices, someone else's notice, and what notifyDecision turns down", async () => {
    const { delivery, store, requests, addBrowser } = setup();
    await addBrowser(avery, 'phone');
    await addBrowser(sam, 'tablet');
    const missing = '1f3b5d7a-9c2e-4b6d-8a1f-3e5c7b9d2a46';
    expect(await delivery.noticeCreated({ userId: avery, noticeId: missing })).toEqual({
      userId: avery,
      skipped: 'not-found',
    });
    expect(await delivery.noticeCreated({ userId: sam, noticeId })).toEqual({
      userId: sam,
      skipped: 'not-found',
    });
    await store.updatePreferences(avery, { notifyAbout: 'nothing' }, now);
    expect(await delivery.noticeCreated({ userId: avery, noticeId })).toEqual({
      userId: avery,
      skipped: 'setting',
    });
    expect(requests).toEqual([]);
  });

  it('sends nothing while push is off', async () => {
    const { delivery, looked, addBrowser } = setup(resolvePushConfig({}));
    await addBrowser(avery, 'phone');
    expect(await delivery.noticeCreated({ userId: avery, noticeId })).toEqual({
      userId: avery,
      skipped: 'push-off',
    });
    expect(looked).toEqual([]);
  });
});

describe('push delivery for messages', () => {
  const created = { messageId, senderId: sam, recipientIds: [avery, riley, sam, avery] };

  it('pushes to each recipient but the sender, once each, with one tag per chat', async () => {
    const { delivery, messages, decisions, looked, addBrowser, shown } = setup();
    await addBrowser(avery, 'avery-phone');
    await addBrowser(riley, 'riley-phone');
    await addBrowser(sam, 'sam-phone');
    messages.set(avery, message());
    messages.set(riley, message({ text: '' }));
    const outcomes = await delivery.messageCreated(created);
    expect(outcomes).toEqual([
      { userId: avery, pushed: { sent: 1, removed: 0, failed: 0 } },
      { userId: riley, pushed: { sent: 1, removed: 0, failed: 0 } },
    ]);
    const target = { url: `/messages/${chatId}?message=${messageId}`, tag: `chat:${chatId}` };
    expect(shown()).toEqual([
      { title: 'Jordan Patel', body: 'Handover notes are in the binder.', ...target },
      { title: 'Jordan Patel', body: 'New message', ...target },
    ]);
    expect(looked).toEqual([`message:${messageId}:${avery}`, `message:${messageId}:${riley}`]);
    expect(decisions[0]).toEqual({
      settings: { notifyAbout: 'all', showText: true },
      membership: { muted: false },
      chatType: 'group',
      kind: 'message',
      own: false,
      mentionsUser: false,
      readingChat: false,
      tabOpen: false,
      hasPushDevice: true,
    });
  });

  it('says who mentioned the person, in which group chat', async () => {
    const { delivery, messages, addBrowser, shown } = setup();
    await addBrowser(avery, 'phone');
    messages.set(avery, message({ mentionsUser: true, text: '@Avery Lin can you cover 7 PM?' }));
    await delivery.messageCreated({ ...created, recipientIds: [avery] });
    expect(shown()).toMatchObject([
      { title: 'Jordan Patel mentioned you', body: 'Night shift · @Avery Lin can you cover 7 PM?' },
    ]);
  });

  it('follows mute and the setting through notifyDecision', async () => {
    const { delivery, messages, store, requests, addBrowser } = setup();
    await addBrowser(avery, 'avery-phone');
    await addBrowser(riley, 'riley-phone');
    messages.set(avery, message({ muted: true }));
    messages.set(riley, message());
    await store.updatePreferences(riley, { notifyAbout: 'mentions' }, now);
    expect(await delivery.messageCreated(created)).toEqual([
      { userId: avery, skipped: 'muted' },
      { userId: riley, skipped: 'setting' },
    ]);
    messages.set(avery, message({ muted: true, mentionsUser: true }));
    messages.set(riley, message({ chatType: 'direct' }));
    expect(await delivery.messageCreated(created)).toMatchObject([
      { userId: avery, pushed: { sent: 1 } },
      { userId: riley, pushed: { sent: 1 } },
    ]);
    expect(requests).toHaveLength(2);
  });

  it("skips people who can't see the message, and keeps going when one fails", async () => {
    const { delivery, messages, warnings, addBrowser, shown } = setup();
    await addBrowser(avery, 'avery-phone');
    await addBrowser(riley, 'riley-phone');
    messages.set(avery, new Error('connection reset'));
    messages.set(riley, message({ chatType: 'direct', chatName: 'Jordan Patel' }));
    expect(await delivery.messageCreated(created)).toEqual([
      { userId: avery, skipped: 'failed' },
      { userId: riley, pushed: { sent: 1, removed: 0, failed: 0 } },
    ]);
    expect(warnings).toEqual([{ userId: avery, err: new Error('connection reset') }]);
    expect(shown()).toHaveLength(1);
    messages.delete(riley);
    expect(await delivery.messageCreated({ ...created, recipientIds: [riley] })).toEqual([
      { userId: riley, skipped: 'not-found' },
    ]);
  });

  it('handles a large group a few people at a time', async () => {
    const { delivery, messages, addBrowser, sources } = setup();
    const people = Array.from({ length: 10 }, (_, index) => `person-${index}`);
    let running = 0;
    let most = 0;
    const getMessage = sources.getMessage;
    sources.getMessage = async (id, userId) => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 1));
      running -= 1;
      return getMessage(id, userId);
    };
    for (const person of people) {
      await addBrowser(person, person);
      messages.set(person, message());
    }
    const outcomes = await delivery.messageCreated({ ...created, recipientIds: people });
    expect(outcomes.map(({ userId }) => userId)).toEqual(people);
    expect(most).toBeLessThanOrEqual(4);
  });
});

describe('push routes', () => {
  it('deliver new notices and messages from app.events while push is on', async () => {
    const { store, sources, messages, requests, addBrowser } = setup();
    await addBrowser(avery, 'phone');
    messages.set(avery, message());
    const app = Fastify();
    registerEvents(app);
    await app.register(pushRoutes, {
      prefix: '/api/push',
      store,
      config: pushOn(),
      sources,
      now: () => now,
      fetch: (async (input: string | URL | Request, init?: RequestInit) => {
        requests.push({
          endpoint: String(input),
          headers: init?.headers as Record<string, string>,
          body: init?.body as Uint8Array,
        });
        return new Response(null, { status: 201 });
      }) as typeof fetch,
    });
    try {
      app.events.emit('notices.notice.created', {
        workspaceId: '2b4d6f8a-1c3e-4a5b-9d7f-3e5a7c9b1d24',
        userId: avery,
        noticeId,
        kind: 'reminder',
        grouped: false,
      });
      app.events.emit('messages.message.created', {
        workspaceId: '2b4d6f8a-1c3e-4a5b-9d7f-3e5a7c9b1d24',
        chatId,
        messageId,
        senderId: sam,
        recipientIds: [avery],
      });
      await app.events.settled();
      expect(requests).toHaveLength(2);
    } finally {
      await app.close();
    }
  });
});
