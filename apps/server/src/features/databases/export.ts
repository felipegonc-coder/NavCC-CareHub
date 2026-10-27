// CSV export on the server (decision 0200; spec 3.8): the export job (`databases.csv-export`) and
// the finished files. The job reads the rows as the person who asked sees them (export-rows.ts),
// writes the CSV with the package's writer and keeps it in db_exports for 24 hours, for that
// person only. An hourly task deletes older files.
import { atLeast } from '@carehub/databases/access';
import { exportFileName, exportTable, writeCsv } from '@carehub/databases/csv';
import { VIEW_BLOCKED } from '@carehub/databases/engine';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { httpError } from '../../core/errors';
import { JobError, registerJobHandler, registerPeriodicTask, type JobContext } from '../jobs';
import { getPageAccess } from '../pages';
import { forbidden, notFound } from './errors';
import { exportBlocked, readExportRows } from './export-rows';
import { isUuid, type DatabaseRecord } from './record';
import { loadDatabase, type Executor } from './store';

export const EXPORT_JOB = 'databases.csv-export';
/** Deletes the files older than 24 hours, once an hour. */
export const EXPORT_CLEANUP_TASK = 'databases.csv-export-cleanup';
/** Files at most this many deleted per statement. */
const CLEANUP_BATCH = 1_000;

/** Messages, word for word. */
export const EXPORT_MESSAGES = {
  /** GET /:id/exports/:exportId for a file that's gone, older than 24 hours or someone else's. */
  notAvailable: "This export isn't available anymore. Export again.",
  /** The view was deleted before the export ran. */
  noView: 'This view was deleted.',
  /** The database was deleted or moved to Trash before the export ran. */
  gone: 'This database was deleted or moved to Trash.',
  /** The person can't open the database anymore. */
  noAccess: "You can't open this database anymore.",
} as const;

/** The job's payload. `viewId` null exports Everything. */
export interface ExportJob {
  exportId: string;
  databaseId: string;
  viewId: string | null;
  userId: string;
}

/** The job's result (a type, so it's a JSON value). */
export type ExportResult = {
  exportId: string;
  fileName: string;
  rowCount: number;
};

// ------------------------------------------------------------------ starting

/** POST /:id/export's checks: the view exists (404) and uses no hidden property (403). */
export async function checkExportable(
  db: Executor,
  input: { record: DatabaseRecord; viewId: string | null; userId: string },
): Promise<void> {
  if (input.viewId === null) return;
  const view = input.record.views.find((v) => v.id === input.viewId);
  if (!view) throw notFound();
  if (await exportBlocked(db, { record: input.record, view, userId: input.userId })) {
    throw forbidden(VIEW_BLOCKED);
  }
}

// ------------------------------------------------------------------ the job

type StoredResult = { id: string; file_name: string; row_count: number };

async function savedExport(db: Executor, exportId: string): Promise<ExportResult | null> {
  const { rows } = await db.execute<StoredResult>(sql`
    SELECT id, file_name, row_count FROM db_exports WHERE id = ${exportId}`);
  const found = rows[0];
  return found
    ? { exportId: found.id, fileName: found.file_name, rowCount: found.row_count }
    : null;
}

