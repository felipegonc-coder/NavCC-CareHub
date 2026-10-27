// Export routes at /api/databases (decision 0200; spec 3.8): start a CSV export of a view or of
// everything (`databases.csv-export`), then download the file for 24 hours. Only the person who
// asked can download it; every answer uses fixed messages.
import { randomUUID } from 'node:crypto';
import { idSchema, parseRequest, type RequestResult } from '@carehub/databases/schemas';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { httpError } from '../../core/errors';
import { scheduleJob } from '../jobs';
import { pageAccessOf } from '../pages';
import { invalidRequest, notFound } from './errors';
import {
  EXPORT_JOB,
  attachment,
  checkExportable,
  loadExport,
  registerExportJob,
  type ExportJob,
} from './export';
import { loadDatabase } from './store';

/** POST /:id/export: This view (`viewId` needed) or Everything (`viewId` left out). */
export const exportRequest = z
  .strictObject({ viewId: idSchema.optional(), scope: z.enum(['view', 'all']) })
  .refine((body) => body.scope === 'all' || body.viewId !== undefined);

/** The checked body, or 400 with the fixed message. */
function accept<T>(result: RequestResult<T>): T {
  if (!result.ok) throw invalidRequest();
  return result.value;
}

function signedIn(request: FastifyRequest): { id: string } {
  if (!request.user) throw httpError(401, 'signed_out');
  return request.user;
}

export default async function exportRoutes(app: FastifyInstance) {
  registerExportJob(app);
  const forViewers = { preHandler: app.requirePageAccess('view') };

  /** The route's database page id. */
  function databaseOf(request: FastifyRequest): string {
    const page = pageAccessOf(request);
    if (page.kind !== 'database') throw notFound();
    return page.pageId;
  }

  // Starts the export job; its result is { exportId, fileName, rowCount }.
  app.post('/:id/export', forViewers, async (request, reply) => {
    const user = signedIn(request);
    const body = accept(parseRequest(exportRequest, request.body));
    const record = await loadDatabase(app.db, databaseOf(request));
    if (!record || record.inTrash) throw notFound();
    const viewId = body.scope === 'view' ? (body.viewId ?? null) : null;
    await checkExportable(app.db, { record, viewId, userId: user.id });
    const payload: ExportJob = {
      exportId: randomUUID(),
      databaseId: record.id,
      viewId,
      userId: user.id,
    };
    const { jobId } = await scheduleJob({
      kind: EXPORT_JOB,
      payload,
      key: payload.exportId,
      workspaceId: record.workspaceId,
      ownerUserId: user.id,
    });
    return reply.code(202).send({ jobId });
  });

  // The finished CSV, for the person who asked, for 24 hours.
  app.get('/:id/exports/:exportId', forViewers, async (request, reply) => {
    const user = signedIn(request);
    const file = await loadExport(app.db, {
      databaseId: databaseOf(request),
      exportId: String((request.params as { exportId?: unknown }).exportId ?? ''),
      userId: user.id,
    });
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', attachment(file.fileName))
      .header('cache-control', 'private, no-store')
      .header('x-content-type-options', 'nosniff')
      .send(file.csv);
  });
}
