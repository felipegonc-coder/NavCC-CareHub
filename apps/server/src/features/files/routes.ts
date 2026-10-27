import { Readable } from 'node:stream';
import {
  fileFromUrlBodySchema,
  fileParamsSchema,
  fileReadQuerySchema,
  fileUploadQuerySchema,
} from '@carehub/shared';
import multipart from '@fastify/multipart';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { HttpError, httpError } from '../../core/errors';
import { registerPeriodicTask } from '../jobs';
import { getDefaultWorkspace } from '../workspaces';
import { hasBlockedEnding } from './detect';
import {
  checkFreeSpace,
  checkQuota,
  fileTypeOf,
  keepFile,
  NOT_THERE,
  PROGRAMS,
  type Destination,
} from './keep';
import { cleanFileName, tooLargeMessage, withPictureEnding } from './names';
import { downloadRemoteFile, RemoteError, type RemoteFailure } from './remote';
import {
  canUseFileScope,
  hasFileScope,
  isAnonymousScope,
  type AnonymousFileScopeContext,
  type FileScopeContext,
} from './scopes';
import { FILE_CSP, sendStoredFile } from './serve';
import { cleanUpFiles, deleteFiles, getFile, uploadedFileJson, type StoredFile } from './service';
import { readFilesSettings } from './settings';
import { fileStore, type FileStore } from './storage';

const MB = 1024 * 1024;
const HOUR_MS = 60 * 60 * 1000;
/** Room for the multipart wrapping around a file, when an upload is judged by its Content-Length. */
const WRAPPING_BYTES = 64 * 1024;
const NO_FILE = 'Choose a file to upload.';
const CANCELLED = 'The upload was cancelled.';
/** Uploads to anonymous scopes at once, from anyone: each may hold a picture being drawn again. */
const MAX_ANONYMOUS = 8;
const BUSY_UPLOADS = 'Care Hub is taking in other files. Try again in a moment.';
const NO_COPIES = "Pictures from other websites can't be added here.";
/** Pictures copied from other websites (Pages and blocks, PB-D3). */
const FROM_URL_MAX_MB = 10;
/** Copies at once: each holds its picture in memory until it's checked. */
const MAX_COPIES = 4;
const BUSY = 'Care Hub is copying other pictures. Try again in a moment.';
const NOT_A_PICTURE = "That address isn't a picture. Only pictures are copied from other websites.";
const COPY_FAILED: Readonly<Record<Exclude<RemoteFailure, 'status' | 'too_large'>, string>> = {
  address: 'Paste a full web address that starts with https://.',
  not_public: 'Care Hub copies pictures only from public websites.',
  not_found: "That website couldn't be found. Check the address.",
  unreachable: "That website couldn't be reached. Try again later.",
  redirects: 'That address sends you on to too many others.',
  timeout: 'That website took too long to answer.',
};

