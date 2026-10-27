import { describe, expect, it } from 'vitest';
import {
  createEventQueue,
  isRetryable,
  type DroppedEvents,
  type QueueStorage,
} from './event-queue';
import { LearningApiError } from './http';

type TestEvent = { id: string; kind: string };
const event = (id: string): TestEvent => ({ id, kind: 'block_viewed' });

class MemoryStorage implements QueueStorage {
  readonly items = new Map<string, string>();
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
}

const offline = () => new LearningApiError(0, 'offline', 'Offline');

function setup(options: { batchSize?: number; maxEvents?: number; userId?: string } = {}) {
  const storage = new MemoryStorage();
  const sent: string[] = [];
  const dropped: DroppedEvents<TestEvent>[] = [];
  let fail: (() => unknown) | null = null;
  const queue = createEventQueue<TestEvent>({
    userId: options.userId ?? 'user-1',
    storage,
    batchSize: options.batchSize,
    maxEvents: options.maxEvents,
    send: async (courseId, events) => {
      const error = fail?.();
      if (error) throw error;
      sent.push(`${courseId}: ${events.map((e) => e.id).join(' ')}`);
    },
    onDrop: (info) => dropped.push(info),
  });
  return {
    queue,
    storage,
    sent,
    dropped,
    failWith: (next: (() => unknown) | null) => (fail = next),
  };
}

describe('offline event queue', () => {
  it('sends events in batches, course by course, oldest first', async () => {
    const { queue, sent } = setup({ batchSize: 2 });
    await queue.add('c1', [event('a'), event('b'), event('c')]);
    expect(sent).toEqual(['c1: a b', 'c1: c']);
    expect(queue.pending()).toEqual([]);
  });

  it('keeps events while offline and sends them later', async () => {
    const { queue, sent, failWith } = setup();
    failWith(offline);
    await queue.add('c1', [event('a')]);
    await queue.add('c2', [event('b')]);
    expect(sent).toEqual([]);
    expect(queue.pending().map((e) => e.id)).toEqual(['a', 'b']);
    expect(queue.pending('c2').map((e) => e.id)).toEqual(['b']);
    failWith(null);
    await queue.flush();
    expect(sent).toEqual(['c1: a', 'c2: b']);
    expect(queue.pending()).toEqual([]);
  });

  it('keeps waiting events in storage, so a reload still sends them', async () => {
    const first = setup();
    first.failWith(offline);
    await first.queue.add('c1', [event('a')]);
    const sent: string[] = [];
    const again = createEventQueue<TestEvent>({
      userId: 'user-1',
      storage: first.storage,
      send: async (courseId, events) => {
        sent.push(`${courseId}: ${events.map((e) => e.id).join(' ')}`);
      },
    });
    await again.flush();
    expect(sent).toEqual(['c1: a']);
  });

  it("never sends one person's events as someone else's", async () => {
    const first = setup({ userId: 'user-1' });
    first.failWith(offline);
    await first.queue.add('c1', [event('a')]);
    const other = createEventQueue<TestEvent>({
      userId: 'user-2',
      storage: first.storage,
      send: async () => {
        throw new Error('nothing should be sent');
      },
    });
    expect(other.pending()).toEqual([]);
    await other.flush();
    expect(first.queue.pending().map((e) => e.id)).toEqual(['a']);
  });

  it('drops a batch the server refuses for good and goes on with the rest', async () => {
    const { queue, sent, dropped, failWith } = setup();
    failWith(offline);
    await queue.add('c1', [event('a')]);
    await queue.add('c2', [event('b')]);
    let first = true;
    failWith(() => {
      if (!first) return null;
      first = false;
      return new LearningApiError(404, 'not_found', 'Gone');
    });
    await queue.flush();
    expect(dropped.map((d) => [d.courseId, d.reason, d.events.map((e) => e.id)])).toEqual([
      ['c1', 'refused', ['a']],
    ]);
    expect(sent).toEqual(['c2: b']);
  });

  it('skips ids that are already waiting', async () => {
    const { queue, failWith } = setup();
    failWith(offline);
    await queue.add('c1', [event('a'), event('a')]);
    await queue.add('c1', [event('a'), event('b')]);
    expect(queue.pending().map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('drops the oldest events beyond the limit', async () => {
    const { queue, dropped, failWith } = setup({ maxEvents: 2 });
    failWith(offline);
    await queue.add('c1', [event('a'), event('b')]);
    await queue.add('c2', [event('c')]);
    expect(queue.pending().map((e) => e.id)).toEqual(['b', 'c']);
    expect(dropped.map((d) => [d.courseId, d.reason, d.events.map((e) => e.id)])).toEqual([
      ['c1', 'full', ['a']],
    ]);
  });

  it('keeps working in memory when storage is full or broken', async () => {
    const sent: string[] = [];
    let online = false;
    const queue = createEventQueue<TestEvent>({
      userId: 'user-1',
      storage: {
        getItem: () => null,
        setItem: () => {
          throw new Error('QuotaExceededError');
        },
      },
      send: async (courseId, events) => {
        if (!online) throw offline();
        sent.push(`${courseId}: ${events.map((e) => e.id).join(' ')}`);
      },
    });
    await queue.add('c1', [event('a')]);
    expect(queue.pending().map((e) => e.id)).toEqual(['a']);
    online = true;
    await queue.flush();
    expect(sent).toEqual(['c1: a']);
    expect(queue.pending()).toEqual([]);
  });

  it('ignores stored data it cannot read', async () => {
    const storage = new MemoryStorage();
    storage.setItem('carehub.learning.events.v1:user-1', '{not json');
    const queue = createEventQueue<TestEvent>({ userId: 'user-1', storage, send: async () => {} });
    expect(queue.pending()).toEqual([]);
    storage.setItem('carehub.learning.events.v1:user-1', JSON.stringify([{ courseId: 'c1' }, 'x']));
    expect(queue.pending()).toEqual([]);
  });

  it('sends one batch at a time, even when flushed twice', async () => {
    let inFlight = 0;
    let most = 0;
    const queue = createEventQueue<TestEvent>({
      userId: 'user-1',
      storage: null,
      batchSize: 1,
      send: async () => {
        inFlight += 1;
        most = Math.max(most, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight -= 1;
      },
    });
    await Promise.all([queue.add('c1', [event('a'), event('b')]), queue.flush(), queue.flush()]);
    expect(most).toBe(1);
    expect(queue.pending()).toEqual([]);
  });

  it('tells listeners about changes until they stop listening', async () => {
    const { queue, failWith } = setup();
    failWith(offline);
    let changes = 0;
    const stop = queue.subscribe(() => (changes += 1));
    await queue.add('c1', [event('a')]);
    queue.clear();
    expect(queue.pending()).toEqual([]);
    const seen = changes;
    expect(seen).toBeGreaterThanOrEqual(2);
    stop();
    await queue.add('c1', [event('b')]);
    expect(changes).toBe(seen);
  });

  it('retries when offline, signed out, rate limited or on server errors only', () => {
    const retry = (status: number) => isRetryable(new LearningApiError(status, 'x', 'x'));
    expect([0, 401, 408, 429, 500, 503].map(retry)).toEqual([true, true, true, true, true, true]);
    expect([400, 403, 404, 409, 413, 422].map(retry)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(isRetryable(new Error('bug'))).toBe(true);
  });
});
