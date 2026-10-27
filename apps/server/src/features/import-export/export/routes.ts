// /api/import-export/exports (Import and export spec, section 3.3): start an export, follow it and
// download it. Small exports are ready in the answer to POST; bigger ones run as a job, and the
// maker gets a 🔔 notice when the download is ready.
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { httpError } from '../../../core/errors';
import { registerJobHandler, registerPeriodicTask } from '../../jobs';
import { EXPORT_FORMATS } from './schema';
import {
  canExport,
  downloadExport,
  EXPORT_JOB,
  expireExports,
  failExportJob,
  getExport,
  runExportJob,
  startExport,
  viewablePage,
} from './service';

const startSchema = z
  .object({
    pageId: z.uuid(),
    format: z.enum(EXPORT_FORMATS).default('markdown'),
    includeSubpages: z.boolean().default(false),
    includeFiles: z.boolean().default(true),
    databases: z.enum(['view', 'all']).default('all'),
    viewId: z
      .string()
      .regex(/^[\w-]{1,64}$/)
      .optional(),
  })
  .strict();
const idParams = z.object({ id: z.uuid() });
const pageQuery = z.object({ pageId: z.uuid() });

function userIdOf(request: FastifyRequest): string {
  if (!request.user) throw httpError(401, 'signed_out');
  return request.user.id;
}

/** Where Care Hub links inside the files point: CAREHUB_PUBLIC_URL, or this request's host. */
function originOf(request: FastifyRequest): string {
  const configured = process.env.CAREHUB_PUBLIC_URL;
  if (configured && URL.canParse(configured)) return new URL(configured).origin;
  return `${request.protocol}://${request.host}`;
}

/** `attachment` with the zip's name, readable by old and new browsers. */
function attachment(fileName: string): string {
  const plain = fileName.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `attachment; filename="${plain}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

const exportRoutes: FastifyPluginAsync = async (app) => {
  registerJobHandler<{ exportId: string }>(
    EXPORT_JOB,
    (payload, ctx) => runExportJob(app.db, payload.exportId, ctx),
    {
      maxAttempts: 2,
      timeoutMs: 30 * 60_000,
      onFailed: (payload) => failExportJob(app.db, payload.exportId),
    },
  );
  registerPeriodicTask('import-export.expire-exports', 60 * 60_000, async () => {
    await expireExports(app.db);
  });

  // Whether to show Export on this page (IE-16). Never more than yes or no.
  app.get('/allowed', async (request) => {
    const { pageId } = pageQuery.parse(request.query);
    const userId = userIdOf(request);
    const page = await viewablePage(app.db, userId, pageId).catch(() => null);
    return { allowed: page !== null && (await canExport(app.db, userId, page.workspaceId)) };
  });

  app.post('/', async (request, reply) => {
    const input = startSchema.parse(request.body);
    const view = await startExport(app.db, userIdOf(request), {
      ...input,
      origin: originOf(request),
    });
    return reply.code(201).send({ export: view });
  });

  app.get('/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    return { export: await getExport(app.db, userIdOf(request), id) };
  });

  app.get('/:id/download', async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const { file, fileName } = await downloadExport(app.db, userIdOf(request), id);
    return reply
      .header('content-type', 'application/zip')
      .header('content-disposition', attachment(fileName))
      .header('cache-control', 'private, no-store')
      .header('x-content-type-options', 'nosniff')
      .send(file);
  });
};

export default exportRoutes;
