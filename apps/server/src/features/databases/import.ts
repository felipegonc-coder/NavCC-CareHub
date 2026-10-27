// CSV and Excel import on the server (decision 0200; spec 3.7): reading the file in a worker
// thread, the import job (`databases.csv-import`) and Undo import. The job adds the import's new
// properties and options, then its rows through createRows, all in one transaction, so an import
// adds everything or nothing. Imports only add rows (DB-D3); they send no Person notices.
import { Worker } from 'node:worker_threads';
import {
  DEFAULT_TIME_ZONE,
  LIMITS,
  titleProperty,
  type AccessLevel,
  type DatabaseGrant,
  type Id,
  type Property,
  type View,
} from '@carehub/databases';
import { atLeast, can, canChangeProperty } from '@carehub/databases/access';
import { importSummary, type ImportProblem } from '@carehub/databases/csv';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { HttpError, httpError } from '../../core/errors';
import type { Tx } from '../../db';
import { JobError, registerJobHandler, type JobContext } from '../jobs';
import { getAccessForPages, getPageAccess } from '../pages';
import { createRows, runRowWrites, trashRows } from './api';
import { DATABASE_MESSAGES, forbidden, invalid, notFound } from './errors';
import {
  IMPORT_MESSAGES,
  WORKER_MARK,
  withOptions,
  type ImportFile,
  type ImportReading,
  type ImportTarget,
  type ReadImportInput,
} from './import-worker';
import { visibleIds } from './meta';
import { isUuid, type DatabaseRecord } from './record';
import {
  loadDatabase,
  loadPropertyViewer,
  loadRelatedProperties,
  lockDatabase,
  saveSettings,
  type Executor,
} from './store';

export const IMPORT_JOB = 'databases.csv-import';

/** Rows per createRows call; the job reports its progress after each. */
const BATCH = 500;
/** Relation columns match at most this many rows of each related database. */
const MAX_RELATED_ROWS = 20_000;
/** Undo import is offered for this long after the import. */
const UNDO_DAYS = 7;
/** At most this many changed rows are listed when Undo is refused. */
const MAX_LISTED_CHANGED = 1_000;

// ------------------------------------------------------------------ the worker thread

export interface ReaderSettings {
  /** The worker script: dist/import-worker.js, next to the server bundle. */
  url: URL;
  timeoutMs: number;
  maxOldGenerationSizeMb: number;
}

const READER: ReaderSettings = {
  url: new URL('./import-worker.js', import.meta.url),
  timeoutMs: 30_000,
  maxOldGenerationSizeMb: 256,
};
let reader = READER;

/** For tests: another worker script or other limits. Returns a function that puts them back. */
export function setImportReader(changes: Partial<ReaderSettings>): () => void {
  const before = reader;
  reader = { ...reader, ...changes };
  return () => {
    reader = before;
  };
}

/** Files read at once in this process; the next ones wait their turn. */
const MAX_READERS = 2;
let reading = 0;
const waiting: (() => void)[] = [];

async function readerTurn(): Promise<() => void> {
  while (reading >= MAX_READERS) await new Promise<void>((resolve) => waiting.push(resolve));
  reading++;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    reading--;
    waiting.shift()?.();
  };
}

/**
 * Reads the file in a worker thread with a memory limit and a time limit. A worker that can't
 * start, runs out of memory, stops or takes too long answers "This file couldn't be read."
 */
export async function readInWorker(input: ReadImportInput): Promise<ImportReading> {
  const release = await readerTurn();
  const { url, timeoutMs, maxOldGenerationSizeMb } = reader;
  try {
    return await new Promise<ImportReading>((resolve) => {
      const unreadable = () => resolve({ ok: false, error: IMPORT_MESSAGES.unreadable });
      let worker: Worker;
      try {
        worker = new Worker(url, {
          workerData: { [WORKER_MARK]: input },
          resourceLimits: { maxOldGenerationSizeMb },
        });
      } catch {
        unreadable();
        return;
      }
      const timer = setTimeout(() => {
        unreadable();
        void worker.terminate();
      }, timeoutMs);
      const stop = () => clearTimeout(timer);
      worker.once('message', (answer: ImportReading) => {
        stop();
        resolve(answer);
        void worker.terminate();
      });
      worker.once('error', () => {
        stop();
        unreadable();
      });
      worker.once('exit', () => {
        stop();
        unreadable();
      });
    });
  } finally {
    release();
  }
}

