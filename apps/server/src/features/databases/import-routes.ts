// Import routes at /api/databases (decision 0200; spec 3.7): preview a CSV or Excel file, start the
// import job (`databases.csv-import`), read an import back with its problem list, and Undo import.
// Until core files is on main, the file comes in the body: { fileName, data } with data in base64,
// at most 10 MB, under this plugin's own body limit. The file is read in a worker thread
// (import.ts); every answer uses fixed messages.
import { LIMITS } from '@carehub/databases';
import {
  CSV_SEPARATORS,
  NEW_PROPERTY_TYPES,
  checkCsvSize,
  importSummary,
  problemsCsv,
  type CsvSeparator,
} from '@carehub/databases/csv';
import { parseRequest, type RequestResult } from '@carehub/databases/schemas';
import { sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { httpError } from '../../core/errors';
import { scheduleJob } from '../jobs';
import { pageAccessOf } from '../pages';
import { invalid, invalidRequest, notFound } from './errors';
import {
  IMPORT_JOB,
  checkMayImport,
  importTarget,
  loadImport,
  readInWorker,
  registerImportJob,
  undoImport,
  type ImportRequest,
} from './import';
import { IMPORT_MESSAGES } from './import-worker';
import { loadDatabase } from './store';

/** The route's body limit: a 10 MB file as base64, and the dialog's choices. */
export const IMPORT_BODY_LIMIT = Math.ceil(LIMITS.csvBytes / 3) * 4 + 1024 * 1024;

const columnSchema = z.strictObject({
  index: z
    .number()
    .int()
    .min(0)
    .max(LIMITS.csvColumns - 1),
  header: z.string().max(1_000),
  target: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('existing'), propertyId: z.string().min(1).max(100) }),
    z.strictObject({
      kind: z.literal('new'),
      name: z.string().max(1_000),
      type: z.enum(NEW_PROPERTY_TYPES),
    }),
    z.strictObject({ kind: z.literal('skip') }),
  ]),
});

/** POST /:id/import/preview and POST /:id/import. Leave out `columns` for the first plan. */
export const importRequest = z.strictObject({
  fileName: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .refine((name) => !/\p{Cc}/u.test(name)),
  data: z
    .string()
    .min(1)
    .max(IMPORT_BODY_LIMIT)
    .regex(/^[A-Za-z0-9+/]*={0,2}$/),
  sheet: z.string().min(1).max(100).optional(),
  separator: z.enum(CSV_SEPARATORS).optional(),
  firstRowIsHeaders: z.boolean().optional(),
  columns: z.array(columnSchema).max(LIMITS.csvColumns).optional(),
});
export type ImportBody = z.infer<typeof importRequest>;

/** The checked body, or 400 with the fixed message. */
function accept<T>(result: RequestResult<T>): T {
  if (!result.ok) throw invalidRequest();
  return result.value;
}

function signedIn(request: FastifyRequest): { id: string } {
  if (!request.user) throw httpError(401, 'signed_out');
  return request.user;
}

/** CSV (.csv; .tsv is tab-separated) or Excel (.xlsx), by the file's name. */
function kindOf(fileName: string): { kind: 'csv' | 'xlsx'; separator?: CsvSeparator } | null {
  const extension = /\.([A-Za-z0-9]+)$/.exec(fileName)?.[1]?.toLowerCase();
  if (extension === 'csv') return { kind: 'csv' };
  if (extension === 'tsv') return { kind: 'csv', separator: '\t' };
  if (extension === 'xlsx') return { kind: 'xlsx' };
  return null;
}

/** The file's bytes and the dialog's choices: 400 for another kind of file, 413 over 10 MB. */
function fileOf(input: ImportBody): { choices: ImportRequest; bytes: Buffer } {
  const type = kindOf(input.fileName);
  if (!type) throw invalid(IMPORT_MESSAGES.fileType);
  const bytes = Buffer.from(input.data, 'base64');
  const tooBig = checkCsvSize(bytes.length);
  if (tooBig) throw httpError(413, 'too_large', tooBig);
  const separator = type.kind === 'csv' ? (input.separator ?? type.separator) : undefined;
  const choices: ImportRequest = {
    kind: type.kind,
    firstRowIsHeaders: input.firstRowIsHeaders ?? true,
    ...(type.kind === 'xlsx' && input.sheet !== undefined ? { sheet: input.sheet } : {}),
    ...(separator ? { separator } : {}),
    ...(input.columns ? { columns: input.columns } : {}),
  };
  return { choices, bytes };
}

