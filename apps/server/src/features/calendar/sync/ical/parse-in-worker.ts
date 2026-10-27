// Runs parseCalendar in a worker thread with a time limit and memory limits (issue #213), so a
// crafted calendar can't hold up the server's event loop or use up its memory. A calendar that
// runs out of either fails with `too-complex`; the sync should back off that subscription.

import { existsSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { IcalParseError } from './parse';
import type { IcalParseErrorCode, ParseOptions, ParseResult } from './parse';

export const PARSE_TIMEOUT_MS = 10_000;
const RESOURCE_LIMITS = { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32 };

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
  timeoutMs?: number;
  workerFile?: URL; // for tests
}

/** Same result and errors as parseCalendar, plus `too-complex`. */
export function parseCalendarInWorker(
  input: string | Uint8Array,
  options: ParseOptions = {},
  { timeoutMs = PARSE_TIMEOUT_MS, workerFile = WORKER_FILE }: WorkerParseOptions = {},
): Promise<ParseResult> {
  return new Promise<ParseResult>((resolve, reject) => {
    const worker = new Worker(workerFile, {
      workerData: { input, options },
      resourceLimits: RESOURCE_LIMITS,
    });
    const tooComplex = (why: string) =>
      new IcalParseError('too-complex', `This calendar ${why}, so it wasn't read.`);
    const timer = setTimeout(() => fail(tooComplex('took too long to read')), timeoutMs);
    const done = () => {
      clearTimeout(timer);
      void worker.terminate();
    };
    const fail = (error: Error) => {
      done();
      reject(error);
    };
    worker.once('message', (reply: Reply) => {
      done();
      if (reply.ok) resolve(reply.result);
      else reject(new IcalParseError(reply.code, reply.message));
    });
    worker.once('error', (error: NodeJS.ErrnoException) =>
      fail(
        error.code === 'ERR_WORKER_OUT_OF_MEMORY' ? tooComplex('needed too much memory') : error,
      ),
    );
    worker.once('exit', () => fail(tooComplex('stopped the reader')));
  });
}
