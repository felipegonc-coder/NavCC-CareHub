import { ImportFileError, stoppedMessage } from '@carehub/extras/import-export/import/index';
import { z } from 'zod';
import type { Db } from '../../../db';
import { getJob, registerJobHandler, registerPeriodicTask, type JobContext } from '../../jobs';
import { applyPlan, type ImportTarget } from './apply';
import { checkDestination } from './destination';
import { readInWorker, type ReadOptions } from './isolate';
import {
  RUNNABLE_STATUSES,
  cleanUpUploads,
  deleteUpload,
  findImport,
  loadUpload,
  moveImport,
  saveItems,
  staleImports,
} from './store';

// The import job (Import and export spec, section 3.1): it reads the upload in the worker thread,
// then writes the plan and the import's own record in one transaction, so Cancel or a failure
// leaves nothing behind (IE-11).

export const IMPORT_JOB = 'import-export.import';
export const CLEANUP_TASK = 'import-export.import-cleanup';

export type ImportJobPayload = z.infer<typeof payloadSchema>;
const payloadSchema = z.object({ importId: z.uuid() });

const MINUTE_MS = 60 * 1000;
/** How long an upload may take before the import stops. */
const UPLOAD_WAIT_MS = 60 * MINUTE_MS;
/** After this, the clean-up checks a waiting or running import's job. */
const STALE_MS = 10 * MINUTE_MS;
const SOMETHING_WRONG = stoppedMessage('something went wrong');
const TOO_LONG = stoppedMessage('it took too long');
const NO_LONGER = "you can't add pages there any more";

/** The import was cancelled while it was being written: the transaction rolls back. */
class Cancelled extends Error {}

/** Ends an import that didn't make it and drops its upload; nothing if it ended already. */
export async function endImport(
  db: Db,
  importId: string,
  end: { status: 'failed' | 'cancelled'; error: string | null },
): Promise<void> {
  await db.transaction(async (tx) => {
    const ended = await moveImport(tx, importId, RUNNABLE_STATUSES, {
      ...end,
      finishedAt: new Date(),
    });
    if (ended) await deleteUpload(tx, importId);
  });
}

export interface RunImportOptions {
  /** For tests: where the upload is read (`workerFile`). */
  read?: Omit<ReadOptions, 'signal'>;
}

const sameTarget = (a: ImportTarget, b: ImportTarget) =>
  a.workspaceId === b.workspaceId && a.pageId === b.pageId && a.spaceId === b.spaceId;

/** Runs one import. At least once: a run for an import that has ended does nothing. */
export async function runImport(
  db: Db,
  payload: unknown,
  ctx: Pick<JobContext, 'signal' | 'setProgress'>,
  options: RunImportOptions = {},
): Promise<void> {
  const { importId } = payloadSchema.parse(payload);
  const started = await moveImport(db, importId, RUNNABLE_STATUSES, {
    status: 'running',
    startedAt: new Date(),
  });
  if (!started) return;
  const { userId, workspaceId, pageId, spaceId, source, fileName, planned } = started;
  try {
    const bytes = await loadUpload(db, importId);
    if (!bytes) throw new ImportFileError('the file is missing; try again');
    const read = { source, fileName, bytes, planned };
    const { plan, files } = await readInWorker(read, { ...options.read, signal: ctx.signal });
    await db.transaction(async (tx) => {
      // The person may have lost access since they started it.
      const destination = await checkDestination(tx, userId, pageId);
      if (!destination.ok || !sameTarget(destination.target, { workspaceId, pageId, spaceId })) {
        throw new ImportFileError(NO_LONGER);
      }
      const result = await applyPlan(tx, {
        userId,
        target: destination.target,
        plan,
        files,
        signal: ctx.signal,
        onProgress: (done, total) => ctx.setProgress({ done, total }),
      });
      await saveItems(tx, importId, result.items);
      const done = await moveImport(tx, importId, ['running'], {
        status: 'done',
        counts: result.counts,
        problems: result.problems,
        problemCount: result.problemCount,
        error: null,
        finishedAt: new Date(),
      });
      if (!done) throw new Cancelled();
      await deleteUpload(tx, importId);
    });
  } catch (error) {
    if (error instanceof Cancelled) return;
    if (error instanceof ImportFileError) {
      await endImport(db, importId, { status: 'failed', error: stoppedMessage(error.message) });
      return;
    }
    // Past the job's 30 minutes: another try would take as long.
    if (ctx.signal.aborted && (ctx.signal.reason as Error | undefined)?.name === 'TimeoutError') {
      await endImport(db, importId, { status: 'failed', error: TOO_LONG });
      return;
    }
    // Cancel ended it already. Otherwise (a shutdown or a bug) the runner tries again,
    // and onFailed ends it once the last try fails.
    if ((await findImport(db, importId))?.status !== 'running') return;
    throw error;
  }
}

/**
 * Clean-up: imports whose upload never came stop, and so do imports whose job ended without
 * ending them (cancelled from the jobs routes, or lost).
 */
export async function cleanUpImports(db: Db, now = new Date()): Promise<void> {
  await cleanUpUploads(db, new Date(now.getTime() - UPLOAD_WAIT_MS));
  for (const row of await staleImports(db, new Date(now.getTime() - STALE_MS), 100)) {
    const job = row.jobId ? await getJob(row.jobId) : null;
    if (job?.status === 'queued' || job?.status === 'running') continue;
    await endImport(
      db,
      row.id,
      job?.status === 'cancelled'
        ? { status: 'cancelled', error: null }
        : { status: 'failed', error: SOMETHING_WRONG },
    );
  }
}

/** One import at a time in each server process; more wait in line. */
export function registerImportJob(db: Db, options: RunImportOptions = {}): void {
  registerJobHandler<unknown>(IMPORT_JOB, (payload, ctx) => runImport(db, payload, ctx, options), {
    concurrency: 1,
    maxAttempts: 2,
    timeoutMs: 30 * MINUTE_MS,
    onFailed: async (payload) => {
      const parsed = payloadSchema.safeParse(payload);
      if (parsed.success) {
        await endImport(db, parsed.data.importId, { status: 'failed', error: SOMETHING_WRONG });
      }
    },
  });
  registerPeriodicTask(CLEANUP_TASK, 15 * MINUTE_MS, () => cleanUpImports(db));
}