export default async function importRoutes(app: FastifyInstance) {
  registerImportJob(app);
  const forEditors = { bodyLimit: IMPORT_BODY_LIMIT, preHandler: app.requirePageAccess('edit') };
  const forViewers = { preHandler: app.requirePageAccess('view') };

  /** The route's database, if the person may import into it. */
  async function importable(request: FastifyRequest) {
    const page = pageAccessOf(request);
    if (page.kind !== 'database') throw notFound();
    const record = await loadDatabase(app.db, page.pageId);
    if (!record || record.inTrash) throw notFound();
    checkMayImport(record, page.level);
    return { record, level: page.level };
  }

  /** The route's database id, for the routes that read an import back. */
  function databaseOf(request: FastifyRequest): string {
    const page = pageAccessOf(request);
    if (page.kind !== 'database') throw notFound();
    return page.pageId;
  }

  const importIdOf = (request: FastifyRequest) =>
    String((request.params as { importId?: unknown }).importId ?? '');

  // What the import would do: columns with their guessed types, the first rows and problems.
  app.post('/:id/import/preview', forEditors, async (request) => {
    const user = signedIn(request);
    const { record, level } = await importable(request);
    const { choices, bytes } = fileOf(accept(parseRequest(importRequest, request.body)));
    const target = await importTarget(app.db, record, user.id, level);
    const read = await readInWorker({ mode: 'preview', file: { ...choices, bytes }, target });
    if (!read.ok) {
      throw httpError(
        400,
        'invalid',
        read.error,
        read.sheets ? { sheets: read.sheets } : undefined,
      );
    }
    return {
      separator: read.separator,
      sheets: read.sheets,
      sheet: read.sheet,
      columns: read.columns,
      rowCount: read.rowCount,
      rows: read.rows,
      newProperties: read.newProperties,
      newOptions: read.newOptions,
      problems: read.problems,
      problemCount: read.problemCount,
      kind: choices.kind,
      firstRowIsHeaders: choices.firstRowIsHeaders,
      summary: importSummary(read.rowCount, read.problemCount),
    };
  });

  // Starts the import job; the file waits in db_import_files until the job ends.
  app.post('/:id/import', forEditors, async (request, reply) => {
    const user = signedIn(request);
    const { record } = await importable(request);
    const input = accept(parseRequest(importRequest, request.body));
    const { choices, bytes } = fileOf(input);
    const started = await app.db.transaction(async (tx) => {
      const { rows } = await tx.execute<{ id: string }>(sql`
        INSERT INTO db_imports (database_id, "by", status, file_name)
        VALUES (${record.id}, ${user.id}, 'queued', ${input.fileName})
        RETURNING id`);
      const importId = rows[0]?.id;
      if (!importId) throw new Error('The import was not saved.');
      await tx.execute(sql`
        INSERT INTO db_import_files (import_id, bytes, request)
        VALUES (${importId}, ${bytes}, ${JSON.stringify(choices)}::jsonb)`);
      const { jobId } = await scheduleJob(
        {
          kind: IMPORT_JOB,
          payload: { importId },
          key: importId,
          workspaceId: record.workspaceId,
          ownerUserId: user.id,
        },
        { db: tx },
      );
      return { importId, jobId };
    });
    return reply.code(202).send(started);
  });

  // An import as the summary shows it (the person who made it only).
  app.get('/:id/imports/:importId', forViewers, async (request) => {
    const user = signedIn(request);
    const { answer } = await loadImport(app.db, {
      databaseId: databaseOf(request),
      importId: importIdOf(request),
      userId: user.id,
    });
    return answer;
  });

  // The problem list as CSV: Row, Column, Value, Reason.
  app.get('/:id/imports/:importId/problems', forViewers, async (request, reply) => {
    const user = signedIn(request);
    const { problems } = await loadImport(app.db, {
      databaseId: databaseOf(request),
      importId: importIdOf(request),
      userId: user.id,
    });
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="import-problems.csv"')
      .send(problemsCsv(await problems()));
  });

  // Undo import: the rows it added go to Trash, unless some changed since (409 lists them).
  app.post('/:id/imports/:importId/undo', forViewers, async (request) => {
    const user = signedIn(request);
    const importId = importIdOf(request);
    const { rowIds } = await undoImport(app, {
      databaseId: databaseOf(request),
      importId,
      userId: user.id,
    });
    return { importId, rowIds };
  });
}
