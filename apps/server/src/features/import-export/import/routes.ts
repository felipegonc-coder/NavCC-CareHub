// /api/import-export/imports (Import and export spec, section 3.1): start an import, upload its
// file, follow it, cancel it and undo it. Only the person who started an import sees it. The
// import-export routes register it; see README.md here.
import {
  IMPORT_LIMITS,
  UNDO_DAYS,
  acceptsFileName,
  importSource,
  startImportSchema,
  undoImportSchema,
  type ImportView,
  type UndoPreview,
} from '@carehub/extras/import-export/import/index';
import { SERVER_IMPORTERS } from '@carehub/extras/import-export/import/importers';
import { atLeast } from '@carehub/shared';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { httpError } from '../../../core/errors';
import type { Db } from '../../../db';
import { cancelJob, getJob, scheduleJob } from '../../jobs';
import { checkDestination, destinationTitle } from './destination';
import { IMPORT_JOB, registerImportJob } from './job';
import { importPorts } from './ports';
import {
  OPEN_STATUSES,
  countOpenImports,
  deleteUpload,
  findImport,
  insertImport,
  listImports,
  listItems,
  moveImport,
  saveUpload,
  type ImportItem,
  type ImportRow,
} from './store';
import { undoPreview, undoTrash } from './undo';
import { canUndo, importView } from './view';

export interface ImportResponse {
  import: ImportView;
}
export interface ImportListResponse {
  imports: ImportView[];
}
export interface UndoPreviewResponse {
  preview: UndoPreview;
}

/** Imports one person may have going at once (uploading, waiting or running). */
export const OPEN_MAX = 5;
/** The list shows the last 7 days (as long as Undo lasts), newest first. */
const LIST_MAX = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

const idParams = z.object({ id: z.uuid() });

function userIdOf(request: FastifyRequest): string {
  if (!request.user) throw httpError(401, 'signed_out');
  return request.user.id;
}

/** The person's own import from `:id`: 404 when there's none, 403 when it's someone else's. */
async function ownImport(db: Db, request: FastifyRequest): Promise<ImportRow> {
  const params = idParams.safeParse(request.params);
  const row = params.success ? await findImport(db, params.data.id) : null;
  if (!row) throw httpError(404, 'not_found');
  if (row.userId !== userIdOf(request)) throw httpError(403, 'forbidden');
  return row;
}

function uploadable(row: ImportRow): ImportRow {
  if (row.status !== 'uploading') throw httpError(409, 'conflict', 'This file was sent already.');
  return row;
}

/** A done import less than 7 days old, with when it finished. */
function undoable(row: ImportRow): { row: ImportRow; finishedAt: Date } {
  if (!canUndo(row, new Date()) || row.finishedAt === null) {
    throw httpError(409, 'conflict', "This import can't be undone.");
  }
  return { row, finishedAt: row.finishedAt };
}

/** Pages made by the import and changed since it finished (a changed row counts for its table). */
async function changedSince(db: Db, items: readonly ImportItem[], since: Date) {
  const pageIds = items.map((item) => item.pageId);
  return new Set(pageIds.length === 0 ? [] : await importPorts().changedSince(db, pageIds, since));
}

/** Pages made so far while the job runs. */
async function progressOf(row: ImportRow): Promise<ImportView['progress']> {
  if (row.status !== 'running' || row.jobId === null) return null;
  const progress = (await getJob(row.jobId))?.progress;
  return progress?.total === undefined ? null : { done: progress.done, total: progress.total };
}

async function viewOf(db: Db, row: ImportRow, title?: string): Promise<ImportView> {
  return importView(row, {
    title: title ?? (await destinationTitle(db, row.userId, row.pageId)),
    progress: await progressOf(row),
  });
}