// ------------------------------------------------------------------ who may import

/** Import needs Can edit with Lock structure off (0200's table). */
export function checkMayImport(record: DatabaseRecord, level: DatabaseGrant): void {
  if (!can('import', level, { locked: record.locked })) throw forbidden();
  if (record.locked) throw forbidden(DATABASE_MESSAGES.locked);
}

/** The database as this person may import into it, and what reading values needs. */
export async function importTarget(
  db: Executor,
  record: DatabaseRecord,
  userId: string,
  level: AccessLevel,
): Promise<ImportTarget> {
  const who = await loadPropertyViewer(db, userId, record.workspaceId);
  const seen = visibleIds(
    record.properties,
    who,
    await loadRelatedProperties(db, record.properties),
  );
  const properties = record.properties.filter((p) => seen.has(p.id));
  const fixed = properties.filter((p) => !canChangeProperty(p, who, level)).map((p) => p.id);
  const viewer = await viewerOf(db, userId);
  const people = await membersOf(db, record.workspaceId);
  const rows = await relatedRows(db, userId, properties, new Set(fixed));
  return {
    properties,
    fixed,
    otherNames: record.properties.filter((p) => !seen.has(p.id)).map((p) => p.name),
    canAddProperties: can('edit_properties', level, { locked: record.locked }),
    viewer,
    people,
    rows,
  };
}

async function viewerOf(db: Executor, userId: string) {
  const { rows } = await db.execute<{ time_zone: string | null }>(sql`
    SELECT time_zone FROM users WHERE id = ${userId}`);
  return { timeZone: rows[0]?.time_zone ?? DEFAULT_TIME_ZONE, now: new Date() };
}

async function membersOf(db: Executor, workspaceId: string) {
  const { rows } = await db.execute<{ id: string; name: string; email: string }>(sql`
    SELECT u.id, u.name, u.email FROM workspace_members m JOIN users u ON u.id = m.user_id
    WHERE m.workspace_id = ${workspaceId}
    ORDER BY u.created_at, u.id`);
  return rows;
}

/** For each relation the importer can fill: the related rows they can open, oldest first. */
async function relatedRows(
  db: Executor,
  userId: string,
  properties: readonly Property[],
  fixed: ReadonlySet<Id>,
): Promise<ImportTarget['rows']> {
  const targets = new Set<string>();
  for (const p of properties) {
    if (p.config.type === 'relation' && !fixed.has(p.id)) targets.add(p.config.targetDatabaseId);
  }
  const out: ImportTarget['rows'] = {};
  for (const databaseId of [...targets].filter(isUuid)) {
    const { rows } = await db.execute<{ id: string; title: string }>(sql`
      SELECT p.id, p.title FROM db_rows r JOIN pages p ON p.id = r.page_id
      WHERE r.database_id = ${databaseId} AND p.deleted_at IS NULL
      ORDER BY r.created_at, p.id
      LIMIT ${MAX_RELATED_ROWS}`);
    const levels = await getAccessForPages(
      db,
      userId,
      rows.map((r) => r.id),
    );
    out[databaseId] = rows.filter((r) => atLeast(levels.get(r.id), 'view'));
  }
  return out;
}

// ------------------------------------------------------------------ the job

/** What the import dialog chose, kept with the file until the job runs. */
export type ImportRequest = Omit<ImportFile, 'bytes'>;

interface ImportJob {
  importId: string;
}

