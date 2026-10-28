// Runs parseCalendar in a worker thread with a time limit and memory limits (issue #213), so a
// crafted calendar can't hold up the server's event loop or use up its memory. A calendar that
// runs out of either fails with `too-complex`; the sync should back off that subscription.
// At most MAX_PARSE_WORKERS run at once, so their memory limits add up to a known amount; other
// calendars wait their turn, and the time limit starts when a calendar's worker starts.

import { existsSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { createLimit } from '../limit';
import { IcalParseError } from './parse';
import type { IcalParseErrorCode, ParseOptions, ParseResult } from './parse';

export const PARSE_TIMEOUT_MS = 10_000;
export const MAX_PARSE_WORKERS = 2;
const RESOURCE_LIMITS = { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32 };
const workers = createLimit(MAX_PARSE_WORKERS);

/**
 * The worker's file: next to the server bundle (build.mjs builds it there), or, running from
 * source with tsx (which workers inherit through execArgv), parse-worker.ts itself.
 */
export function workerFileFor(moduleUrl: string, exists: (file: URL) => boolean = existsSync): URL {
  const bundled = new URL('./calendar-parse-worker.js', moduleUrl);
  return exists(bundled) ? bundled : new URL('./parse-worker.ts', moduleUrl);
}
const WORKER_FILE = workerFileFor(import.meta.url);

type Reply =
  { ok: true; result: ParseResult } | { ok: false; code: IcalParseErrorCode; message: string };

export interface WorkerParseOptions {
  timeoutMs?: number; // from when the worker starts
  /** Cancels the read, waiting or running; it then fails with the signal's reason. */
  signal?: AbortSignal;
  workerFile?: URL; // for tests
}

/** Same result and errors as parseCalendar, plus `too-complex`. */
export function parseCalendarInWorker(
  input: string | Uint8Array,
  options: ParseOptions = {},
  { timeoutMs = PARSE_TIMEOUT_MS, signal, workerFile = WORKER_FILE }: WorkerParseOptions = {},
): Promise<ParseResult> {
  return workers(() => runWorker(input, options, timeoutMs, workerFile, signal), signal);
}

function runWorker(
  input: string | Uint8Array,
  options: ParseOptions,
  timeoutMs: number,
  workerFile: URL,
  signal: AbortSignal | undefined,
): Promise<ParseResult> {
  return new Promise<ParseResult>((resolve, reject) => {
    const worker = new Worker(workerFile, {
      workerData: { input, options },
      resourceLimits: RESOURCE_LIMITS,
    });
    const tooComplex = (why: string) =>
      new IcalParseError('too-complex', `This calendar ${why}, so it wasn't read.`);
    // Settles once, after the worker has stopped, so its place is free only when it's gone.
    let finished = false;
    const finish = (settle: () => void) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      void worker.terminate().then(settle, settle);
    };
    const timer = setTimeout(
      () => finish(() => reject(tooComplex('took too long to read'))),
      timeoutMs,
    );
    const cancel = () => finish(() => reject(signal?.reason));
    signal?.addEventListener('abort', cancel, { once: true });
    worker.once('message', (reply: Reply) =>
      finish(() =>
        reply.ok ? resolve(reply.result) : reject(new IcalParseError(reply.code, reply.message)),
      ),
    );
    worker.on('error', (error: NodeJS.ErrnoException) =>
      finish(() =>
        reject(
          error.code === 'ERR_WORKER_OUT_OF_MEMORY' ? tooComplex('needed too much memory') : error,
        ),
      ),
    );
    worker.once('exit', () => finish(() => reject(tooComplex('stopped the reader'))));
  });
}
