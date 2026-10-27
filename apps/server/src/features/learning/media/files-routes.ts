import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { fileHeaders, parseRange } from './file-http';
import {
  deleteStoredFile,
  openStoredFile,
  prepareFileDir,
  readStoredFile,
  saveUpload,
  type StoredFile,
} from './file-store';
import { fileScopeFor, type FileUser } from './files';

export type FilesStandInOptions = {
  /** Where files go. Default: `carehub-learning-files` in FILES_DIR, or in the system's temp folder. */
  dir?: string;
  /** The signed-in person, or null. Default: core's `request.user`. */
  getUser?: (
    request: FastifyRequest,
  ) => FileUser | null | undefined | Promise<FileUser | null | undefined>;
  /** How many uploads one person may run at once (default 3). */
  maxUploadsEach?: number;
  /** Uploads are refused when the disk would have less than this free (default 1 GB). */
  minFreeBytes?: number;
};

/** The stand-in runs only outside production builds (decision 0010), so it can never ship. */
export const filesStandInAllowed = (env: Record<string, string | undefined> = process.env) =>
  env.NODE_ENV !== 'production';

const SIGNED_OUT = 'Sign in to continue.';
const FORBIDDEN = "You don't have access to this.";
const NOT_FOUND = 'This was deleted, or the link is wrong.';
const uploadQuery = z.object({ scope: z.string().regex(/^[a-z][a-z-]*:[A-Za-z0-9_-]{1,100}$/) });
const fileParams = z.object({ id: z.string() });

const coreUser = (request: FastifyRequest): FileUser | null =>
  (request as unknown as { user?: FileUser | null }).user ?? null;

/** Sends the shared error shape, `{ error: { code, message } }`. */
function sendError(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
): FastifyReply {
  return reply.code(status).send({ error: { code, message } });
}

function headerName(value: string | string[] | undefined): string {
  try {
    return decodeURIComponent((Array.isArray(value) ? value[0] : value) ?? '');
  } catch {
    return '';
  }
}

/**
 * Stand-in for core's files API (decision 0007 section 4.3) until it lands, with its rules: the type comes from
 * the content, size limits apply while the file streams in, programs and SVG are refused, every read checks
 * access again, and files go out with `nosniff` and a sandboxing CSP. Mounted at `/files`:
 * `POST /files?scope=learning:<courseId>` with the file as an `application/octet-stream` body and its name
 * percent-encoded in `X-File-Name`; `GET /files/:id` (Range, `?download=1`); `DELETE /files/:id`.
 */
const filesStandIn: FastifyPluginAsync<FilesStandInOptions> = async (app, options) => {
  const dir = options.dir ?? join(process.env.FILES_DIR || tmpdir(), 'carehub-learning-files');
  const getUser = options.getUser ?? coreUser;
  const maxUploadsEach = options.maxUploadsEach ?? 3;
  const minFreeBytes = options.minFreeBytes ?? 1024 ** 3;
  const uploading = new Map<string, number>();
  await prepareFileDir(dir);
  app.log.warn({ dir }, 'The Learning files stand-in is on. It never runs in production.');

  // The body stays unread here: the upload streams it from request.raw.
  app.addContentTypeParser(
    'application/octet-stream',
    (_request: FastifyRequest, _payload: unknown, done: (error: Error | null) => void) =>
      done(null),
  );

  /** The file, if it exists and this person may read (or change) it. Otherwise answers, and gives null. */
  async function findFile(
    request: FastifyRequest,
    reply: FastifyReply,
    want: 'read' | 'write',
  ): Promise<StoredFile | null> {
    const user = await getUser(request);
    const file = user && (await readStoredFile(dir, fileParams.parse(request.params).id));
    const scope = file && fileScopeFor(file.scope);
    if (!user) sendError(reply, 401, 'signed_out', SIGNED_OUT);
    else if (!file || !scope) sendError(reply, 404, 'not_found', NOT_FOUND);
    else if (await scope.rules[want === 'read' ? 'canRead' : 'canWrite'](user, scope.scopeId))
      return file;
    else sendError(reply, 403, 'forbidden', FORBIDDEN);
    return null;
  }

  app.post('/', async (request, reply) => {
    // Answers before the body is read close the connection, so Node doesn't read the rest of it.
    const refuse = (status: number, code: string, message: string) =>
      sendError(reply.header('connection', 'close'), status, code, message);
    const user = await getUser(request);
    if (!user) return refuse(401, 'signed_out', SIGNED_OUT);
    const query = uploadQuery.safeParse(request.query);
    const scope = query.success ? fileScopeFor(query.data.scope) : undefined;
    if (!query.success || !scope) {
      return refuse(400, 'invalid', 'Say where the file goes: ?scope=learning:<course id>.');
    }
    if (!(await scope.rules.canWrite(user, scope.scopeId))) {
      return refuse(403, 'forbidden', FORBIDDEN);
    }
    const size = Number(request.headers['content-length'] ?? Number.NaN);
    if (!Number.isSafeInteger(size)) return refuse(400, 'invalid', "Send the file's size.");
    if (size === 0) return refuse(400, 'invalid', 'The file is empty.');
    const running = uploading.get(user.id) ?? 0;
    if (running >= maxUploadsEach) {
      const message = `You're already uploading ${running} files. Try again when one has finished.`;
      return refuse(429, 'rate_limited', message);
    }
    uploading.set(user.id, running + 1);
    try {
      const saved = await saveUpload(dir, request.raw, {
        scope: query.data.scope,
        name: headerName(request.headers['x-file-name']),
        size,
        userId: user.id,
        minFreeBytes,
      });
      if (!saved.ok && saved.close) return refuse(saved.status, saved.code, saved.message);
      if (!saved.ok) return sendError(reply, saved.status, saved.code, saved.message);
      return reply.code(201).send(uploadAnswer(saved.file, app.prefix));
    } finally {
      const left = (uploading.get(user.id) ?? 1) - 1;
      if (left > 0) uploading.set(user.id, left);
      else uploading.delete(user.id);
    }
  });

  // HEAD is declared here, not added by Fastify, so it keeps the file's Content-Length without opening the file.
  app.route({
    method: ['GET', 'HEAD'],
    url: '/:id',
    handler: async (request, reply) => {
      const file = await findFile(request, reply, 'read');
      if (!file) return reply;
      const range = parseRange(request.headers.range, file.size);
      if (range === 'unsatisfiable') {
        reply.header('content-range', `bytes */${file.size}`);
        return sendError(reply, 416, 'invalid', "That part of the file doesn't exist.");
      }
      const download = (request.query as { download?: unknown }).download === '1';
      reply.headers(fileHeaders(file, download));
      if (range) {
        reply.code(206).header('content-range', `bytes ${range.start}-${range.end}/${file.size}`);
      }
      const { start, end } = range ?? { start: 0, end: file.size - 1 };
      reply.header('content-length', String(end - start + 1));
      if (request.method === 'HEAD') return reply.send();
      return reply.send(openStoredFile(dir, file.id, { start, end }));
    },
  });

  app.delete('/:id', async (request, reply) => {
    const file = await findFile(request, reply, 'write');
    if (!file) return reply;
    await deleteStoredFile(dir, file.id);
    return reply.code(204).send();
  });
};

/** The upload's answer, in the shape of core's `POST /api/files`. */
function uploadAnswer(file: StoredFile, base: string) {
  const { id, name, size, mimeType, width, height } = file;
  return { id, name, size, mimeType, url: `${base}/${id}`, ...(width ? { width, height } : {}) };
}

export default filesStandIn;
