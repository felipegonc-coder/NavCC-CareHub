import { afterEach, describe, expect, it } from 'vitest';
import { createLiveHub, type LiveHub, type LiveHubOptions } from './hub';
import { testSink } from './testSink';

let clock = 0;
let hub: LiveHub;
const warnings: string[] = [];

function makeHub(options: LiveHubOptions = {}): LiveHub {
  let ids = 0;
  clock = 1_000_000;
  warnings.length = 0;
  hub = createLiveHub({
    now: () => clock,
    createId: () => `conn-${++ids}`,
    log: { warn: (_details, message) => warnings.push(message) },
    ...options,
  });
  return hub;
}

async function flushPromises(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

afterEach(() => hub?.closeAll());

describe('connections', () => {
  it('starts each stream with hello, the connection id and a retry hint', () => {
    makeHub();
    const tab = testSink();
    const connection = hub.connect('user-avery', tab.sink);
    expect(connection.id).toBe('conn-1');
    expect(tab.frames()).toEqual([
      { event: 'hello', retry: 3000, data: { connectionId: 'conn-1', heartbeatMs: 25_000 } },
    ]);
  });

  it('sends user events to every tab of those users only', () => {
    makeHub();
    const [a1, a2, sam] = [testSink(), testSink(), testSink()];
    hub.connect('user-avery', a1.sink);
    hub.connect('user-avery', a2.sink);
    hub.connect('user-sam', sam.sink);
    hub.publishToUsers(['user-avery', 'user-avery'], {
      type: 'job-updated',
      data: { jobId: 'j1' },
    });
    const expected = [{ event: 'message', data: { type: 'job-updated', data: { jobId: 'j1' } } }];
    expect(a1.events()).toEqual(expected);
    expect(a2.events()).toEqual(expected);
    expect(sam.events()).toEqual([]);
  });

  it('closes the oldest tab, with a reason, past 5 per user', () => {
    makeHub();
    const tabs = Array.from({ length: 6 }, () => testSink());
    for (const tab of tabs) hub.connect('user-avery', tab.sink);
    expect(tabs[0]?.ended).toBe(true);
    expect(tabs[0]?.frames().at(-1)).toEqual({ event: 'bye', data: { reason: 'replaced' } });
    expect(tabs.slice(1).every((tab) => !tab.ended)).toBe(true);
    expect(hub.stats()).toEqual({ connections: 5, users: 1, subscriptions: 0 });
  });

  it('drops invalid or oversized events and logs why', () => {
    makeHub();
    const tab = testSink();
    hub.connect('user-avery', tab.sink);
    hub.publishToUsers(['user-avery'], { type: 'note', data: { text: 'x'.repeat(3000) } });
    hub.publishTopic('chat:c1', { type: 'live-reconnected' });
    expect(tab.events()).toEqual([]);
    expect(warnings).toEqual(['live: event not sent', 'live: event not sent']);
  });

  it('forgets a connection and its topics when the client goes away', async () => {
    makeHub();
    hub.registerTopic('chat', async () => true);
    const tab = testSink();
    const connection = hub.connect('user-avery', tab.sink);
    await hub.updateTopics({ userId: 'user-avery', connectionId: connection.id, add: ['chat:c1'] });
    expect(hub.stats()).toEqual({ connections: 1, users: 1, subscriptions: 1 });
    connection.disconnect();
    connection.disconnect();
    expect(hub.stats()).toEqual({ connections: 0, users: 0, subscriptions: 0 });
    hub.publishTopic('chat:c1', { type: 'message-created' });
    expect(tab.events()).toEqual([]);
  });

  it('knows whether a user has a tab open', () => {
    makeHub();
    expect(hub.hasOpenTabs('user-avery')).toBe(false);
    const first = hub.connect('user-avery', testSink().sink);
    const second = hub.connect('user-avery', testSink().sink);
    hub.connect('user-sam', testSink().sink);
    expect(hub.hasOpenTabs('user-avery')).toBe(true);
    first.disconnect();
    expect(hub.hasOpenTabs('user-avery')).toBe(true);
    second.disconnect();
    expect(hub.hasOpenTabs('user-avery')).toBe(false);
    expect(hub.hasOpenTabs('user-sam')).toBe(true);
  });

  it('stops counting a tab once it is dropped as a slow client', () => {
    makeHub({ maxQueuedFrames: 1 });
    const tab = testSink();
    hub.connect('user-avery', tab.sink);
    tab.accept = false;
    for (const type of ['a', 'b', 'c']) hub.publishToUsers(['user-avery'], { type });
    expect(tab.ended).toBe(true);
    expect(hub.hasOpenTabs('user-avery')).toBe(false);
  });

  it('ends every stream on closeAll', () => {
    makeHub();
    const tabs = [testSink(), testSink()];
    hub.connect('user-avery', tabs[0]!.sink);
    hub.connect('user-sam', tabs[1]!.sink);
    hub.closeAll();
    expect(tabs.map((tab) => tab.ended)).toEqual([true, true]);
    expect(hub.stats().connections).toBe(0);
  });

  it("ends every stream of one user on disconnectUser, and nobody else's", () => {
    makeHub();
    const tabs = [testSink(), testSink(), testSink()];
    hub.connect('user-avery', tabs[0]!.sink);
    hub.connect('user-avery', tabs[1]!.sink);
    hub.connect('user-sam', tabs[2]!.sink);
    hub.disconnectUser('user-avery');
    hub.disconnectUser('user-nobody');
    expect(tabs.map((tab) => tab.ended)).toEqual([true, true, false]);
    expect(hub.hasOpenTabs('user-avery')).toBe(false);
    expect(hub.stats()).toMatchObject({ connections: 1, users: 1 });
  });
});

describe('topics', () => {
  it('subscribes only when the owner allows it, and delivers with the topic', async () => {
    makeHub();
    const asked: unknown[] = [];
    hub.registerTopic('chat:', async (input) => {
      asked.push(input);
      return input.topic === 'chat:c1';
    });
    const tab = testSink();
    const { id } = hub.connect('user-avery', tab.sink);
    const answer = await hub.updateTopics({
      userId: 'user-avery',
      connectionId: id,
      add: ['chat:c1', 'chat:c2', 'db:p1', 'nonsense'],
    });
    expect(answer).toEqual({
      results: [
        { topic: 'chat:c1', ok: true },
        { topic: 'chat:c2', ok: false },
        { topic: 'db:p1', ok: false },
        { topic: 'nonsense', ok: false },
      ],
    });
    expect(asked).toEqual([
      { userId: 'user-avery', topic: 'chat:c1' },
      { userId: 'user-avery', topic: 'chat:c2' },
    ]);
    hub.publishTopic('chat:c1', { type: 'message-created', data: { messageId: 'm1' } });
    hub.publishTopic('chat:c2', { type: 'message-created', data: { messageId: 'm2' } });
    expect(tab.events()).toEqual([
      {
        event: 'message',
        data: { topic: 'chat:c1', type: 'message-created', data: { messageId: 'm1' } },
      },
    ]);
  });

  it('treats failing and slow checks as no', async () => {
    makeHub({ checkTimeoutMs: 5 });
    hub.registerTopic('chat', async () => {
      throw new Error('database is down');
    });
    hub.registerTopic('db', () => new Promise<boolean>(() => {}));
    const { id } = hub.connect('user-avery', testSink().sink);
    const answer = await hub.updateTopics({
      userId: 'user-avery',
      connectionId: id,
      add: ['chat:c1', 'db:p1'],
    });
    expect(answer?.results.map((result) => result.ok)).toEqual([false, false]);
    expect(warnings).toEqual([
      'live: topic access check failed',
      'live: topic access check timed out',
    ]);
  });

  it("refuses other people's and unknown connections", async () => {
    makeHub();
    hub.registerTopic('chat', async () => true);
    const { id } = hub.connect('user-avery', testSink().sink);
    expect(await hub.updateTopics({ userId: 'user-sam', connectionId: id, add: ['chat:c1'] })).toBe(
      null,
    );
    expect(await hub.updateTopics({ userId: 'user-avery', connectionId: 'nope' })).toBe(null);
  });

  it('stops delivering after a remove, even one that overtakes the check', async () => {
    makeHub();
    let allow: (value: boolean) => void = () => {};
    hub.registerTopic('chat', () => new Promise<boolean>((resolve) => (allow = resolve)));
    const tab = testSink();
    const { id } = hub.connect('user-avery', tab.sink);
    const adding = hub.updateTopics({ userId: 'user-avery', connectionId: id, add: ['chat:c1'] });
    const removing = await hub.updateTopics({
      userId: 'user-avery',
      connectionId: id,
      remove: ['chat:c1'],
    });
    expect(removing).toEqual({ results: [{ topic: 'chat:c1', ok: true }] });
    allow(true);
    expect(await adding).toEqual({ results: [{ topic: 'chat:c1', ok: false }] });
    hub.publishTopic('chat:c1', { type: 'message-created' });
    expect(tab.events()).toEqual([]);
  });

  it('caps the topics per connection', async () => {
    makeHub({ maxTopicsPerConnection: 2 });
    hub.registerTopic('chat', async () => true);
    const { id } = hub.connect('user-avery', testSink().sink);
    const answer = await hub.updateTopics({
      userId: 'user-avery',
      connectionId: id,
      add: ['chat:c1', 'chat:c2', 'chat:c3'],
    });
    expect(answer?.results.map((result) => result.ok)).toEqual([true, true, false]);
  });

  it('re-checks every 10 minutes and drops topics the user lost', async () => {
    makeHub();
    const members = new Set(['user-avery']);
    let checks = 0;
    hub.registerTopic('chat', async ({ userId }) => {
      checks++;
      return members.has(userId);
    });
    const tab = testSink();
    const { id } = hub.connect('user-avery', tab.sink);
    await hub.updateTopics({ userId: 'user-avery', connectionId: id, add: ['chat:c1'] });
    clock += 9 * 60_000;
    await hub.tick();
    expect(checks).toBe(1);
    clock += 60_000;
    await hub.tick();
    expect(checks).toBe(2);
    members.delete('user-avery');
    clock += 10 * 60_000;
    await hub.tick();
    expect(checks).toBe(3);
    expect(tab.frames().filter((frame) => frame.event === 'unsubscribed')).toEqual([
      { event: 'unsubscribed', data: { topic: 'chat:c1' } },
    ]);
    hub.publishTopic('chat:c1', { type: 'message-created' });
    expect(tab.events()).toEqual([]);
    expect(hub.stats().subscriptions).toBe(0);
  });

  it('re-checks at once after an access change, for one user or for everyone', async () => {
    makeHub();
    const members = new Set(['user-avery', 'user-sam']);
    const asked: string[] = [];
    hub.registerTopic('chat', async ({ userId }) => {
      asked.push(userId);
      return members.has(userId);
    });
    const avery = testSink();
    const sam = testSink();
    const averyTab = hub.connect('user-avery', avery.sink);
    const samTab = hub.connect('user-sam', sam.sink);
    await hub.updateTopics({ userId: 'user-avery', connectionId: averyTab.id, add: ['chat:c1'] });
    await hub.updateTopics({ userId: 'user-sam', connectionId: samTab.id, add: ['chat:c1'] });
    const unsubscribed = (tab: ReturnType<typeof testSink>) =>
      tab.frames().filter((frame) => frame.event === 'unsubscribed');

    asked.length = 0;
    members.delete('user-avery');
    await hub.recheckSubscriptions('user-avery');
    expect(asked).toEqual(['user-avery']);
    expect(unsubscribed(avery)).toEqual([{ event: 'unsubscribed', data: { topic: 'chat:c1' } }]);
    expect(unsubscribed(sam)).toEqual([]);

    members.delete('user-sam');
    await hub.recheckSubscriptions();
    expect(unsubscribed(sam)).toEqual([{ event: 'unsubscribed', data: { topic: 'chat:c1' } }]);
    expect(hub.stats().subscriptions).toBe(0);
  });

  it('never counts an answer that was given before the access change', async () => {
    makeHub();
    const answers: ((allowed: boolean) => void)[] = [];
    hub.registerTopic('chat', () => new Promise<boolean>((resolve) => answers.push(resolve)));
    const tab = testSink();
    const { id } = hub.connect('user-avery', tab.sink);
    const first = hub.updateTopics({ userId: 'user-avery', connectionId: id, add: ['chat:c1'] });
    await flushPromises();
    answers[0]?.(true);
    expect(await first).toEqual({ results: [{ topic: 'chat:c1', ok: true }] });

    // A periodic re-check of chat:c1 and a new subscribe to chat:c2 are still waiting...
    clock += 10 * 60_000;
    const periodic = hub.tick();
    const second = hub.updateTopics({ userId: 'user-avery', connectionId: id, add: ['chat:c2'] });
    await flushPromises();
    // ...when access changes.
    const forced = hub.recheckSubscriptions('user-avery');
    await flushPromises();
    expect(answers).toHaveLength(4);
    answers[1]?.(true); // the periodic re-check, from before the change
    answers[2]?.(true); // the subscribe, from before the change: it asks again
    answers[3]?.(false); // the re-check after the change
    await Promise.all([periodic, forced]);
    await flushPromises();
    expect(answers).toHaveLength(5);
    answers[4]?.(false);
    expect(await second).toEqual({ results: [{ topic: 'chat:c2', ok: false }] });
    expect(tab.frames().filter((frame) => frame.event === 'unsubscribed')).toEqual([
      { event: 'unsubscribed', data: { topic: 'chat:c1' } },
    ]);
    expect(hub.stats().subscriptions).toBe(0);
  });

  it('rejects malformed prefixes', () => {
    makeHub();
    expect(() => hub.registerTopic('Chat', async () => true)).toThrow('Invalid live topic prefix');
    expect(() => hub.registerTopic('a:b', async () => true)).toThrow('Invalid live topic prefix');
  });
});

describe('heartbeat and slow clients', () => {
  it('pings every connection on each tick', async () => {
    makeHub();
    const tab = testSink();
    hub.connect('user-avery', tab.sink);
    await hub.tick();
    expect(tab.frames().map((frame) => frame.event)).toEqual(['hello', 'ping']);
  });

  it('queues while the client is behind and flushes in order on drain', () => {
    makeHub();
    const tab = testSink();
    const connection = hub.connect('user-avery', tab.sink);
    tab.accept = false;
    hub.publishToUsers(['user-avery'], { type: 'a' });
    hub.publishToUsers(['user-avery'], { type: 'b' });
    hub.publishToUsers(['user-avery'], { type: 'c' });
    expect(tab.events().map((frame) => (frame.data as { type: string }).type)).toEqual(['a']);
    tab.accept = true;
    connection.drained();
    expect(tab.events().map((frame) => (frame.data as { type: string }).type)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('drops a client whose queue overflows', () => {
    makeHub({ maxQueuedFrames: 2 });
    const tab = testSink();
    hub.connect('user-avery', tab.sink);
    tab.accept = false;
    for (const type of ['a', 'b', 'c', 'd']) hub.publishToUsers(['user-avery'], { type });
    expect(tab.ended).toBe(true);
    expect(warnings).toEqual(['live: dropped a slow client']);
    expect(hub.stats().connections).toBe(0);
  });

  it('drops a client that stays blocked for two heartbeats', async () => {
    makeHub();
    const tab = testSink();
    hub.connect('user-avery', tab.sink);
    tab.accept = false;
    hub.publishToUsers(['user-avery'], { type: 'a' });
    clock += 25_000;
    await hub.tick();
    expect(tab.ended).toBe(false);
    clock += 25_000;
    await hub.tick();
    await flushPromises();
    expect(tab.ended).toBe(true);
    expect(warnings).toEqual(['live: dropped a stalled client']);
  });
});
