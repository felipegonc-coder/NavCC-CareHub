import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryJobStore } from './memoryStore';
import { createJobRunner, JobError, nextSlot, PERIODIC_KIND, type JobContext } from './runner';
import type { Job, JobStore } from './types';

const T0 = Date.parse('2026-10-27T09:00:00.000Z');
const SECOND = 1_000;
const MINUTE = 60 * SECOND;

function setup(store: JobStore = createMemoryJobStore()) {
  let clock = T0;
  const updates: Pick<Job, 'id' | 'status' | 'progress'>[] = [];
  const warnings: string[] = [];
  const runner = createJobRunner({
    store,
    now: () => clock,
    random: () => 0.5,
    onJobUpdated: (job) => updates.push({ id: job.id, status: job.status, progress: job.progress }),
    log: { warn: (_details, message) => warnings.push(message) },
  });
  return {
    runner,
    store,
    updates,
    warnings,
    at: (ms: number) => new Date(T0 + ms),
    setClock: (ms: number) => {
      clock = T0 + ms;
    },
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function flush(): Promise<void> {
  for (let i = 0; i < 50; i += 1) await Promise.resolve();
}

describe('scheduling and running', () => {
  it('runs a job with its payload and keeps the result', async () => {
    const { runner, store, updates } = setup();
    const seen: { payload: unknown; ctx: Omit<JobContext, 'signal' | 'setProgress'> }[] = [];
    runner.registerHandler<{ reminderId: string }>('reminders.fire', async (payload, ctx) => {
      seen.push({
        payload,
        ctx: { jobId: ctx.jobId, attempt: ctx.attempt, lateByMs: ctx.lateByMs },
      });
      expect(ctx.signal.aborted).toBe(false);
      return { fired: payload.reminderId };
    });
    const { jobId, created } = await runner.schedule({
      kind: 'reminders.fire',
      payload: { reminderId: 'rem-1' },
      ownerUserId: 'user-avery',
      workspaceId: 'ws-1',
    });
    expect(created).toBe(true);
    expect(await runner.drain()).toEqual({ ran: 1 });
    expect(seen).toEqual([
      { payload: { reminderId: 'rem-1' }, ctx: { jobId, attempt: 1, lateByMs: 0 } },
    ]);
    expect(await store.get(jobId)).toMatchObject({
      status: 'succeeded',
      result: { fired: 'rem-1' },
      error: null,
    });
    expect(updates.map((update) => update.status)).toEqual(['running', 'succeeded']);
    expect(await runner.drain()).toEqual({ ran: 0 });
  });

  it('dedupes by key while a job is unfinished', async () => {
    const { runner } = setup();
    runner.registerHandler('reminders.fire', async () => {});
    const key = 'rem-1@2026-10-27T09:00';
    const first = await runner.schedule({ kind: 'reminders.fire', payload: {}, key });
    expect(await runner.schedule({ kind: 'reminders.fire', payload: {}, key })).toEqual({
      jobId: first.jobId,
      created: false,
    });
    await runner.drain();
    expect((await runner.schedule({ kind: 'reminders.fire', payload: {}, key })).created).toBe(
      true,
    );
  });

  it('queues through the store on a caller’s transaction, when the store has one', async () => {
    const committed = createMemoryJobStore();
    const inTransaction = createMemoryJobStore();
    const sql = { query: async <T>() => ({ rows: [] as T[] }) };
    const seen: unknown[] = [];
    const { runner } = setup({
      ...committed,
      within: (tx) => {
        seen.push(tx);
        return inTransaction;
      },
    });
    const { jobId } = await runner.schedule({ kind: 'reminders.fire', payload: {} }, { sql });
    expect(seen).toEqual([sql]);
    expect(await inTransaction.get(jobId)).toMatchObject({ kind: 'reminders.fire' });
    expect(await committed.get(jobId)).toBeNull();
    // The memory store has no transactions: the job is queued at once.
    const memory = setup();
    const queued = await memory.runner.schedule({ kind: 'reminders.fire', payload: {} }, { sql });
    expect((await memory.store.get(queued.jobId))?.status).toBe('queued');
  });

  it('waits for runAt and reports how late it started', async () => {
    const { runner, at } = setup();
    const late: number[] = [];
    runner.registerHandler('reminders.fire', async (_payload, ctx) => {
      late.push(ctx.lateByMs);
    });
    await runner.schedule({ kind: 'reminders.fire', payload: {}, runAt: at(10 * MINUTE) });
    expect(await runner.drain()).toEqual({ ran: 0 });
    expect(await runner.drain({ now: at(12 * MINUTE) })).toEqual({ ran: 1 });
    expect(late).toEqual([2 * MINUTE]);
  });

  it('runs one job of a kind at a time by default', async () => {
    const { runner } = setup();
    let running = 0;
    let most = 0;
    runner.registerHandler('calendar.sync', async () => {
      running += 1;
      most = Math.max(most, running);
      await sleep(5);
      running -= 1;
    });
    for (let i = 0; i < 3; i += 1) await runner.schedule({ kind: 'calendar.sync', payload: { i } });
    expect(await runner.drain()).toEqual({ ran: 3 });
    expect(most).toBe(1);
  });

  it('rejects bad kinds, keys, payloads, dates and options', async () => {
    const { runner } = setup();
    const schedule = (input: object) =>
      runner.schedule({ kind: 'reminders.fire', payload: {}, ...input });
    await expect(schedule({ kind: 'Reminders' })).rejects.toThrow('Invalid job kind');
    await expect(schedule({ kind: PERIODIC_KIND })).rejects.toThrow('Invalid job kind');
    await expect(schedule({ key: '' })).rejects.toThrow('key');
    await expect(schedule({ payload: { blob: 'x'.repeat(17_000) } })).rejects.toThrow('over');
    await expect(schedule({ payload: undefined })).rejects.toThrow('JSON');
    await expect(schedule({ runAt: new Date('nope') })).rejects.toThrow('runAt');
    expect(() =>
      runner.registerHandler('reminders.fire', async () => {}, { timeoutMs: 31 * MINUTE }),
    ).toThrow(RangeError);
    expect(() =>
      runner.registerHandler('reminders.fire', async () => {}, { concurrency: 0 }),
    ).toThrow(RangeError);
    expect(() => runner.registerHandler(PERIODIC_KIND, async () => {})).toThrow('reserved');
    expect(() => runner.registerPeriodicTask('sweep', MINUTE, async () => {})).toThrow(
      'Invalid task name',
    );
  });
});

describe('failures', () => {
  it('retries with exponential backoff, then fails with a generic message', async () => {
    const { runner, store, at, warnings } = setup();
    const attempts: number[] = [];
    runner.registerHandler('calendar.sync', async (_payload, ctx) => {
      attempts.push(ctx.attempt);
      throw new Error('connection reset');
    });
    const { jobId } = await runner.schedule({ kind: 'calendar.sync', payload: {} });
    await runner.drain();
    let job = await store.get(jobId);
    expect(job).toMatchObject({ status: 'queued', attempts: 1, error: 'Something went wrong.' });
    expect(job?.runAt.toISOString()).toBe(at(MINUTE).toISOString());
    expect(await runner.drain({ now: at(MINUTE - 1) })).toEqual({ ran: 0 });

    await runner.drain({ now: at(MINUTE) });
    job = await store.get(jobId);
    expect(job?.runAt.toISOString()).toBe(at(3 * MINUTE).toISOString());
    await runner.drain({ now: at(3 * MINUTE) });
    expect(await store.get(jobId)).toMatchObject({
      status: 'failed',
      attempts: 3,
      error: 'Something went wrong.',
    });
    expect(attempts).toEqual([1, 2, 3]);
    expect(warnings.filter((message) => message === 'jobs: job failed')).toHaveLength(3);
  });

  it('fails at once on a JobError and retries one that asks for it', async () => {
    const { runner, store } = setup();
    runner.registerHandler<{ retry: boolean }>('automations.run', async ({ retry }) => {
      throw new JobError(retry ? 'The calendar is busy.' : 'The page was deleted.', { retry });
    });
    const permanent = await runner.schedule({ kind: 'automations.run', payload: { retry: false } });
    const temporary = await runner.schedule({ kind: 'automations.run', payload: { retry: true } });
    await runner.drain();
    expect(await store.get(permanent.jobId)).toMatchObject({
      status: 'failed',
      error: 'The page was deleted.',
    });
    expect(await store.get(temporary.jobId)).toMatchObject({
      status: 'queued',
      error: 'The calendar is busy.',
    });
  });

  it('fails a result over 64 KB without retrying', async () => {
    const { runner, store } = setup();
    runner.registerHandler('automations.run', async () => ({ text: 'x'.repeat(70_000) }));
    const { jobId } = await runner.schedule({ kind: 'automations.run', payload: {} });
    await runner.drain();
    expect(await store.get(jobId)).toMatchObject({
      status: 'failed',
      result: null,
      error: 'Something went wrong.',
    });
  });

  it('takes over a job whose worker crashed, and gives up after maxAttempts', async () => {
    const { runner, store, at } = setup();
    let runs = 0;
    runner.registerHandler('reminders.fire', async () => {
      runs += 1;
    });
    const crash = (ms: number) =>
      store.claim({
        kind: 'reminders.fire',
        limit: 1,
        workerId: 'gone',
        now: at(ms),
        lockedUntil: at(ms + SECOND),
      });
    const first = await runner.schedule({ kind: 'reminders.fire', payload: {} });
    await crash(0);
    expect(await runner.drain()).toEqual({ ran: 0 });
    await runner.drain({ now: at(2 * SECOND) });
    expect(await store.get(first.jobId)).toMatchObject({ status: 'succeeded', attempts: 2 });

    const second = await runner.schedule({ kind: 'reminders.fire', payload: {} });
    await crash(0);
    await crash(2 * SECOND);
    await crash(4 * SECOND);
    await runner.drain({ now: at(6 * SECOND) });
    expect(await store.get(second.jobId)).toMatchObject({
      status: 'failed',
      error: 'The job stopped responding.',
    });
    expect(runs).toBe(1);
  });
});

describe('timeouts, cancels and shutdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const waitForAbort = (ctx: JobContext) =>
    new Promise<void>((resolve) => ctx.signal.addEventListener('abort', () => resolve()));

  it('aborts a job that takes too long and retries it', async () => {
    const { runner, store } = setup();
    const reasons: unknown[] = [];
    runner.registerHandler(
      'calendar.sync',
      async (_payload, ctx) => {
        await waitForAbort(ctx);
        reasons.push((ctx.signal.reason as DOMException).name);
        await new Promise(() => {}); // Ignores the abort.
      },
      { timeoutMs: 2 * SECOND },
    );
    const { jobId } = await runner.schedule({ kind: 'calendar.sync', payload: {} });
    const drained = runner.drain();
    await flush();
    vi.advanceTimersByTime(2 * SECOND);
    await drained;
    expect(reasons).toEqual(['TimeoutError']);
    expect(await store.get(jobId)).toMatchObject({
      status: 'queued',
      attempts: 1,
      error: 'The job took too long.',
    });
  });

  it('cancels queued jobs, and running ones here or in another process', async () => {
    const { runner, store, updates } = setup();
    let started = 0;
    runner.registerHandler('calendar.sync', async (_payload, ctx) => {
      started += 1;
      await waitForAbort(ctx);
    });
    const queued = await runner.schedule({
      kind: 'calendar.sync',
      payload: {},
      runAt: new Date(T0 + MINUTE),
    });
    expect(await runner.cancel(queued.jobId)).toMatchObject({ status: 'cancelled' });
    expect(updates.at(-1)).toMatchObject({ id: queued.jobId, status: 'cancelled' });

    const here = await runner.schedule({ kind: 'calendar.sync', payload: {} });
    let drained = runner.drain();
    await flush();
    await runner.cancel(here.jobId);
    await drained;
    expect(await store.get(here.jobId)).toMatchObject({ status: 'cancelled' });

    const elsewhere = await runner.schedule({ kind: 'calendar.sync', payload: {} });
    drained = runner.drain();
    await flush();
    await store.cancel(elsewhere.jobId, new Date(T0));
    await runner.tick();
    await drained;
    expect(await store.get(elsewhere.jobId)).toMatchObject({ status: 'cancelled' });
    expect(started).toBe(2);
    expect(await runner.cancel('no-such-job')).toBeNull();
  });

  it('lets running jobs finish on stop, for up to 5 s, then puts them back', async () => {
    const { runner, store } = setup();
    runner.registerHandler('calendar.sync', async (_payload, ctx) => waitForAbort(ctx));
    runner.registerHandler('reminders.fire', async () => {
      await sleep(1_000);
      return 'done';
    });
    const slow = await runner.schedule({ kind: 'calendar.sync', payload: {} });
    const quick = await runner.schedule({ kind: 'reminders.fire', payload: {} });
    await runner.start();
    vi.advanceTimersByTime(0);
    await flush();
    expect((await store.get(slow.jobId))?.status).toBe('running');

    const stopped = runner.stop();
    vi.advanceTimersByTime(1_000);
    await flush();
    expect(await store.get(quick.jobId)).toMatchObject({ status: 'succeeded', result: 'done' });
    expect((await store.get(slow.jobId))?.status).toBe('running');
    vi.advanceTimersByTime(4_000);
    await stopped;
    expect(await store.get(slow.jobId)).toMatchObject({ status: 'queued', attempts: 0 });
  });
});

describe('progress', () => {
  it('saves progress at most twice a second and keeps the last value', async () => {
    const { runner, store, updates } = setup();
    runner.registerHandler('automations.run', async (_payload, ctx) => {
      ctx.setProgress({ done: 1, total: 3 });
      await sleep(20);
      ctx.setProgress({ done: 2, total: 3 });
      ctx.setProgress({ done: 3, total: 3, label: 'Sending messages' });
    });
    const { jobId } = await runner.schedule({
      kind: 'automations.run',
      payload: {},
      ownerUserId: 'user-sam',
    });
    await runner.drain();
    expect(updates.map((update) => [update.status, update.progress])).toEqual([
      ['running', null],
      ['running', { done: 1, total: 3 }],
      ['succeeded', { done: 3, total: 3, label: 'Sending messages' }],
    ]);
    expect((await store.get(jobId))?.progress).toEqual({
      done: 3,
      total: 3,
      label: 'Sending messages',
    });
  });

  it('fails the job on nonsense progress', async () => {
    const { runner, store } = setup();
    runner.registerHandler(
      'automations.run',
      async (_payload, ctx) => ctx.setProgress({ done: -1 }),
      {
        maxAttempts: 1,
      },
    );
    const { jobId } = await runner.schedule({ kind: 'automations.run', payload: {} });
    await runner.drain();
    expect((await store.get(jobId))?.status).toBe('failed');
  });
});

describe('periodic tasks', () => {
  it('queues the next run on the grid, one at a time across processes', async () => {
    const store = createMemoryJobStore();
    const a = setup(store);
    const b = setup(store);
    const runs: { process: string; lateByMs: number }[] = [];
    for (const [name, { runner }] of [
      ['a', a],
      ['b', b],
    ] as const) {
      runner.registerPeriodicTask('reminders.sweep', MINUTE, async (ctx) => {
        runs.push({ process: name, lateByMs: ctx.lateByMs });
      });
    }
    expect(nextSlot(T0 + 1, MINUTE)).toBe(T0 + MINUTE);
    await a.runner.start();
    await b.runner.start();
    try {
      await a.runner.tick();
      await b.runner.tick();
      for (const step of [MINUTE + 5 * SECOND, 2 * MINUTE + 5 * SECOND]) {
        a.setClock(step);
        b.setClock(step);
        await Promise.all([a.runner.tick(), b.runner.tick()]);
        await sleep(10);
        await Promise.all([a.runner.tick(), b.runner.tick()]);
      }
    } finally {
      await a.runner.stop();
      await b.runner.stop();
    }
    expect(runs.map((run) => run.lateByMs)).toEqual([5 * SECOND, 5 * SECOND]);
  });

  it('gives each run the time it started as ctx.now', async () => {
    const { runner, setClock } = setup();
    const times: number[] = [];
    runner.registerPeriodicTask('reminders.sweep', MINUTE, async (ctx) => {
      times.push(ctx.now.getTime());
    });
    await runner.start();
    try {
      await runner.tick();
      setClock(MINUTE + 5 * SECOND);
      await runner.tick();
      await sleep(10);
    } finally {
      await runner.stop();
    }
    expect(times).toEqual([T0 + MINUTE + 5 * SECOND]);
  });

  it('runs a task once off its grid for a test hook, at the time it gives', async () => {
    const { runner } = setup();
    const runs: { now: number; attempt: number; aborted: boolean }[] = [];
    runner.registerPeriodicTask('reminders.sweep', MINUTE, async (ctx) => {
      runs.push({ now: ctx.now.getTime(), attempt: ctx.attempt, aborted: ctx.signal.aborted });
    });
    const now = new Date('2026-10-26T15:00:00.000Z');
    expect(await runner.runPeriodicTask('reminders.sweep', { now })).toBe(true);
    expect(await runner.runPeriodicTask('reminders.sweep')).toBe(true);
    expect(await runner.runPeriodicTask('reminders.nothing')).toBe(false);
    expect(runs).toEqual([
      { now: now.getTime(), attempt: 1, aborted: false },
      { now: T0, attempt: 1, aborted: false },
    ]);
  });

  it('cleans up finished jobs after 7 days', async () => {
    const { runner, store, setClock } = setup();
    runner.registerHandler('reminders.fire', async () => {});
    const old = await runner.schedule({ kind: 'reminders.fire', payload: {} });
    await runner.drain();
    setClock(7 * 24 * 60 * MINUTE + 30 * MINUTE);
    const recent = await runner.schedule({ kind: 'reminders.fire', payload: {} });
    await runner.drain();
    await runner.start();
    try {
      await runner.tick();
      setClock(7 * 24 * 60 * MINUTE + 60 * MINUTE);
      await runner.tick();
      await sleep(10);
    } finally {
      await runner.stop();
    }
    expect(await store.get(old.jobId)).toBeNull();
    expect(await store.get(recent.jobId)).not.toBeNull();
  });
});

describe('ticks', () => {
  it('keeps ticking after a pass that had nothing to do', async () => {
    const { runner, store } = setup();
    let runs = 0;
    runner.registerHandler('reminders.fire', async () => {
      runs += 1;
    });
    await runner.tick();
    await runner.tick();
    const { jobId } = await runner.schedule({
      kind: 'reminders.fire',
      payload: {},
      runAt: new Date(T0 + MINUTE),
    });
    await runner.start();
    try {
      await runner.tick();
      expect(runs).toBe(0);
      await store.cancel(jobId, new Date(T0));
      await runner.schedule({ kind: 'reminders.fire', payload: {} });
      await Promise.all([runner.tick(), runner.tick()]);
      await sleep(5);
    } finally {
      await runner.stop();
    }
    expect(runs).toBe(1);
  });
});

describe('onFailed', () => {
  it('runs once, after the last attempt fails, with the payload and the reason', async () => {
    const { runner, at } = setup();
    const failed: unknown[] = [];
    runner.registerHandler<{ automationId: string }>(
      'automations.run',
      async () => {
        throw new Error('connection reset');
      },
      { maxAttempts: 2, onFailed: (payload, failure) => failed.push({ payload, failure }) },
    );
    const { jobId } = await runner.schedule({
      kind: 'automations.run',
      payload: { automationId: 'auto-1' },
    });
    await runner.drain();
    expect(failed).toEqual([]);
    await runner.drain({ now: at(MINUTE) });
    expect(failed).toEqual([
      {
        payload: { automationId: 'auto-1' },
        failure: { jobId, attempts: 2, error: 'Something went wrong.' },
      },
    ]);
    await runner.drain({ now: at(60 * MINUTE) });
    expect(failed).toHaveLength(1);
  });

  it('passes on a JobError’s message, and stays quiet on success and cancel', async () => {
    const { runner } = setup();
    const errors: string[] = [];
    runner.registerHandler<{ ok: boolean }>(
      'automations.run',
      async ({ ok }) => {
        if (!ok) throw new JobError('Sam Ortiz can’t open QA reviews anymore.');
      },
      { onFailed: (_payload, { error }) => errors.push(error) },
    );
    await runner.schedule({ kind: 'automations.run', payload: { ok: true } });
    await runner.schedule({ kind: 'automations.run', payload: { ok: false } });
    const cancelled = await runner.schedule({
      kind: 'automations.run',
      payload: { ok: false },
      runAt: new Date(T0 + MINUTE),
    });
    await runner.cancel(cancelled.jobId);
    await runner.drain({ now: new Date(T0 + MINUTE) });
    expect(errors).toEqual(['Sam Ortiz can’t open QA reviews anymore.']);
  });

  it('runs when a job stops responding, and logs its own errors', async () => {
    const { runner, store, at, warnings } = setup();
    const errors: string[] = [];
    runner.registerHandler('reminders.fire', async () => {}, {
      maxAttempts: 1,
      onFailed: (_payload, { error }) => {
        errors.push(error);
        throw new Error('notice service down');
      },
    });
    const { jobId } = await runner.schedule({ kind: 'reminders.fire', payload: {} });
    await store.claim({
      kind: 'reminders.fire',
      limit: 1,
      workerId: 'gone',
      now: at(0),
      lockedUntil: at(SECOND),
    });
    await runner.drain({ now: at(2 * SECOND) });
    expect(await store.get(jobId)).toMatchObject({
      status: 'failed',
      error: 'The job stopped responding.',
    });
    expect(errors).toEqual(['The job stopped responding.']);
    expect(warnings).toContain('jobs: onFailed failed');
    expect(() =>
      runner.registerHandler('reminders.fire', async () => {}, { onFailed: 'no' as never }),
    ).toThrow('onFailed');
  });
});
