import { Worker } from 'node:worker_threads';
import { PictureError } from './bytes';
import type { RedrawJob, Redrawn } from './picture-worker';

/** The most pixels a redrawn picture may have: a 24-megapixel photo fits. */
export const REDRAW_MAX_PIXELS = 25_000_000;
/** Pictures redrawn at once; others wait their turn. Each may use a few hundred MB. */
const AT_ONCE = 2;
const TIMEOUT_MS = 60_000;

// The server's bundle has the worker next to it (build.mjs); tests and the dev server run this source
// file, with the worker beside it.
const WORKER_URL = new URL(
  import.meta.url.endsWith('.ts') ? './picture-worker.ts' : './picture-worker.js',
  import.meta.url,
);

let running = 0;
const waiting: Array<() => void> = [];

/**
 * A new JPEG or PNG drawn from the picture's pixels alone, upright, so nothing else in the original
 * reaches anyone (uploads from people who aren't signed in, decision 0200). A PictureError when it
 * can't be read, has over REDRAW_MAX_PIXELS pixels or takes over a minute.
 */
export async function redrawPicture(
  mimeType: RedrawJob['mimeType'],
  bytes: Uint8Array,
  orientation: number,
): Promise<Redrawn> {
  while (running >= AT_ONCE) await new Promise<void>((resolve) => waiting.push(resolve));
  running += 1;
  try {
    return await inWorker({ mimeType, bytes, orientation, maxPixels: REDRAW_MAX_PIXELS });
  } finally {
    running -= 1;
    waiting.shift()?.();
  }
}

function inWorker(job: RedrawJob): Promise<Redrawn> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_URL, {
      workerData: job,
      resourceLimits: { maxOldGenerationSizeMb: 512 },
    });
    const timer = setTimeout(() => void worker.terminate(), TIMEOUT_MS);
    worker.once('message', (redrawn: Redrawn) => resolve(redrawn));
    worker.once('error', (error) => reject(new PictureError(error.message)));
    // Ended without an answer: stopped after the time limit, or out of memory.
    worker.once('exit', () => {
      clearTimeout(timer);
      reject(new PictureError());
    });
  });
}