const importRoutes: FastifyPluginAsync = async (app) => {
  registerImportJob(app.db);

  app.get('/', async (request): Promise<ImportListResponse> => {
    const userId = userIdOf(request);
    const since = new Date(Date.now() - UNDO_DAYS * DAY_MS);
    const titles = new Map<string | null, string>();
    const imports: ImportView[] = [];
    for (const row of await listImports(app.db, userId, since, LIST_MAX)) {
      const title = titles.get(row.pageId) ?? (await destinationTitle(app.db, userId, row.pageId));
      titles.set(row.pageId, title);
      const progress = await progressOf(row);
      imports.push(importView(row, { title, progress, problems: false }));
    }
    return { imports };
  });

  app.post('/', async (request, reply) => {
    const userId = userIdOf(request);
    const input = startImportSchema.parse(request.body);
    const source = importSource(input.source);
    if (!source || !acceptsFileName(source, input.fileName)) {
      throw httpError(400, 'invalid', source?.notAccepted);
    }
    if (!input.planned && !SERVER_IMPORTERS[input.source]) {
      throw httpError(400, 'invalid', "This kind of file can't be imported yet.");
    }
    const destination = await checkDestination(app.db, userId, input.pageId);
    if (!destination.ok) {
      throw httpError(destination.code === 'not_found' ? 404 : 403, destination.code);
    }
    if ((await countOpenImports(app.db, userId)) >= OPEN_MAX) {
      throw httpError(
        429,
        'rate_limited',
        'Wait for one of your imports to finish, then try again.',
      );
    }
    const { workspaceId, spaceId } = destination.target;
    const row = await insertImport(app.db, {
      workspaceId,
      userId,
      source: input.source,
      fileName: input.fileName,
      fileSize: input.size,
      pageId: input.pageId,
      spaceId,
      planned: input.planned,
      status: 'uploading',
    });
    const body: ImportResponse = { import: await viewOf(app.db, row, destination.title) };
    return reply.code(201).send(body);
  });

  // The file, as the raw body. Its own plugin, so only this route reads application/octet-stream
  // and takes up to 100 MB.
  await app.register(async (upload) => {
    upload.addContentTypeParser(
      'application/octet-stream',
      { parseAs: 'buffer', bodyLimit: IMPORT_LIMITS.uploadBytes },
      (_request, body, done) => done(null, body),
    );
    // Checked before the file is read, so nobody sends 100 MB to be told no.
    upload.addHook('onRequest', async (request) => {
      uploadable(await ownImport(app.db, request));
    });
    upload.put(
      '/:id/file',
      { bodyLimit: IMPORT_LIMITS.uploadBytes },
      async (request): Promise<ImportResponse> => {
        const row = uploadable(await ownImport(app.db, request));
        const bytes = request.body;
        if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
          throw httpError(400, 'invalid', 'The file is empty.');
        }
        // A plan the Import screen made has its own size; a file must be the size announced.
        if (!row.planned && bytes.byteLength !== row.fileSize) {
          throw httpError(400, 'invalid', "The file didn't arrive whole. Try again.");
        }
        const waiting = await app.db.transaction(async (tx) => {
          const moved = await moveImport(tx, row.id, ['uploading'], { status: 'waiting' });
          if (!moved) return null;
          await saveUpload(tx, row.id, bytes);
          const { jobId } = await scheduleJob(
            {
              kind: IMPORT_JOB,
              payload: { importId: row.id },
              key: row.id,
              workspaceId: row.workspaceId,
              ownerUserId: row.userId,
            },
            { db: tx },
          );
          return moveImport(tx, row.id, ['waiting'], { jobId });
        });
        if (!waiting) throw httpError(409, 'conflict', 'This file was sent already.');
        return { import: await viewOf(app.db, waiting) };
      },
    );
  });

  app.get('/:id', async (request): Promise<ImportResponse> => {
    return { import: await viewOf(app.db, await ownImport(app.db, request)) };
  });

  // Cancel (IE-11): the job's transaction rolls back, so nothing it wrote stays.
  app.post('/:id/cancel', async (request): Promise<ImportResponse> => {
    const row = await ownImport(app.db, request);
    if (row.status === 'cancelled') return { import: await viewOf(app.db, row) };
    const cancelled = await app.db.transaction(async (tx) => {
      const ended = await moveImport(tx, row.id, OPEN_STATUSES, {
        status: 'cancelled',
        finishedAt: new Date(),
      });
      if (ended) await deleteUpload(tx, row.id);
      return ended;
    });
    if (!cancelled) throw httpError(409, 'conflict', 'This import has ended already.');
    if (cancelled.jobId) await cancelJob(cancelled.jobId);
    return { import: await viewOf(app.db, cancelled) };
  });

  app.get('/:id/undo', async (request): Promise<UndoPreviewResponse> => {
    const { row, finishedAt } = undoable(await ownImport(app.db, request));
    const items = await listItems(app.db, row.id);
    return { preview: undoPreview(items, await changedSince(app.db, items, finishedAt)) };
  });

  app.post('/:id/undo', async (request): Promise<ImportResponse> => {
    const userId = userIdOf(request);
    const { removeChanged } = undoImportSchema.parse(request.body ?? {});
    const { row, finishedAt } = undoable(await ownImport(app.db, request));
    if (row.pageId !== null) {
      const access = await importPorts().pageAccess(app.db, userId, row.pageId);
      if (!access || !atLeast(access.level, 'edit')) throw httpError(403, 'forbidden');
    }
    const items = await listItems(app.db, row.id);
    const changed = removeChanged
      ? new Set<string>()
      : await changedSince(app.db, items, finishedAt);
    const trash = undoTrash(items, changed, removeChanged);
    const undone = await app.db.transaction(async (tx) => {
      const moved = await moveImport(tx, row.id, ['done'], {
        status: 'undone',
        undoneAt: new Date(),
      });
      if (moved && trash.length > 0) await importPorts().trashPages(tx, trash, userId);
      return moved;
    });
    if (!undone) throw httpError(409, 'conflict', "This import can't be undone.");
    return { import: await viewOf(app.db, undone) };
  });
};

export default importRoutes;