/** The job's result: what the summary shows. */
export type ImportJobResult = {
  importId: string;
  rowCount: number;
  problemCount: number;
  /** "Imported 412 rows. 3 values couldn't be read." */
  summary: string;
};

/** The properties and options an import made, kept for Undo and the import's history. */
interface Created {
  propertyIds: Id[];
  options: Record<Id, Id[]>;
}

interface ImportRecord {
  id: string;
  database_id: string;
  by: string | null;
  status: 'queued' | 'done' | 'failed' | 'undone';
  row_count: number;
  problem_count: number;
  finished_at: Date | string | null;
}

/** New properties join every view as hidden columns, as properties added by hand do. */
const withHiddenColumns = (views: readonly View[], added: readonly Property[]): View[] =>
  views.map((view) => ({
    ...view,
    properties: [
      ...view.properties,
      ...added
        .filter((p) => !view.properties.some((s) => s.propertyId === p.id))
        .map((p) => ({ propertyId: p.id, visible: false })),
    ],
  }));

/** Saves the import's new properties and options on the locked database. */
async function addStructure(
  tx: Tx,
  record: DatabaseRecord,
  read: Extract<ImportReading, { ok: true }>,
): Promise<Created> {
  const added = read.newProperties;
  const options = Object.entries(read.newOptions).filter(([, list]) => list.length > 0);
  const created: Created = {
    propertyIds: added.map((p) => p.id),
    options: Object.fromEntries(options.map(([id, list]) => [id, list.map((o) => o.id)])),
  };
  if (!added.length && !options.length) return created;
  if (record.properties.length + added.length > LIMITS.properties) {
    throw new JobError(DATABASE_MESSAGES.tooManyProperties);
  }
  const properties = [
    ...record.properties.map((p) => withOptions(p, read.newOptions[p.id] ?? [])),
    ...added,
  ];
  await saveSettings(tx, record, { properties, views: withHiddenColumns(record.views, added) });
  return created;
}

/** The import's database row, locked until the transaction ends. */
async function lockImport(tx: Tx, importId: string): Promise<ImportRecord | null> {
  const { rows } = await tx.execute<ImportRecord>(sql`
    SELECT id, database_id, "by", status, row_count, problem_count, finished_at
    FROM db_imports WHERE id = ${importId} FOR UPDATE`);
  return rows[0] ?? null;
}

const resultOf = (importId: string, rowCount: number, problemCount: number): ImportJobResult => ({
  importId,
  rowCount,
  problemCount,
  summary: importSummary(rowCount, problemCount),
});

/**
 * Runs an import once: a second run (a retry, or the job scheduled twice) finds it done and
 * answers the same result. Refusals become the job's error message.
 */
async function runImport(
  app: FastifyInstance,
  importId: string,
  ctx: JobContext,
): Promise<ImportJobResult> {
  if (!isUuid(importId)) throw new JobError(IMPORT_MESSAGES.gone);
  try {
    const { result, updated } = await runRowWrites(app, (tx) => importRows(tx, importId, ctx));
    if (updated) app.events.emit('databases.database.updated', { ...updated, what: 'properties' });
    return result;
  } catch (e) {
    // A refusal from the checks or the row writes is final, with its message.
    if (e instanceof HttpError) throw new JobError(e.message);
    throw e;
  }
}

