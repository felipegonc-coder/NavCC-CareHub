import { describe, expect, it } from 'vitest';
import { createMemoryJobStore } from './domain/memoryStore';
import { createJobRunner } from './domain/runner';
import { MAX_SHIFT_MS, runTestHook, type TestHookCall } from './testHook';
import { TEST_HOOK_TASKS } from './testHookTasks';

const T0 = Date.parse('2026-10-27T09:00:00.000Z');
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const LISTED = { 'reminders.sweep': 'Test task: reads only.', 'reminders.nothing': 'Not added.' };

/** `tasks: null` uses the real list in testHookTasks.ts. */
function setup(tasks: Readonly<Record<string, string>> | null = LISTED) {
  const runner = createJobRunner({ store: createMemoryJobStore(), now: () => T0 });
  const runs: string[] = [];
  let open: () => void = () => {};
  let gate: Promise<void> | null = null;
  runner.registerPeriodicTask('reminders.sweep', MINUTE, async (ctx) => {
    runs.push(ctx.now.toISOString());
    if (gate) await gate;
    return { sent: 2 };
  });
  const lines: { details: object; message: string }[] = [];
  const log = { info: (details: object, message: string) => lines.push({ details, message }) };
  const call = (input: Partial<TestHookCall> = {}) =>
    runTestHook(
      {
        userId: 'user-avery',
        isSiteAdmin: true,
        params: { name: 'reminders.sweep' },
        body: undefined,
        ...input,
      },
      { runner, log, tasks: tasks ?? undefined, now: () => T0 },
    );
  const hold = () => (gate = new Promise<void>((resolve) => (open = resolve)));
  return { runner, runs, lines, call, hold, release: () => open() };
}

describe('the allow-list', () => {
  it('leaves out deletions and anything that sends outside the server', () => {
    expect(Object.isFrozen(TEST_HOOK_TASKS)).toBe(true);
    expect(Object.hasOwn(TEST_HOOK_TASKS, 'jobs.cleanup')).toBe(false);
    for (const [name, reason] of Object.entries(TEST_HOOK_TASKS)) {
      expect(name).toMatch(/^[a-z][a-z0-9-]*(\.[a-z0-9-]+)+$/);
      expect(reason.trim().length).toBeGreaterThan(0);
    }
  });

  it('is 404 for a name not on it, even a real task such as jobs.cleanup', async () => {
    const listed = setup();
    const cleanup = await listed.call({ params: { name: 'jobs.cleanup' } });
    expect(cleanup).toMatchObject({ status: 404, body: { error: { code: 'not_found' } } });
    expect(await listed.call({ params: { name: 'reminders.unknown' } })).toMatchObject({
      status: 404,
    });
    // Listed, but no such task.
    expect(await listed.call({ params: { name: 'reminders.nothing' } })).toMatchObject({
      status: 404,
    });
    expect(await listed.call({ params: {} })).toMatchObject({ status: 404 });
    // Without `tasks`, the list in testHookTasks.ts.
    const plain = setup(null);
    expect(await plain.call()).toMatchObject({ status: 404 });
    expect(await plain.call({ params: { name: 'jobs.cleanup' } })).toMatchObject({ status: 404 });
    expect([...listed.runs, ...plain.runs]).toEqual([]);
  });
});

describe('runTestHook', () => {
  it('runs a listed task for a site admin at the given time, for that run only', async () => {
    const { runs, call } = setup();
    const now = '2027-03-01T15:00:00.000Z';
    const reply = await call({ body: { now } });
    expect(reply).toEqual({
      status: 200,
      body: { task: 'reminders.sweep', ok: true, counts: { sent: 2 }, ms: 0 },
    });
    // Only task, ok, counts and ms: no now, rows, names or ids.
    expect(Object.keys(reply.body).sort()).toEqual(['counts', 'ms', 'ok', 'task']);
    expect(await call()).toMatchObject({ status: 200 });
    expect(runs).toEqual([now, new Date(T0).toISOString()]);
  });

  it('answers 401 signed out and 403 for anyone but a site admin', async () => {
    const { runs, call } = setup();
    expect(await call({ userId: null })).toMatchObject({
      status: 401,
      body: { error: { code: 'signed_out' } },
    });
    expect(await call({ userId: 'user-sam', isSiteAdmin: false })).toMatchObject({
      status: 403,
      body: { error: { code: 'forbidden' } },
    });
    expect(runs).toEqual([]);
  });

  it('takes only { now? }, a valid date and time', async () => {
    const { runs, call } = setup();
    const now = '2027-03-01T15:00:00.000Z';
    for (const body of [{ now, task: 'jobs.cleanup' }, { now: 'Monday' }, { now: 5 }, [], 'now']) {
      expect(await call({ body })).toMatchObject({
        status: 400,
        body: { error: { code: 'invalid' } },
      });
    }
    expect(await call({ body: {} })).toMatchObject({ status: 200 });
    expect(await call({ body: null })).toMatchObject({ status: 200 });
    expect(runs).toHaveLength(2);
  });

  it('is 400 unless now is within a year of the real clock', async () => {
    const { runs, call } = setup();
    const at = (ms: number) => ({ body: { now: new Date(T0 + ms).toISOString() } });
    expect(await call(at(MAX_SHIFT_MS + 1))).toMatchObject({ status: 400 });
    expect(await call(at(-MAX_SHIFT_MS - 1))).toMatchObject({ status: 400 });
    expect(await call(at(MAX_SHIFT_MS))).toMatchObject({ status: 200 });
    expect(await call(at(-30 * DAY))).toMatchObject({ status: 200 });
    expect(runs).toHaveLength(2);
  });

  it('is 409 while the task runs, and never runs it twice at once', async () => {
    const { runs, call, hold, release } = setup();
    hold();
    const first = call();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(await call({ body: { now: '2027-03-01T15:00:00.000Z' } })).toEqual({
      status: 409,
      body: {
        error: { code: 'busy', message: 'This task is running now. Try again in a moment.' },
      },
    });
    release();
    expect(await first).toMatchObject({ status: 200, body: { ok: true } });
    expect(runs).toHaveLength(1);
  });

  it('says ok: false when the task fails', async () => {
    const { runner, call } = setup({ 'reminders.broken': 'Test task.' });
    runner.registerPeriodicTask('reminders.broken', MINUTE, async () => {
      throw new Error('Database is down');
    });
    expect(await call({ params: { name: 'reminders.broken' } })).toEqual({
      status: 200,
      body: { task: 'reminders.broken', ok: false, ms: 0 },
    });
  });

  it('logs one line per call: the user id, task, now and result, nothing else', async () => {
    const { lines, call } = setup();
    const now = '2027-03-01T15:00:00.000Z';
    await call({ body: { now } });
    await call({ userId: null });
    await call({ body: { now, note: 'Avery Lin, room 12' } });
    await call({ params: { name: 'jobs.cleanup' }, userId: 'user-sam' });
    expect(lines).toEqual([
      {
        message: 'jobs: test hook',
        details: { userId: 'user-avery', task: 'reminders.sweep', now, result: 'ran' },
      },
      {
        message: 'jobs: test hook',
        details: { userId: null, task: 'reminders.sweep', now: null, result: 'signed_out' },
      },
      {
        message: 'jobs: test hook',
        details: { userId: 'user-avery', task: 'reminders.sweep', now: null, result: 'invalid' },
      },
      {
        message: 'jobs: test hook',
        details: { userId: 'user-sam', task: 'jobs.cleanup', now: null, result: 'not_found' },
      },
    ]);
  });
});
