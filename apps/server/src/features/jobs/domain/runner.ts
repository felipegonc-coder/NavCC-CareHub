import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import type { Fence, Job, JobProgress, JobStore, JsonValue, SqlRunner } from './types';

export interface JobContext {
  jobId: string;
  /** 1 on the first try. */
  attempt: number;
  /** How long after its due time this attempt started (retries included). */
  lateByMs: number;
  /** Aborted on timeout, cancel and shutdown. Pass it on to fetch and database calls. */
  signal: AbortSignal;
  /** Saved at most twice a second; each save nudges the owner. */
  setProgress(progress: JobProgress): void;
}

export type JobHandler<P> = (payload: P, ctx: JobContext) => Promise<JsonValue | void>;

export interface PeriodicTaskContext extends JobContext {
  /** The time the run counts as: when it started, or the time a test hook gave. */
  now: Date;
}

export type PeriodicTask = (ctx: PeriodicTaskContext) => Promise<void>;

/** Why a job failed for good: its last attempt failed, timed out or stopped responding. */
export interface JobFailure {
  jobId: string;
  attempts: number;
  /** The user-facing reason, as saved on the job. */
  error: string;
}

export interface JobHandlerOptions<P = unknown> {
  /** Default 3. */
  maxAttempts?: number;
  /** Per attempt. Default 5 minutes, at most 30. */
  timeoutMs?: number;
  /** Jobs of this kind running at once in each process. Default 1. */
  concurrency?: number;
  /** Called once when the job fails for good (not between retries). Errors are logged. */
  onFailed?: (payload: P, failure: JobFailure) => unknown;
}

export interface ScheduleJobInput<P> {
  kind: string;
  payload: P;
  /** Dedupes among unfinished jobs of this kind. */
  key?: string;
  runAt?: Date;
  workspaceId?: string;
  ownerUserId?: string;
}

export interface ScheduleOptions {
  /**
   * A caller's transaction: the job is added through `store.within(sql)`, so it exists only once
   * the transaction commits, and the next poll (within 5 s) picks it up. A store without `within`
   * (memory) adds it at once.
   */
  sql?: SqlRunner;
}

export interface JobLogger {
  warn(details: object, message: string): void;
}

/** A permanent failure whose message the user may see. With `retry: true` it's temporary. */
export class JobError extends Error {
  readonly retry: boolean;

  constructor(message: string, options: { retry?: boolean } = {}) {
    super(message);
    this.name = 'JobError';
    this.retry = options.retry ?? false;
  }
}

export interface JobRunnerOptions {
  store: JobStore;
  /** After each change the owner may want to see: start, progress and end. */
  onJobUpdated?: (job: Job) => void;
  log?: JobLogger;
  now?: () => number;
  random?: () => number;
}

export type JobRunner = ReturnType<typeof createJobRunner>;

const KIND = /^[a-z][a-z0-9-]*(\.[a-z0-9-]+)+$/;
export const PERIODIC_KIND = 'jobs.periodic';
const MINUTE = 60_000;
const POLL_MS = 5_000;
const LOCK_GRACE_MS = MINUTE;
const STOP_GRACE_MS = 5_000;
const KEEP_FINISHED_MS = 7 * 24 * 60 * MINUTE;
const FAILED = 'Something went wrong.';
/** How long one run of a periodic task may take. */
const PERIODIC_TIMEOUT_MS = 5 * MINUTE;

interface Kind {
  handler: JobHandler<never>;
  onFailed: ((payload: never, failure: JobFailure) => unknown) | undefined;
  maxAttempts: number;
  timeoutMs: number;
  concurrency: number;
  running: number;
}

interface Active {
  controller: AbortController;
  reason: 'timeout' | 'cancel' | 'shutdown' | null;
}

function whole(
  name: string,
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
) {
  if (value === undefined) return fallback;
  if (Number.isInteger(value) && value >= min && value <= max) return value;
  throw new RangeError(`${name} must be a whole number from ${min} to ${max}.`);
}

function toJson(value: unknown, what: string, maxBytes: number): JsonValue {
  const json = JSON.stringify(value);
  if (json === undefined) throw new TypeError(`The job ${what} must be JSON.`);
  if (Buffer.byteLength(json) > maxBytes)
    throw new RangeError(`The job ${what} is over ${maxBytes} bytes.`);
  return JSON.parse(json) as JsonValue;
}

