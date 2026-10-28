import { describe, expect, it } from 'vitest';
import { createLimit } from './limit';

/** A task that runs until it's finished by hand. */
function gate() {
  let finish = (): void => undefined;
  let fail = (_error: Error): void => undefined;
  const done = new Promise<string>((resolve, reject) => {
    finish = () => resolve('done');
    fail = reject;
  });
  return { done, finish: () => finish(), fail: (error: Error) => fail(error) };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createLimit', () => {
  it('runs at most this many tasks at once, in the order they came', async () => {
    const limit = createLimit(2);
    const gates = [gate(), gate(), gate(), gate()];
    const started: number[] = [];
    const runs = gates.map((g, i) =>
      limit(() => {
        started.push(i);
        return g.done;
      }),
    );
    await tick();
    expect(started).toEqual([0, 1]);
    gates[1]!.finish();
    await tick();
    expect(started).toEqual([0, 1, 2]);
    gates[0]!.finish();
    await tick();
    expect(started).toEqual([0, 1, 2, 3]);
    gates[2]!.finish();
    gates[3]!.finish();
    expect(await Promise.all(runs)).toEqual(['done', 'done', 'done', 'done']);
  });

  it('never starts a task cancelled while it waits, and gives its place to the next', async () => {
    const limit = createLimit(1);
    const first = gate();
    const started: string[] = [];
    const run = (name: string, signal?: AbortSignal) =>
      limit(async () => {
        started.push(name);
        return name;
      }, signal);
    const running = limit(() => first.done);
    const controller = new AbortController();
    const cancelled = run('cancelled', controller.signal).catch((e: unknown) => e);
    const next = run('next');
    const reason = new Error('Stopped');
    controller.abort(reason);
    expect(await cancelled).toBe(reason);
    first.finish();
    expect(await running).toBe('done');
    expect(await next).toBe('next');
    expect(started).toEqual(['next']);
  });

  it('refuses a task whose signal is already cancelled', async () => {
    const limit = createLimit(1);
    let started = false;
    const error = await limit(
      async () => {
        started = true;
      },
      AbortSignal.abort(new Error('Too late')),
    ).catch((e: unknown) => e);
    expect((error as Error).message).toBe('Too late');
    expect(started).toBe(false);
  });

  it('lets a running task go on when its signal is cancelled; the task decides', async () => {
    const limit = createLimit(1);
    const controller = new AbortController();
    const g = gate();
    const running = limit(() => g.done, controller.signal);
    await tick();
    controller.abort(new Error('Stopped'));
    g.finish();
    expect(await running).toBe('done');
  });

  it('frees the place of a task that fails or throws', async () => {
    const limit = createLimit(1);
    const failing = gate();
    const failed = limit(() => failing.done).catch((e: unknown) => (e as Error).message);
    const thrown = limit(() => {
      throw new Error('Thrown');
    }).catch((e: unknown) => (e as Error).message);
    const after = limit(async () => 'after');
    failing.fail(new Error('Failed'));
    expect(await failed).toBe('Failed');
    expect(await thrown).toBe('Thrown');
    expect(await after).toBe('after');
  });

  it('needs a whole number above 0', () => {
    for (const max of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => createLimit(max)).toThrow(RangeError);
    }
  });
});
