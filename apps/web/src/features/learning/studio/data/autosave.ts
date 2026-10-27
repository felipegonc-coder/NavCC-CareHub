import { isStudioError } from './client';

/** Where the draft stands, shown next to the course title. */
export type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'offline' | 'conflict' | 'error';

/** Timers, injectable for tests. */
export type AutosaveTimers = {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
};

/** Options for {@link createAutosave}. */
export type AutosaveOptions<T> = {
  /** Saves the whole draft against `revision` and returns the new revision. */
  save(value: T, revision: number): Promise<{ revision: number }>;
  /** The revision the draft was loaded at. */
  revision: number;
  onStatus?(status: SaveStatus): void;
  /** Quiet time after the last change before saving. Default 800 ms. */
  delayMs?: number;
  /** Wait before trying again after a failed save. Default 5 s. */
  retryMs?: number;
  timers?: AutosaveTimers;
};

/**
 * Saves the latest draft after a quiet moment, one save at a time. When offline or after an error it keeps
 * the change and tries again; after a conflict (someone saved a newer revision) it waits for `resume`.
 */
export type Autosave<T> = {
  readonly status: SaveStatus;
  readonly revision: number;
  /** Queues `value`, the whole draft, to be saved. */
  change(value: T): void;
  /** Saves any queued change now and waits for it. Resolves to the status afterwards. */
  flush(): Promise<SaveStatus>;
  /** After a conflict: carry on from `revision` (e.g. to keep this version over theirs). */
  resume(revision: number): void;
  /** Stops saving. Queued changes are dropped. */
  dispose(): void;
};

const browserTimers: AutosaveTimers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Starts autosaving a draft loaded at `options.revision`. */
export function createAutosave<T>(options: AutosaveOptions<T>): Autosave<T> {
  const { delayMs = 800, retryMs = 5000, timers = browserTimers } = options;
  let status: SaveStatus = 'saved';
  let revision = options.revision;
  let pending: { value: T } | null = null;
  let timer: unknown = null;
  let running: Promise<void> | null = null;
  let disposed = false;

  const setStatus = (next: SaveStatus) => {
    if (next === status) return;
    status = next;
    options.onStatus?.(next);
  };
  const stopTimer = () => {
    if (timer !== null) timers.clear(timer);
    timer = null;
  };
  const schedule = (ms: number) => {
    stopTimer();
    timer = timers.set(() => {
      timer = null;
      void run();
    }, ms);
  };

  async function attempt(value: T): Promise<void> {
    setStatus('saving');
    try {
      revision = (await options.save(value, revision)).revision;
      setStatus(pending ? 'unsaved' : 'saved');
    } catch (error) {
      pending ??= { value };
      if (isStudioError(error, 'conflict')) setStatus('conflict');
      else setStatus(isStudioError(error, 'offline') ? 'offline' : 'error');
    }
    if (disposed || !pending || status === 'conflict' || timer !== null) return;
    schedule(status === 'unsaved' ? delayMs : retryMs);
  }

  function run(): Promise<void> {
    if (running) return running;
    if (disposed || !pending || status === 'conflict') return Promise.resolve();
    const { value } = pending;
    pending = null;
    running = attempt(value).finally(() => {
      running = null;
    });
    return running;
  }

  return {
    get status() {
      return status;
    },
    get revision() {
      return revision;
    },
    change(value) {
      if (disposed) return;
      pending = { value };
      if (status === 'saved') setStatus('unsaved');
      if (status !== 'conflict') schedule(delayMs);
    },
    async flush() {
      while (running) await running;
      stopTimer();
      await run();
      return status;
    },
    resume(next) {
      if (disposed || status !== 'conflict') return;
      revision = next;
      setStatus(pending ? 'unsaved' : 'saved');
      void run();
    },
    dispose() {
      disposed = true;
      pending = null;
      stopTimer();
    },
  };
}
