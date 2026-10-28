// The per-person limit on view queries, with promises the test settles (no timing).
import { describe, expect, it } from 'vitest';
import { BUSY_MESSAGE, perPersonLimit } from './query-limit';

/** A promise, and the function that settles it. */
function gate() {
  let open = () => {};
  const done = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { done, open };
}

const BUSY = { statusCode: 429, code: 'rate_limited', message: BUSY_MESSAGE };

describe('view queries at once, per person', () => {
  it('runs two of one person’s queries at once and refuses a third until one ends', async () => {
    const limit = perPersonLimit(2);
    const first = gate();
    const second = gate();
    const a = limit.run('avery', () => first.done.then(() => 'a'));
    const b = limit.run('avery', () => second.done.then(() => 'b'));
    expect(limit.running('avery')).toBe(2);
    await expect(limit.run('avery', async () => 'c')).rejects.toMatchObject(BUSY);
    // Someone else isn't held up.
    await expect(limit.run('jordan', async () => 'j')).resolves.toBe('j');
    first.open();
    await expect(a).resolves.toBe('a');
    expect(limit.running('avery')).toBe(1);
    await expect(limit.run('avery', async () => 'd')).resolves.toBe('d');
    second.open();
    await expect(b).resolves.toBe('b');
    expect(limit.running('avery')).toBe(0);
  });

  it('gives the place back when a query fails', async () => {
    const limit = perPersonLimit(1);
    const failing = limit.run('avery', async () => {
      throw new Error('Postgres went away');
    });
    await expect(failing).rejects.toThrow('Postgres went away');
    expect(limit.running('avery')).toBe(0);
    await expect(limit.run('avery', async () => 'ok')).resolves.toBe('ok');
  });
});