function cleanProgress({ done, total, label }: JobProgress): JobProgress {
  const count = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  if (!count(done) || (total !== undefined && !count(total))) {
    throw new RangeError('Job progress needs done (and total) of 0 or more.');
  }
  const progress: JobProgress = { done };
  if (total !== undefined) progress.total = total;
  if (label !== undefined) progress.label = String(label).slice(0, 200);
  return progress;
}

/** Settles like `work`, but rejects with the abort reason as soon as `signal` aborts. */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    if (signal.aborted) onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

async function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<false>((resolve) => (timer = setTimeout(resolve, ms, false)));
  const settled = await Promise.race([promise.then(() => true), late]);
  clearTimeout(timer);
  return settled;
}

/** The first point of the task's grid (multiples of `everyMs` since 1970) after `ms`. */
export function nextSlot(ms: number, everyMs: number): number {
  return (Math.floor(ms / everyMs) + 1) * everyMs;
}

/**
 * Runs jobs from a JobStore: claims due ones (and ones a crashed worker left behind), runs them
 * with a timeout, retries failures with exponential backoff and records the outcome. Periodic
 * tasks are jobs keyed by their name, so only one run is ever queued or running.
 */
export function createJobRunner(options: JobRunnerOptions) {
  let store = options.store;
  let log: JobLogger = options.log ?? { warn: () => {} };
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const workerId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  const kinds = new Map<string, Kind>();
  const tasks = new Map<string, { everyMs: number; run: PeriodicTask; checkAt: number }>();
  const active = new Map<string, Active>();
  const inflight = new Set<Promise<void>>();
  let starts = 0;
  let stopping = false;
  let ticking: Promise<void> | null = null;
  let tickAgain = false;
  let interval: ReturnType<typeof setInterval> | undefined;
  let poked: ReturnType<typeof setTimeout> | undefined;

  function warn(details: object, message: string): void {
    try {
      log.warn(details, message);
    } catch {
      // Logging never breaks the runner.
    }
  }

  function notify(job: Job): void {
    try {
      options.onJobUpdated?.(job);
    } catch (error) {
      warn({ err: error, jobId: job.id }, 'jobs: onJobUpdated failed');
    }
  }

  function abort(entry: Active, reason: NonNullable<Active['reason']>): void {
    if (entry.reason) return;
    entry.reason = reason;
    const name = reason === 'timeout' ? 'TimeoutError' : 'AbortError';
    entry.controller.abort(new DOMException(`The job was stopped (${reason}).`, name));
  }

  /** Saves progress at most every 500 ms; the newest value always wins. */
  function progressSaver(job: Job, fence: Fence, clock: () => number) {
    let pending: JobProgress | null = null;
    let savedAt = -Infinity;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    const save = () => {
      timer = undefined;
      const progress = pending;
      if (!progress || closed) return;
      pending = null;
      savedAt = clock();
      store.setProgress(job.id, fence, progress, new Date(savedAt)).then(
        (saved) => saved && notify({ ...job, progress }),
        (error: unknown) => warn({ err: error, jobId: job.id }, 'jobs: saving progress failed'),
      );
    };
    return {
      set(progress: JobProgress) {
        if (closed) return;
        pending = cleanProgress(progress);
        if (!timer) timer = setTimeout(save, Math.max(0, savedAt + 500 - clock()));
      },
      /** Stops saving and returns what wasn't saved yet. */
      close() {
        closed = true;
        clearTimeout(timer);
        return pending;
      },
    };
  }

  async function execute(kind: Kind, job: Job, clock: () => number): Promise<void> {
    const fence: Fence = { workerId, attempt: job.attempts };
    let unsaved: JobProgress | null = null;
    const finish = async (
      status: 'succeeded' | 'failed' | 'cancelled',
      result: JsonValue,
      error: string | null,
    ) => {
      const input = { status, result, error, progress: unsaved, now: new Date(clock()) };
      return store.finish(job.id, fence, input);
    };
    const requeue = (runAt: number, error: string | null, countAttempt: boolean) =>
      store.requeue(job.id, fence, {
        runAt: new Date(runAt),
        error,
        now: new Date(clock()),
        countAttempt,
      });

    let outcome: Promise<Job | null>;
    if (job.cancelRequested) outcome = finish('cancelled', null, null);
    else if (job.attempts > kind.maxAttempts)
      outcome = finish('failed', null, 'The job stopped responding.');
    else {
      const entry: Active = { controller: new AbortController(), reason: null };
      active.set(job.id, entry);
      const timeout = setTimeout(() => abort(entry, 'timeout'), kind.timeoutMs);
      const progress = progressSaver(job, fence, clock);
      const ctx: JobContext = {
        jobId: job.id,
        attempt: job.attempts,
        lateByMs: Math.max(0, clock() - job.dueAt.getTime()),
        signal: entry.controller.signal,
        setProgress: (value) => progress.set(value),
      };
      notify(job);
      let failure: { error: unknown } | null = null;
      let result: JsonValue = null;
      try {
        const work = Promise.resolve().then(() => kind.handler(job.payload as never, ctx));
        const value = await untilAborted(work, entry.controller.signal);
        try {
          result = toJson(value ?? null, 'result', 64 * 1024);
        } catch (error) {
          warn({ err: error, jobId: job.id, kind: job.kind }, 'jobs: the result was not saved');
          failure = { error: new JobError(FAILED) };
        }
      } catch (error) {
        failure = { error };
      } finally {
        clearTimeout(timeout);
        active.delete(job.id);
        unsaved = progress.close();
      }
      const error = failure?.error;
      const retryable = !(error instanceof JobError) || error.retry;
      const message =
        entry.reason === 'timeout'
          ? 'The job took too long.'
          : error instanceof JobError
            ? error.message
            : FAILED;
      if (failure && !entry.reason && !(error instanceof JobError)) {
        warn(
          { err: error, jobId: job.id, kind: job.kind, attempt: job.attempts },
          'jobs: job failed',
        );
      }
      if (entry.reason === 'shutdown') outcome = requeue(clock(), job.error, false);
      else if (entry.reason === 'cancel') outcome = finish('cancelled', null, null);
      else if (!failure) outcome = finish('succeeded', result, null);
      else if (retryable && job.attempts < kind.maxAttempts) {
        // 1, 2, 4… minutes (at most an hour), give or take 20%.
        const delay =
          Math.min(60 * MINUTE, MINUTE * 2 ** (job.attempts - 1)) * (0.8 + 0.4 * random());
        outcome = requeue(clock() + Math.round(delay), message, true);
      } else outcome = finish('failed', null, message);
    }
    try {
      const updated = await outcome;
      if (updated) notify(updated);
      else warn({ jobId: job.id }, 'jobs: the lock ran out before the job ended');
      // Only the claim that saved the failure calls onFailed, so it runs once per job.
      if (updated?.status === 'failed' && kind.onFailed) {
        const failure = {
          jobId: job.id,
          attempts: updated.attempts,
          error: updated.error ?? FAILED,
        };
        await Promise.resolve()
          .then(() => kind.onFailed?.(job.payload as never, failure))
          .catch((error: unknown) => warn({ err: error, jobId: job.id }, 'jobs: onFailed failed'));
      }
    } catch (error) {
      // The lock runs out and a worker takes the job over.
      warn({ err: error, jobId: job.id }, 'jobs: saving the outcome failed');
    }
  }

  async function claim(kindName: string, kind: Kind, limit: number, clock: () => number) {
    const at = clock();
    const lockedUntil = new Date(at + kind.timeoutMs + LOCK_GRACE_MS);
    const jobs = await store.claim({
      kind: kindName,
      limit,
      workerId,
      now: new Date(at),
      lockedUntil,
    });
    return jobs.map((job) => {
      kind.running += 1;
      const run = execute(kind, job, clock)
        .catch((error: unknown) => warn({ err: error, jobId: job.id }, 'jobs: runner error'))
        .finally(() => {
          kind.running -= 1;
          inflight.delete(run);
          poke();
        });
      inflight.add(run);
      return run;
    });
  }

  /** Makes sure each periodic task has its next run queued (or one running). */
  async function ensureTasks(at: number): Promise<void> {
    for (const [name, task] of tasks) {
      if (at < task.checkAt) continue;
      const { job } = await store.insert({
        id: randomUUID(),
        kind: PERIODIC_KIND,
        key: name,
        payload: { task: name },
        workspaceId: null,
        ownerUserId: null,
        runAt: new Date(nextSlot(at, task.everyMs)),
        now: new Date(at),
      });
      task.checkAt = job.status === 'queued' ? job.runAt.getTime() : at;
    }
  }

  async function tickLoop(): Promise<void> {
    do {
      tickAgain = false;
      const ids = [...active.keys()];
      const cancelled = ids.length > 0 ? await store.listCancelRequested(ids) : [];
      for (const id of cancelled) {
        const entry = active.get(id);
        if (entry) abort(entry, 'cancel');
      }
      if (starts === 0 || stopping) return;
      await ensureTasks(now());
      for (const [name, kind] of kinds) {
        if (kind.running < kind.concurrency)
          await claim(name, kind, kind.concurrency - kind.running, now);
      }
    } while (tickAgain);
  }

  /** One pass: cancel requests, periodic tasks, then claims. Callers during a pass wait for it. */
  function tick(): Promise<void> {
    if (ticking) {
      tickAgain = true;
      return ticking;
    }
    // `finally` runs after the assignment, even when the pass ends synchronously.
    ticking = tickLoop().finally(() => {
      ticking = null;
      if (tickAgain) poke();
    });
    return ticking;
  }

  function poke(): void {
    if (starts === 0 || stopping || poked) return;
    poked = setTimeout(() => {
      poked = undefined;
      tick().catch((error: unknown) => warn({ err: error }, 'jobs: tick failed'));
    }, 0);
  }

  function registerKind<P>(
    kind: string,
    handler: JobHandler<P>,
    opts: JobHandlerOptions<P> = {},
  ): void {
    if (!KIND.test(kind) || kind.length > 100) throw new TypeError(`Invalid job kind: ${kind}`);
    if (opts.onFailed !== undefined && typeof opts.onFailed !== 'function') {
      throw new TypeError('onFailed must be a function.');
    }
    const settings = {
      handler: handler as JobHandler<never>,
      onFailed: opts.onFailed as Kind['onFailed'],
      maxAttempts: whole('maxAttempts', opts.maxAttempts, 3, 1, 25),
      timeoutMs: whole('timeoutMs', opts.timeoutMs, 5 * MINUTE, 1_000, 30 * MINUTE),
      concurrency: whole('concurrency', opts.concurrency, 1, 1, 50),
    };
    // Registering again (another app in tests) replaces the handler.
    const existing = kinds.get(kind);
    if (existing) Object.assign(existing, settings);
    else kinds.set(kind, { ...settings, running: 0 });
    poke();
  }

  function registerPeriodicTask(name: string, everyMs: number, run: PeriodicTask): void {
    if (!KIND.test(name) || name.length > 100) throw new TypeError(`Invalid task name: ${name}`);
    whole('everyMs', everyMs, 0, 1_000, 7 * 24 * 60 * MINUTE);
    tasks.set(name, { everyMs, run, checkAt: 0 });
    poke();
  }

  registerKind<{ task?: unknown }>(
    PERIODIC_KIND,
    async (payload, ctx) => {
      await tasks.get(String(payload?.task))?.run({ ...ctx, now: new Date(now()) });
    },
    { maxAttempts: 1, concurrency: 4, timeoutMs: PERIODIC_TIMEOUT_MS },
  );
  registerPeriodicTask('jobs.cleanup', 60 * MINUTE, async ({ signal }) => {
    const cutoff = new Date(now() - KEEP_FINISHED_MS);
    for (let batch = 0; batch < 20 && !signal.aborted; batch += 1) {
      if ((await store.deleteFinishedBefore(cutoff, 1_000)) < 1_000) return;
    }
  });

  return {
    registerHandler<P>(kind: string, handler: JobHandler<P>, opts?: JobHandlerOptions<P>): void {
      if (kind === PERIODIC_KIND) throw new TypeError(`${PERIODIC_KIND} is reserved.`);
      registerKind(kind, handler, opts);
    },

    /** One run at a time across processes, on a grid of `everyMs`; a failed run waits for the next. */
    registerPeriodicTask,

    /**
     * Runs a periodic task once, here and at once, off its grid: for test hooks. `now` (default
     * the current time) is the run's `ctx.now`; it gets the task's usual 5 minutes. False when
     * there's no task with this name.
     */
    async runPeriodicTask(name: string, input: { now?: Date } = {}): Promise<boolean> {
      const task = tasks.get(name);
      if (!task) return false;
      await task.run({
        jobId: randomUUID(),
        attempt: 1,
        lateByMs: 0,
        signal: AbortSignal.timeout(PERIODIC_TIMEOUT_MS),
        setProgress: () => {},
        now: input.now ?? new Date(now()),
      });
      return true;
    },

    async schedule<P>(
      input: ScheduleJobInput<P>,
      options: ScheduleOptions = {},
    ): Promise<{ jobId: string; created: boolean }> {
      const { kind, key, runAt } = input;
      if (typeof kind !== 'string' || !KIND.test(kind) || kind === PERIODIC_KIND) {
        throw new TypeError(`Invalid job kind: ${String(kind)}`);
      }
      if (key !== undefined && (typeof key !== 'string' || key.length < 1 || key.length > 200)) {
        throw new TypeError('A job key has 1 to 200 characters.');
      }
      if (runAt !== undefined && !(runAt instanceof Date && Number.isFinite(runAt.getTime()))) {
        throw new TypeError('runAt must be a valid Date.');
      }
      const at = now();
      const within = options.sql ? store.within?.(options.sql) : undefined;
      const { job, created } = await (within ?? store).insert({
        id: randomUUID(),
        kind,
        key: key ?? null,
        payload: toJson(input.payload, 'payload', 16 * 1024),
        workspaceId: input.workspaceId ?? null,
        ownerUserId: input.ownerUserId ?? null,
        runAt: runAt ?? new Date(at),
        now: new Date(at),
      });
      if (created && job.runAt.getTime() <= at) poke();
      return { jobId: job.id, created };
    },

    get: (jobId: string): Promise<Job | null> => store.get(jobId),

    /** Cancels a queued job, or aborts a running one (here at once, elsewhere within 5 s). */
    async cancel(jobId: string): Promise<Job | null> {
      const job = await store.cancel(jobId, new Date(now()));
      const entry = active.get(jobId);
      if (entry && job?.cancelRequested) abort(entry, 'cancel');
      if (job?.status === 'cancelled' || job?.cancelRequested) notify(job);
      return job;
    },

    /** Polls every 5 s until `stop`. Counted: each `start` needs its `stop`. */
    async start(): Promise<void> {
      starts += 1;
      if (starts > 1) return;
      interval = setInterval(() => {
        tick().catch((error: unknown) => warn({ err: error }, 'jobs: tick failed'));
      }, POLL_MS);
      interval.unref();
      poke();
    },

    /** Waits up to 5 s for running jobs, then aborts them and puts them back in the queue. */
    async stop(): Promise<void> {
      if (starts === 0 || --starts > 0) return;
      clearInterval(interval);
      clearTimeout(poked);
      poked = undefined;
      stopping = true;
      try {
        const all = Promise.allSettled([...inflight]);
        if (!(await settlesWithin(all, STOP_GRACE_MS))) {
          for (const entry of active.values()) abort(entry, 'shutdown');
          await settlesWithin(all, 2_000);
        }
      } finally {
        stopping = false;
      }
    },

    /** Runs due jobs (not periodic tasks) here until none are left. `now` moves the clock. */
    async drain(input: { now?: Date } = {}): Promise<{ ran: number }> {
      const at = input.now?.getTime();
      const clock = at === undefined ? now : () => at;
      let ran = 0;
      for (let round = 0; round < 100; round += 1) {
        const runs: Promise<void>[] = [];
        for (const [name, kind] of kinds) {
          if (name !== PERIODIC_KIND)
            runs.push(...(await claim(name, kind, kind.concurrency, clock)));
        }
        if (runs.length === 0) return { ran };
        ran += runs.length;
        await Promise.all(runs);
      }
      throw new Error('Jobs kept scheduling due jobs; stopped after 100 rounds.');
    },

    tick,

    /** True from the first `start` until the last `stop`. */
    isRunning(): boolean {
      return starts > 0;
    },

    /** Before `start` only. */
    useStore(next: JobStore): void {
      if (starts > 0) throw new Error('Set the job store before the runner starts.');
      store = next;
      for (const task of tasks.values()) task.checkAt = 0;
    },

    setLogger(next: JobLogger): void {
      log = next;
    },
  };
}
