// The worker side of parseCalendarInWorker: reads one calendar and posts the result back.
// Built as its own file next to the server bundle (dist/calendar-parse-worker.js).

import { parentPort, workerData } from 'node:worker_threads';
import { IcalParseError, parseCalendar } from './parse';
import type { ParseOptions } from './parse';

const { input, options } = workerData as { input: string | Uint8Array; options: ParseOptions };
try {
  parentPort?.postMessage({ ok: true, result: parseCalendar(input, options) });
} catch (error) {
  if (!(error instanceof IcalParseError)) throw error; // the parent sees it as a worker error
  parentPort?.postMessage({ ok: false, code: error.code, message: error.message });
}
