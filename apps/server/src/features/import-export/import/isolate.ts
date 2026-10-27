import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { ImportFileError } from '@carehub/extras/import-export/import/index';
import { readUpload, type ReadRequest, type ReadResult } from './read';
import type { WorkerAnswer } from './worker';

/** How much one read may use (docs/extras/import-export.md#safety: isolation). */
export const READ_LIMITS = {
  timeoutMs: 2 * 60 * 1000,
  thread: { maxOldGenerationSizeMb: 512, maxYoungGenerationSizeMb: 64, stackSizeMb: 4 },
} as const;

const unreadable = () => new ImportFileError("the file couldn't be read");

/** The bundled worker, next to the bundled server (dist/import-worker.js), when it's there. */
function bundledWorker(): URL | null {
  const url = new URL('./import-worker.js', import.meta.url);
  return url.protocol === 'file:' && existsSync(fileURLToPath(url)) ? url : null;
}

/** Runs `read` with the timeout, stopping early when `signal` aborts. */
function inline(read: Promise<ReadResult>, timeoutMs: number, signal?: AbortSignal) {
  return new Promise<ReadResult>((resolve, reject) => {
    const stop = (error: unknown) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(error);
    };
    const onAbort = () => stop(signal?.reason);
    const timer = setTimeout(
      () => stop(new ImportFileError('reading the file took too long')),
      timeoutMs,
    );
    signal?.addEventListener('abort', onAbort, { once: true });
    read.then((result) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(result);
    }, stop);
  });
}

export interface ReadOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** The worker script; tests pass their own. */
  workerFile?: URL | null;
  /** Without the worker, production refuses to read. Defaults to NODE_ENV being 'production'. */
  production?: boolean;
}

/**
 * Reads an upload in a worker thread with READ_LIMITS: past the timeout or the memory, or when
 * `signal` aborts, the thread is stopped. Throws ImportFileError with a reason safe to show.
 */
export function readInWorker(request: ReadRequest, options: ReadOptions = {}): Promise<ReadResult> {
  const { signal, timeoutMs = READ_LIMITS.timeoutMs } = options;
  if (signal?.aborted) return Promise.reject(signal.reason);
  const file = options.workerFile === undefined ? bundledWorker() : options.workerFile;
  if (file === null) {
    // stand-in: dist/import-worker.js (an esbuild entry in apps/server/build.mjs). Without it,
    // production reads nothing. In development and tests the read runs here, with the same limits
    // on what it makes and the same timeout, but without the thread's memory limit.
    const production = options.production ?? process.env.NODE_ENV === 'production';
    if (production) return Promise.reject(new ImportFileError("the file can't be read right now"));
    return inline(readUpload(request), timeoutMs, signal);
  }
  return new Promise<ReadResult>((resolve, reject) => {
    const worker = new Worker(file, { workerData: request, resourceLimits: READ_LIMITS.thread });
    let settled = false;
    const finish = (done: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      void worker.terminate();
      done();
    };
    const onAbort = () => finish(() => reject(signal?.reason));
    const timer = setTimeout(
      () => finish(() => reject(new ImportFileError('reading the file took too long'))),
      timeoutMs,
    );
    signal?.addEventListener('abort', onAbort, { once: true });
    worker.once('message', (answer: WorkerAnswer) =>
      finish(() =>
        answer.ok
          ? resolve(answer.result)
          : reject(answer.reason ? new ImportFileError(answer.reason) : unreadable()),
      ),
    );
    worker.once('error', (error: Error & { code?: string }) =>
      finish(() =>
        reject(
          error.code === 'ERR_WORKER_OUT_OF_MEMORY'
            ? new ImportFileError('the file needs too much memory to read')
            : unreadable(),
        ),
      ),
    );
    worker.once('exit', () => finish(() => reject(unreadable())));
  });
}