/** /api/files: upload, show or download, and delete files (decision 0007, section 4.3). */
const filesRoutes: FastifyPluginAsync = async (app) => {
  const root = readFilesSettings(app.log).FILES_DIR;
  const store = fileStore(root);
  await store.prepare();
  // Every hour, one run at a time across servers.
  registerPeriodicTask('files.clean-up', HOUR_MS, async ({ now, signal }) => {
    await cleanUpFiles(app.db, { now, root, signal });
  });
  await app.register(multipart, {
    limits: {
      fieldNameSize: 100,
      fieldSize: 1024,
      fields: 10,
      files: 1,
      parts: 20,
      headerPairs: 100,
    },
  });

  // Every answer from here, errors included, is never sniffed and can't run anything.
  app.addHook('onSend', async (_request, reply, payload) => {
    reply
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', FILE_CSP)
      .header('Cross-Origin-Resource-Policy', 'same-origin');
    return payload;
  });

  // requireMember has run, so both are set.
  const context = (request: FastifyRequest, scopeId: string): FileScopeContext => {
    if (!request.user || !request.member) throw httpError(403, 'forbidden');
    return { db: app.db, user: request.user, member: request.member, scopeId };
  };

  /** A file the person may open (`read`) or delete (`write`): 404 when it's gone, 403 without access. */
  const findFile = async (request: FastifyRequest, mode: 'read' | 'write'): Promise<StoredFile> => {
    const params = fileParamsSchema.safeParse(request.params);
    const file = params.success ? await getFile(app.db, params.data.id) : null;
    if (!file || file.workspaceId !== request.member?.workspaceId) {
      throw httpError(404, 'not_found');
    }
    if (!(await canUseFileScope(mode, file.scopeFeature, context(request, file.scopeId)))) {
      throw httpError(403, 'forbidden');
    }
    return file;
  };

  /**
   * Where the person's file goes, once it's clear they may add files to `scope`. On the anonymous route
   * the scope sees no one, even someone signed in, so nothing ties them to the upload (decision 0010).
   */
  const destination = async (
    request: FastifyRequest,
    scope: string,
    { signedIn }: { signedIn: boolean },
  ): Promise<Destination> => {
    const feature = scope.slice(0, scope.indexOf(':'));
    const anonymous = isAnonymousScope(feature);
    if (!hasFileScope(feature) || (!signedIn && !anonymous)) {
      throw httpError(400, 'invalid', NOT_THERE);
    }
    const scopeId = scope.slice(feature.length + 1);
    const ctx: AnonymousFileScopeContext = signedIn
      ? context(request, scopeId)
      : { db: app.db, user: null, member: null, scopeId };
    if (!(await canUseFileScope('write', feature, ctx))) throw httpError(403, 'forbidden');
    const workspaceId = ctx.member?.workspaceId ?? (await getDefaultWorkspace(app.db))?.id;
    if (!workspaceId) throw new Error('There is no workspace to keep the file in.');
    return { workspaceId, feature, scopeId, uploadedBy: ctx.user?.id ?? null, anonymous };
  };

  /** Takes the file in a multipart upload, checks it, and keeps it at `to`. */
  const takeUpload = async (request: FastifyRequest, reply: FastifyReply, to: Destination) => {
    const limitMb = readFilesSettings(app.log).FILES_MAX_MB;
    const declared = Number(request.headers['content-length'] ?? 0);
    if (declared > limitMb * MB + WRAPPING_BYTES) {
      throw httpError(413, 'too_large', tooLargeMessage(declared, limitMb));
    }
    if (!request.isMultipart()) throw httpError(400, 'invalid', NO_FILE);
    await checkFreeSpace(store, declared);
    if (to.anonymous) await checkQuota(app.db, to, declared - WRAPPING_BYTES);
    const tempPath = store.tempPath();
    try {
      const upload = await receiveUpload(request, store, tempPath, limitMb * MB);
      if (upload.truncated) {
        throw httpError(413, 'too_large', tooLargeMessage(limitMb * MB + 1, limitMb));
      }
      const file = await keepFile(app.db, store, tempPath, upload, to, app.log);
      await store.settle(file.storageKey);
      return reply.code(201).send(uploadedFileJson(file));
    } finally {
      await store.remove(tempPath);
    }
  };

  // Guests too: the scope decides (a page shared with them, for example).
  const guarded = { config: { allowGuests: true }, preHandler: app.requireMember };

  app.post('/', guarded, async (request, reply) => {
    const { scope } = fileUploadQuerySchema.parse(request.query);
    return takeUpload(request, reply, await destination(request, scope, { signedIn: true }));
  });

  // Uploads from people who aren't signed in, to anonymous scopes only: a form anyone can fill in
  // (decision 0010). The CSRF double-submit still applies.
  let anonymousUploads = 0;
  app.post('/anonymous', { config: { public: true } }, async (request, reply) => {
    const { scope } = fileUploadQuerySchema.parse(request.query);
    if (anonymousUploads >= MAX_ANONYMOUS) throw httpError(429, 'rate_limited', BUSY_UPLOADS);
    anonymousUploads += 1;
    try {
      const to = await destination(request, scope, { signedIn: false });
      return await takeUpload(request, reply, to);
    } finally {
      anonymousUploads -= 1;
    }
  });

  // A picture pasted from another website, copied so it keeps working (Pages and blocks, PB-D3).
  let copies = 0;
  app.post('/from-url', guarded, async (request, reply) => {
    const { url, scope } = fileFromUrlBodySchema.parse(request.body);
    const to = await destination(request, scope, { signedIn: true });
    if (to.anonymous) throw httpError(400, 'invalid', NO_COPIES);
    const limitMb = Math.min(FROM_URL_MAX_MB, readFilesSettings(app.log).FILES_MAX_MB);
    if (copies >= MAX_COPIES) throw httpError(429, 'rate_limited', BUSY);
    await checkFreeSpace(store, limitMb * MB);
    copies += 1;
    const remote = await downloadRemoteFile(url, { maxBytes: limitMb * MB })
      .catch((error: unknown) => {
        throw error instanceof RemoteError ? copyFailed(error, limitMb) : error;
      })
      .finally(() => {
        copies -= 1;
      });
    const tempPath = store.tempPath();
    try {
      const received = await store.receive(Readable.from([remote.bytes]), tempPath);
      const name = cleanFileName(remote.name || 'picture');
      const type = await fileTypeOf(store, tempPath, { ...received, name });
      if (type === 'program' || type.kind !== 'picture') {
        throw httpError(400, 'invalid', NOT_A_PICTURE);
      }
      const picture = { ...received, name: withPictureEnding(name, type.mimeType), type };
      const file = await keepFile(app.db, store, tempPath, picture, to);
      await store.settle(file.storageKey);
      return reply.code(201).send(uploadedFileJson(file));
    } finally {
      await store.remove(tempPath);
    }
  });

  app.route({
    method: ['GET', 'HEAD'],
    url: '/:id',
    exposeHeadRoute: false,
    ...guarded,
    handler: async (request, reply) => {
      const file = await findFile(request, 'read');
      const { download } = fileReadQuerySchema.parse(request.query);
      // Files from anonymous scopes are always downloaded, PDFs and pictures too (decision 0010).
      const asDownload = download === '1' || isAnonymousScope(file.scopeFeature);
      return sendStoredFile(request, reply, store, file, asDownload);
    },
  });

  // The file is gone at once; the clean-up removes its bytes a day later (Data settings, DS-02).
  app.delete('/:id', guarded, async (request, reply) => {
    const file = await findFile(request, 'write');
    await deleteFiles(app.db, [file.id]);
    return reply.code(204).send();
  });
};

