import { parentPort, workerData } from 'node:worker_threads';
import { ImportFileError } from '@carehub/extras/import-export/import/index';
import { readUpload, type ReadRequest } from './read';

// The import worker: reads one upload in its own thread and posts the plan back. isolate.ts starts
// it with resourceLimits and a timeout. Bundled as dist/import-worker.js.

/** What the worker posts: the plan and files, or why it stopped when that's safe to show. */
export type WorkerAnswer =
  | { ok: true; result: Awaited<ReturnType<typeof readUpload>> }
  | { ok: false; reason: string | null };

const port = parentPort;
if (port) {
  readUpload(workerData as ReadRequest).then(
    (result) => port.postMessage({ ok: true, result } satisfies WorkerAnswer),
    (error: unknown) => {
      const reason = error instanceof ImportFileError ? error.message : null;
      port.postMessage({ ok: false, reason } satisfies WorkerAnswer);
    },
  );
}
