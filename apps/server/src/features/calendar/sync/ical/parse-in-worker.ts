// Runs parseCalendar in a worker thread with a time limit and memory limits (issue #213), so a
// crafted calendar can't hold up the server's event loop or use up its memory. A calendar that
// runs out of either fails with `too-complex`; the sync should back off that subscription.

import { Worker } from 'node:worker_threads';
import { IcalParseError } from './parse';
import type { IcalParseErrorCode, ParseOptions, ParseResult } from './parse';

export const PARSE_TIMEOUT_MS = 10_000;
const RESOURCE_LIMITS = { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32 };
// Next to the server bundle; build.mjs builds parse-worker.ts there.
const WORKER_FILE = new URL('./calendar-parse-worker.js', import.meta.url);

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
