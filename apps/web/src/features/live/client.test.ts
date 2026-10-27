import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveClient, readCsrfToken, type LiveEvent } from './client';
import { createFakeLive, flush } from './testSource';

function recorder() {
  const events: LiveEvent[] = [];
  return { events, handler: (event: LiveEvent) => events.push(event) };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('LiveClient', () => {
  it('opens one stream, on the first handler', () => {
    const live = createFakeLive();
    expect(live.sources).toHaveLength(0);
    live.client.onEvent('notice-created', () => {});
    live.client.onTopic('chat:c-1', () => {});
    expect(live.urls).toEqual(['/api/live']);
    expect(live.client.state).toBe('connecting');
  });

  it('delivers per-user events to handlers of that type', async () => {
    const live = createFakeLive();
    const notices = recorder();
    const jobs = recorder();
    live.client.onEvent('notice-created', notices.handler);
    live.client.onEvent('job-updated', jobs.handler);
    await live.open();
    expect(live.client.state).toBe('open');
    live.last().emit('message', { type: 'job-updated', data: { jobId: 'j-1' } });
    live.last().emit('message', { type: 'job-updated' });
    live.last().emit('message', { nope: true });
    expect(jobs.events).toEqual([
      { type: 'job-updated', data: { jobId: 'j-1' } },
      { type: 'job-updated' },
    ]);
    expect(notices.events).toEqual([]);
  });

  it('keeps calling other handlers when one throws', async () => {
    const live = createFakeLive();
    const seen = recorder();
    const logged: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => logged.push(args);
    try {
      live.client.onEvent('job-updated', () => {
        throw new Error('boom');
      });
      live.client.onEvent('job-updated', seen.handler);
      await live.open();
      live.last().emit('message', { type: 'job-updated', data: { jobId: 'j-1' } });
    } finally {
      console.error = original;
    }
    expect(seen.events).toHaveLength(1);
    expect(logged).toHaveLength(1);
  });

  it('subscribes topics once the stream is open and routes their events', async () => {
    const live = createFakeLive({ refuse: ['chat:secret'], csrfToken: () => 'csrf-test' });
    const chat = recorder();
    live.client.onTopic('chat:c-1', chat.handler);
    live.client.onTopic('chat:secret', () => {});
    expect(live.requests).toHaveLength(0);
    await live.open('conn-1');
    expect(live.requests.map((request) => [request.url, request.body])).toEqual([
      [
        '/api/live/topics',
        { connectionId: 'conn-1', add: ['chat:c-1', 'chat:secret'], remove: [] },
      ],
    ]);
    expect(live.requests[0]?.headers).toEqual({
      'content-type': 'application/json',
      'x-csrf-token': 'csrf-test',
    });
    expect([...live.subscribed]).toEqual(['chat:c-1']);
    live
      .last()
      .emit('message', { topic: 'chat:c-1', type: 'message-created', data: { id: 'm-1' } });
    live.last().emit('message', { topic: 'chat:c-2', type: 'message-created' });
    expect(chat.events).toEqual([{ type: 'message-created', data: { id: 'm-1' } }]);

    // A refused topic isn't asked for again on the same connection.
    live.client.onTopic('chat:c-3', () => {});
    await flush();
    expect(live.requests.at(-1)?.body).toEqual({
      connectionId: 'conn-1',
      add: ['chat:c-3'],
      remove: [],
    });
  });

  it('removes a topic when its last handler leaves', async () => {
    const live = createFakeLive();
    const offA = live.client.onTopic('chat:c-1', () => {});
    const offB = live.client.onTopic('chat:c-1', () => {});
    live.client.onEvent('job-updated', () => {});
    await live.open('conn-1');
    offA();
    await flush();
    expect(live.requests).toHaveLength(1);
    offB();
    offB();
    await flush();
    expect(live.requests.at(-1)?.body).toEqual({
      connectionId: 'conn-1',
      add: [],
      remove: ['chat:c-1'],
    });
  });

  it('sends one request at a time and batches what changed meanwhile', async () => {
    const live = createFakeLive({ manual: true });
    live.client.onTopic('db:d-1', () => {});
    await live.open('conn-1');
    live.client.onTopic('db:d-2', () => {});
    live.client.onTopic('db:d-3', () => {});
    await flush();
    expect(live.requests).toHaveLength(1);
    live.requests[0]?.respond(200, [{ topic: 'db:d-1', ok: true }]);
    await flush();
    expect(live.requests.map((request) => request.body.add)).toEqual([
      ['db:d-1'],
      ['db:d-2', 'db:d-3'],
    ]);
  });

  it('reconnects with backoff, subscribes again, then sends live-reconnected to every handler', async () => {
    const live = createFakeLive();
    const jobs = recorder();
    const chat = recorder();
    live.client.onEvent('job-updated', jobs.handler);
    live.client.onTopic('chat:c-1', chat.handler);
    await live.open('conn-1');
    expect(jobs.events).toEqual([]);

    live.last().emit('error');
    expect(live.sources[0]?.closed).toBe(true);
    expect(live.client.state).toBe('waiting');
    vi.advanceTimersByTime(499);
    expect(live.sources).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(live.sources).toHaveLength(2);
    await live.open('conn-2');
    expect(live.requests.at(-1)?.body).toEqual({
      connectionId: 'conn-2',
      add: ['chat:c-1'],
      remove: [],
    });
    expect(jobs.events).toEqual([{ type: 'live-reconnected' }]);
    expect(chat.events).toEqual([{ type: 'live-reconnected' }]);
  });

  it('waits until topics are subscribed before sending live-reconnected', async () => {
    const live = createFakeLive({ manual: true });
    const chat = recorder();
    live.client.onTopic('chat:c-1', chat.handler);
    await live.open('conn-1');
    live.requests[0]?.respond(200, [{ topic: 'chat:c-1', ok: true }]);
    live.last().emit('error');
    vi.advanceTimersByTime(1_000);
    await live.open('conn-2');
    expect(chat.events).toEqual([]);
    live.requests[1]?.respond(200, [{ topic: 'chat:c-1', ok: true }]);
    await flush();
    expect(chat.events).toEqual([{ type: 'live-reconnected' }]);
  });

  it('doubles the delay up to 30 s, with jitter, and starts over after a long connection', async () => {
    const delays: number[] = [];
    const live = createFakeLive({ random: () => 1 });
    live.client.onEvent('job-updated', () => {});
    for (let i = 0; i < 7; i += 1) {
      const before = live.sources.length;
      live.last().emit('error');
      let waited = 0;
      while (live.sources.length === before) {
        vi.advanceTimersByTime(250);
        waited += 250;
      }
      delays.push(waited);
    }
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]);

    await live.open();
    vi.advanceTimersByTime(30_000);
    live.last().emit('ping', {});
    live.last().emit('error');
    vi.advanceTimersByTime(1_000);
    expect(live.sources).toHaveLength(9);
  });

  it('reconnects when the heartbeat stops', async () => {
    const live = createFakeLive();
    live.client.onEvent('job-updated', () => {});
    await live.open();
    vi.advanceTimersByTime(50_000);
    live.last().emit('ping', {});
    vi.advanceTimersByTime(54_999);
    expect(live.client.state).toBe('open');
    vi.advanceTimersByTime(1);
    expect(live.client.state).toBe('waiting');
    expect(live.sources[0]?.closed).toBe(true);
  });

  it('starts over when the server no longer knows the connection', async () => {
    const live = createFakeLive({ manual: true });
    live.client.onTopic('chat:c-1', () => {});
    await live.open('conn-1');
    live.requests[0]?.respond(404);
    await flush();
    expect(live.client.state).toBe('waiting');
    vi.advanceTimersByTime(1_000);
    expect(live.sources).toHaveLength(2);
  });

  it('ignores answers meant for an earlier connection', async () => {
    const live = createFakeLive({ manual: true });
    live.client.onTopic('chat:c-1', () => {});
    await live.open('conn-1');
    live.last().emit('error');
    vi.advanceTimersByTime(1_000);
    await live.open('conn-2');
    live.requests[0]?.respond(200, [{ topic: 'chat:c-1', ok: true }]);
    await flush();
    expect(live.requests.map((request) => request.body.connectionId)).toEqual(['conn-1', 'conn-2']);
  });

  it('parks after bye until the tab is used again', async () => {
    const live = createFakeLive();
    const jobs = recorder();
    live.client.onEvent('job-updated', jobs.handler);
    await live.open();
    live.last().emit('bye', { reason: 'replaced' });
    expect(live.client.state).toBe('parked');
    vi.advanceTimersByTime(120_000);
    expect(live.sources).toHaveLength(1);
    live.wake();
    expect(live.sources).toHaveLength(2);
    await live.open();
    expect(jobs.events).toEqual([{ type: 'live-reconnected' }]);
  });

  it('asks again for a withdrawn topic only after a reconnect', async () => {
    const live = createFakeLive();
    live.client.onTopic('chat:c-1', () => {});
    await live.open('conn-1');
    live.last().emit('unsubscribed', { topic: 'chat:c-1' });
    live.client.onTopic('chat:c-2', () => {});
    await flush();
    expect(live.requests.at(-1)?.body.add).toEqual(['chat:c-2']);
    live.last().emit('error');
    vi.advanceTimersByTime(1_000);
    await live.open('conn-2');
    expect(live.requests.at(-1)?.body.add).toEqual(['chat:c-1', 'chat:c-2']);
  });

  it('closes 10 s after the last handler leaves, unless another arrives', async () => {
    const live = createFakeLive();
    const off = live.client.onEvent('job-updated', () => {});
    await live.open();
    off();
    vi.advanceTimersByTime(9_000);
    const offAgain = live.client.onEvent('job-updated', () => {});
    vi.advanceTimersByTime(5_000);
    expect(live.client.state).toBe('open');
    offAgain();
    vi.advanceTimersByTime(10_000);
    expect(live.client.state).toBe('idle');
    expect(live.sources[0]?.closed).toBe(true);
  });

  it('stays quiet without EventSource', () => {
    const client = new LiveClient({ createSource: () => null });
    const off = client.onTopic('chat:c-1', () => {});
    expect(client.state).toBe('unsupported');
    off();
  });
});

describe('readCsrfToken', () => {
  it('reads the carehub_csrf cookie, or nothing', () => {
    expect(readCsrfToken('theme=dark; carehub_csrf=abc%3D123; other=1')).toBe('abc=123');
    expect(readCsrfToken('carehub_csrf=%E0%A4%A')).toBe('%E0%A4%A');
    expect(readCsrfToken('theme=dark')).toBe('');
    expect(readCsrfToken('')).toBe('');
  });
});
