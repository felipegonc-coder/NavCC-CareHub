import { describe, expect, it } from 'vitest';
import { writeQueue } from './queue';

/** A task that stays open until `finish` is called. */
function openTask(log: string[], name: string) {
  let finish: () => void = () => undefined;
  let fail: (error: Error) => void = () => undefined;
  const task = () =>
    new Promise<string>((resolve, reject) => {
      log.push(name);
      finish = () => resolve(name);
      fail = reject;
    });
  return { task, finish: () => finish(), fail: (error: Error) => fail(error) };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('writeQueue', () => {
  it('runs up to the limit at once, the rest in order as others finish', async () => {
    const queue = writeQueue(2);
    const log: string[] = [];
    const tasks = ['a', 'b', 'c', 'd'].map((name) => openTask(log, name));
    const answers = tasks.map((t) => queue(t.task));
    expect(log).toEqual(['a', 'b']);
    tasks[1]?.finish();
    await settle();
    expect(log).toEqual(['a', 'b', 'c']);
    tasks[0]?.finish();
    tasks[2]?.finish();
    await settle();
    expect(log).toEqual(['a', 'b', 'c', 'd']);
    tasks[3]?.finish();
    expect(await Promise.all(answers)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('frees the place of a task that fails, and passes the failure on', async () => {
    const queue = writeQueue(1);
    const log: string[] = [];
    const first = openTask(log, 'first');
    const answer = queue(first.task);
    const thrown = queue(() => {
      throw new Error('No');
    });
    const last = openTask(log, 'last');
    const after = queue(last.task);
    first.fail(new Error('Refused'));
    await expect(answer).rejects.toThrow('Refused');
    await expect(thrown).rejects.toThrow('No');
    await settle();
    expect(log).toEqual(['first', 'last']);
    last.finish();
    expect(await after).toBe('last');
  });
});