/** The job's transaction: the file read again, the new properties and options, then the rows. */
async function importRows(tx: Tx, importId: string, ctx: JobContext) {
  const job = await lockImport(tx, importId);
  if (!job) throw new JobError(IMPORT_MESSAGES.gone);
  if (job.status !== 'queued') {
    return { result: resultOf(importId, job.row_count, job.problem_count), updated: null };
  }
  const userId = job.by;
  if (!userId) throw forbidden();
  const record = await lockDatabase(tx, job.database_id);
  if (record.inTrash) throw new JobError(IMPORT_MESSAGES.gone);
  const level = await getPageAccess(tx, userId, record.id);
  checkMayImport(record, level);

  const { rows: files } = await tx.execute<{ bytes: Uint8Array; request: ImportRequest }>(sql`
    SELECT bytes, request FROM db_import_files WHERE import_id = ${importId}`);
  const file = files[0];
  if (!file) throw new JobError(IMPORT_MESSAGES.unreadable);
  const target = await importTarget(tx, record, userId, level);
  const read = await readInWorker({
    mode: 'import',
    file: { ...file.request, bytes: new Uint8Array(file.bytes) },
    target,
  });
  if (!read.ok) throw new JobError(read.error);

  const created = await addStructure(tx, record, read);
  const changed = created.propertyIds.length > 0 || Object.keys(created.options).length > 0;
  const titleId = titleProperty(record.properties).id;
  const rows = read.rows.map((row) => ({
    values: row.title ? { ...row.values, [titleId]: row.title } : row.values,
  }));
  for (let done = 0; done < rows.length; done += BATCH) {
    if (ctx.signal.aborted) throw new JobError(IMPORT_MESSAGES.unreadable, { retry: true });
    await createRows(tx, {
      databaseId: record.id,
      rows: rows.slice(done, done + BATCH),
      actorUserId: userId,
      source: 'import',
      importId,
    });
    ctx.setProgress({ done: Math.min(done + BATCH, rows.length), total: rows.length });
  }
  await tx.execute(sql`
    UPDATE db_imports SET status = 'done', row_count = ${rows.length},
      problems = ${JSON.stringify(read.problems)}::jsonb, problem_count = ${read.problemCount},
      created = ${JSON.stringify(created)}::jsonb, finished_at = now()
    WHERE id = ${importId}`);
  await tx.execute(sql`DELETE FROM db_import_files WHERE import_id = ${importId}`);
  return {
    result: resultOf(importId, rows.length, read.problemCount),
    updated: changed
      ? { workspaceId: record.workspaceId, databaseId: record.id, actorId: userId }
      : null,
  };
}

/** A failed import keeps its reason; its file is deleted. */
async function markFailed(app: FastifyInstance, importId: string, error: string): Promise<void> {
  if (!isUuid(importId)) return;
  await app.db.transaction(async (tx) => {
    await tx.execute(sql`
      UPDATE db_imports SET status = 'failed', error = ${error}, finished_at = now()
      WHERE id = ${importId} AND status = 'queued'`);
    await tx.execute(sql`DELETE FROM db_import_files WHERE import_id = ${importId}`);
  });
}

/** Registers the import job's handler (once per app; the last app registered runs it). */
export function registerImportJob(app: FastifyInstance): void {
  registerJobHandler<ImportJob>(
    IMPORT_JOB,
    (payload, ctx) => runImport(app, payload.importId, ctx),
    {
      maxAttempts: 3,
      timeoutMs: 15 * 60_000,
      onFailed: (payload, failure) => markFailed(app, payload.importId, failure.error),
    },
  );
}

// ------------------------------------------------------------------ reading an import back

export interface ImportAnswer {
  importId: string;
  databaseId: string;
  fileName: string;
  status: ImportRecord['status'];
  rowCount: number;
  problemCount: number;
  /** The summary once done; the reason once failed. */
  summary: string | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  undoneAt: string | null;
  /** Until when Undo import is offered (done imports only). */
  undoUntil: string | null;
}

interface StoredImport extends ImportRecord {
  file_name: string;
  error: string | null;
  created_at: Date | string;
  undone_at: Date | string | null;
}

const iso = (value: Date | string | null): string | null =>
  value === null ? null : new Date(value).toISOString();

function undoUntil(job: Pick<ImportRecord, 'status' | 'finished_at'>): Date | null {
  if (job.status !== 'done' || job.finished_at === null) return null;
  return new Date(new Date(job.finished_at).getTime() + UNDO_DAYS * 24 * 60 * 60_000);
}