/** One export, once: a retry after the file was saved answers the saved result. */
async function runExport(
  app: FastifyInstance,
  job: ExportJob,
  ctx: JobContext,
): Promise<ExportResult> {
  if (!isUuid(job.exportId) || !isUuid(job.databaseId) || !isUuid(job.userId)) {
    throw new JobError(EXPORT_MESSAGES.gone);
  }
  const done = await savedExport(app.db, job.exportId);
  if (done) return done;
  const record = await loadDatabase(app.db, job.databaseId);
  if (!record || record.inTrash) throw new JobError(EXPORT_MESSAGES.gone);
  if (!atLeast(await getPageAccess(app.db, job.userId, record.id), 'view')) {
    throw new JobError(EXPORT_MESSAGES.noAccess);
  }
  const view = job.viewId === null ? null : record.views.find((v) => v.id === job.viewId);
  if (view === undefined) throw new JobError(EXPORT_MESSAGES.noView);
  const read = await readExportRows(app.db, {
    record,
    view,
    userId: job.userId,
    signal: ctx.signal,
    onPage: (rows, total) => ctx.setProgress({ done: rows, total }),
  });
  if ('blocked' in read) throw new JobError(read.blocked);
  const csv = writeCsv(exportTable(read.columns, read.rows, read.cellText));
  const fileName = exportFileName(record, view, read.today);
  await app.db.execute(sql`
    INSERT INTO db_exports (id, database_id, "by", file_name, csv, row_count)
    VALUES (${job.exportId}, ${record.id}, ${job.userId}, ${fileName}, ${csv}, ${read.rows.length})
    ON CONFLICT (id) DO NOTHING`);
  return (
    (await savedExport(app.db, job.exportId)) ?? {
      exportId: job.exportId,
      fileName,
      rowCount: read.rows.length,
    }
  );
}

/** Deletes the files older than 24 hours, a batch at a time. Gives how many went. */
export async function deleteOldExports(db: Executor, signal?: AbortSignal): Promise<number> {
  let deleted = 0;
  for (let batch = 0; batch < 100 && !signal?.aborted; batch += 1) {
    const { rows } = await db.execute<{ id: string }>(sql`
      DELETE FROM db_exports WHERE id IN (
        SELECT id FROM db_exports WHERE created_at <= now() - interval '24 hours'
        LIMIT ${CLEANUP_BATCH})
      RETURNING id`);
    deleted += rows.length;
    if (rows.length < CLEANUP_BATCH) break;
  }
  return deleted;
}

/** The job and the hourly cleanup, for this app (tests start many: the last one open runs them). */
export function registerExportJob(app: FastifyInstance): void {
  registerJobHandler<ExportJob>(EXPORT_JOB, (payload, ctx) => runExport(app, payload, ctx), {
    maxAttempts: 2,
    timeoutMs: 10 * 60_000,
    concurrency: 2,
  });
  let open = true;
  app.addHook('onClose', async () => {
    open = false;
  });
  registerPeriodicTask(EXPORT_CLEANUP_TASK, 60 * 60_000, async ({ signal }) => {
    if (open) await deleteOldExports(app.db, signal);
  });
}

// ------------------------------------------------------------------ downloading

type StoredFile = { file_name: string; csv: string };

/** A finished export for the person who asked, within 24 hours; anything else is 404. */
export async function loadExport(
  db: Executor,
  input: { databaseId: string; exportId: string; userId: string },
): Promise<{ fileName: string; csv: string }> {
  const missing = () => httpError(404, 'not_found', EXPORT_MESSAGES.notAvailable);
  if (!isUuid(input.exportId) || !isUuid(input.databaseId) || !isUuid(input.userId)) {
    throw missing();
  }
  const { rows } = await db.execute<StoredFile>(sql`
    SELECT file_name, csv FROM db_exports
    WHERE id = ${input.exportId} AND database_id = ${input.databaseId} AND "by" = ${input.userId}
      AND created_at > now() - interval '24 hours'`);
  const found = rows[0];
  if (!found) throw missing();
  return { fileName: found.file_name, csv: found.csv };
}

/** Lone surrogates can't be written as UTF-8; they become U+FFFD. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * Content-Disposition for a download: `filename` with a plain ASCII stand-in for older clients,
 * then `filename*` with the real name in UTF-8 (RFC 5987, as RFC 6266 uses it).
 */
export function attachment(fileName: string): string {
  const name = fileName.replace(LONE_SURROGATE, '\uFFFD');
  const ascii = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2012-\u2015]/g, '-')
    .replace(/[^\x20-\x7e]|["\\%]/g, '_');
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