/** The answer when a picture couldn't be copied: 413 when it's too large, else 400 saying why. */
function copyFailed(error: RemoteError, limitMb: number): HttpError {
  if (error.reason === 'too_large') {
    const message = error.detail
      ? tooLargeMessage(error.detail, limitMb)
      : `This picture is over the ${limitMb} MB limit.`;
    return httpError(413, 'too_large', message);
  }
  if (error.reason === 'status') {
    const message = `That website answered with error ${error.detail ?? ''} instead of a picture.`;
    return httpError(400, 'invalid', message);
  }
  return httpError(400, 'invalid', COPY_FAILED[error.reason]);
}

/**
 * Writes the upload in the multipart field `file` to `tempPath`, refusing program endings before any byte
 * is kept. An upload cancelled in the browser (the connection closes before the end) stops there.
 */
async function receiveUpload(
  request: FastifyRequest,
  store: FileStore,
  tempPath: string,
  maxBytes: number,
) {
  let closedEarly = false;
  let stream: { destroy(): void } | undefined;
  const cancel = () => {
    if (request.raw.readableEnded) return;
    closedEarly = true;
    stream?.destroy();
  };
  request.raw.once('close', cancel);
  try {
    const part = await request
      .file({ limits: { fileSize: maxBytes }, throwFileSizeLimit: false })
      .catch((error: unknown) => {
        if (closedEarly) throw httpError(400, 'invalid', CANCELLED);
        throw error instanceof HttpError ? error : httpError(400, 'invalid', NO_FILE);
      });
    if (!part || part.fieldname !== 'file') {
      part?.file.resume();
      throw httpError(400, 'invalid', NO_FILE);
    }
    const name = cleanFileName(part.filename);
    if (hasBlockedEnding(name)) {
      part.file.resume();
      throw httpError(400, 'invalid', PROGRAMS);
    }
    stream = part.file;
    if (closedEarly) part.file.destroy();
    const received = await store.receive(part.file, tempPath).catch((error: unknown) => {
      throw closedEarly ? httpError(400, 'invalid', CANCELLED) : error;
    });
    return { ...received, name, truncated: part.file.truncated };
  } finally {
    request.raw.off('close', cancel);
  }
}

export default filesRoutes;