/** An import of this database, for the person who made it only (404 for anyone else). */
export async function loadImport(
  db: Executor,
  input: { databaseId: string; importId: string; userId: string },
): Promise<{ answer: ImportAnswer; problems: () => Promise<ImportProblem[]> }> {
  if (!isUuid(input.importId)) throw notFound();
  const { rows } = await db.execute<StoredImport>(sql`
    SELECT id, database_id, "by", status, row_count, problem_count, finished_at, file_name, error,
      created_at, undone_at
    FROM db_imports WHERE id = ${input.importId} AND database_id = ${input.databaseId}`);
  const job = rows[0];
  if (!job || job.by !== input.userId) throw notFound();
  const until = undoUntil(job);
  const answer: ImportAnswer = {
    importId: job.id,
    databaseId: job.database_id,
    fileName: job.file_name,
    status: job.status,
    rowCount: job.row_count,
    problemCount: job.problem_count,
    summary:
      job.status === 'queued' || job.status === 'failed'
        ? null
        : importSummary(job.row_count, job.problem_count),
    error: job.status === 'failed' ? job.error : null,
    createdAt: iso(job.created_at) ?? '',
    finishedAt: iso(job.finished_at),
    undoneAt: iso(job.undone_at),
    undoUntil: iso(until),
  };
  const problems = async () => {
    const { rows: found } = await db.execute<{ problems: ImportProblem[] }>(sql`
      SELECT problems FROM db_imports WHERE id = ${job.id}`);
    return found[0]?.problems ?? [];
  };
  return { answer, problems };
}

// ------------------------------------------------------------------ Undo import

/**
 * Moves the rows an import added to Trash, for the person who made it, within 7 days, and only
 * while none of them changed since (409 lists the ones that did). Rows already in Trash stay
 * there; the properties and options it made stay too.
 */
export async function undoImport(
  app: FastifyInstance,
  input: { databaseId: string; importId: string; userId: string },
): Promise<{ rowIds: string[] }> {
  if (!isUuid(input.importId)) throw notFound();
  return runRowWrites(app, async (tx) => {
    const job = await lockImport(tx, input.importId);
    if (!job || job.database_id !== input.databaseId || job.by !== input.userId) throw notFound();
    if (job.status === 'queued') throw httpError(409, 'conflict', IMPORT_MESSAGES.notFinished);
    if (job.status === 'failed') throw invalid(IMPORT_MESSAGES.failed);
    if (job.status === 'undone') throw httpError(409, 'conflict', IMPORT_MESSAGES.undone);
    const until = undoUntil(job);
    if (!until || until.getTime() < Date.now()) throw invalid(IMPORT_MESSAGES.tooLate);
    const record = await loadDatabase(tx, input.databaseId);
    if (!record || record.inTrash) throw notFound();
    // Changed since: values (edited_at) or the row's page (title, icon, content) after its import.
    const { rows } = await tx.execute<{ id: string; changed: boolean }>(sql`
      SELECT r.page_id AS id, (r.edited_at > r.created_at OR p.updated_at > r.created_at) AS changed
      FROM db_rows r JOIN pages p ON p.id = r.page_id
      WHERE r.import_id = ${job.id} AND p.deleted_at IS NULL
      ORDER BY r.created_at, r.page_id`);
    const changed = rows.filter((r) => r.changed).map((r) => r.id);
    if (changed.length) {
      throw httpError(409, 'conflict', IMPORT_MESSAGES.changedSince, {
        rowIds: changed.slice(0, MAX_LISTED_CHANGED),
        count: changed.length,
      });
    }
    const { rowIds } = await trashRows(tx, {
      databaseId: record.id,
      rowIds: rows.map((r) => r.id),
      actorUserId: input.userId,
    });
    await tx.execute(sql`
      UPDATE db_imports SET status = 'undone', undone_at = now() WHERE id = ${job.id}`);
    return { rowIds };
  });
}
