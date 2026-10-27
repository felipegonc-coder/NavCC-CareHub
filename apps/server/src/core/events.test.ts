import { describe, expect, it, vi } from 'vitest';
import { createTestApp, hasDatabase } from '../testing';
import { createEventBus } from './events';

declare module './events' {
  interface CareHubEvents {
    'test.ping': { id: string };
  }
}

type TestEvents = {
  'thing.done': { id: string };
  'other.done': { count: number };
};

function testBus() {
  const log = { error: vi.fn() };
  return { bus: createEventBus<TestEvents>(log), log };
}

describe('createEventBus', () => {
  it('runs handlers with the payload after emit returns', async () => {
    const { bus } = testBus();
    const seen: string[] = [];
    bus.on('thing.done', ({ id }) => {
      seen.push(`first ${id}`);
    });
    bus.on('thing.done', async ({ id }) => {
      seen.push(`second ${id}`);
    });
    bus.on('other.done', () => {
      seen.push('other');
    });

    bus.emit('thing.done', { id: 't1' });
    expect(seen).toEqual([]);
    await bus.settled();
    expect(seen).toEqual(['first t1', 'second t1']);
  });

  it('logs a failing handler, keeps it from the emitter and still runs the others', async () => {
    const { bus, log } = testBus();
    const ran = vi.fn();
    bus.on('thing.done', () => {
      throw new Error('sync failure');
    });
    bus.on('thing.done', async () => {
      throw new Error('async failure');
    });
    bus.on('thing.done', ran);

    expect(() => bus.emit('thing.done', { id: 't1' })).not.toThrow();
    await bus.settled();
    expect(ran).toHaveBeenCalledWith({ id: 't1' });
    expect(log.error).toHaveBeenCalledTimes(2);
    expect(log.error).toHaveBeenCalledWith(
      { err: new Error('sync failure'), event: 'thing.done' },
      'event handler failed',
    );
    expect(log.error).toHaveBeenCalledWith(
      { err: new Error('async failure'), event: 'thing.done' },
      'event handler failed',
    );
  });

  it('stops calling a handler once it is removed', async () => {
    const { bus } = testBus();
    const handler = vi.fn();
    const off = bus.on('thing.done', handler);
    bus.emit('thing.done', { id: 't1' });
    await bus.settled();
    off();
    bus.emit('thing.done', { id: 't2' });
    await bus.settled();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('waits for events emitted by handlers', async () => {
    const { bus } = testBus();
    const counted = vi.fn();
    bus.on('thing.done', () => bus.emit('other.done', { count: 1 }));
    bus.on('other.done', counted);
    bus.emit('thing.done', { id: 't1' });
    await bus.settled();
    expect(counted).toHaveBeenCalledWith({ count: 1 });
  });
});

describe.skipIf(!hasDatabase)('app.events', () => {
  it('lets running handlers finish before the app closes', async () => {
    const { app, close } = await createTestApp();
    let finished = false;
    app.events.on('test.ping', async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      finished = true;
    });
    app.events.emit('test.ping', { id: 'p1' });
    await close();
    expect(finished).toBe(true);
  });

  it('logs a failing handler with the app logger', async () => {
    const lines: string[] = [];
    const { app, close } = await createTestApp({
      logger: {
        level: 'error',
        stream: { write: (line: string | Uint8Array) => lines.push(String(line)) > 0 },
      },
    });
    app.events.on('test.ping', () => {
      throw new Error('handler failure');
    });
    expect(() => app.events.emit('test.ping', { id: 'p1' })).not.toThrow();
    await close();
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      expect.objectContaining({
        level: 50,
        msg: 'event handler failed',
        event: 'test.ping',
        err: expect.objectContaining({ message: 'handler failure' }),
      }),
    ]);
  });
});
