import { Readable } from 'node:stream';
import {
  fileFromUrlBodySchema,
  fileParamsSchema,
  fileReadQuerySchema,
  fileUploadQuerySchema,
} from '@carehub/shared';
import multipart from '@fastify/multipart';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { HttpError, httpError } from '../../core/errors';
import { registerPeriodicTask } from '../jobs';
import { detectFileType, hasBlockedEnding, type FileType } from './detect';
import { cleanFileName, tooLargeMessage, withPictureEnding } from './names';
import { cleanPicture, PictureError } from './pictures';
import { downloadRemoteFile, RemoteError, type RemoteFailure } from './remote';
import { files } from './schema';
import { canUseFileScope, hasFileScope, type FileScopeContext } from './scopes';
import { FILE_CSP, sendStoredFile } from './serve';
import { cleanUpFiles, deleteFiles, getFile, uploadedFileJson, type StoredFile } from './service';
import { readFilesSettings } from './settings';
import { fileStore, type FileStore, type ReceivedFile } from './storage';

const MB = 1024 * 1024;
const HOUR_MS = 60 * 60 * 1000;
/** Room for the multipart wrapping around a file, when an upload is judged by its Content-Length. */
const WRAPPING_BYTES = 64 * 1024;
const PROGRAMS = "Programs can't be uploaded.";
const NO_FILE = 'Choose a file to upload.';
const CANCELLED = 'The upload was cancelled.';
const DAMAGED = "This picture seems to be damaged, so it wasn't uploaded.";
const PAUSED = 'Uploads are paused because the server is almost full.';
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
  // Every hour, one run at a time across servers (Team tools' jobs).
  registerPeriodicTask('files.clean-up', HOUR_MS, async ({ signal }) => {
    await cleanUpFiles(app.db, { root, signal });
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

  /** The scope's feature and context, once it's clear the person may add files there. */
  const writableScope = async (request: FastifyRequest, scope: string) => {
    const feature = scope.slice(0, scope.indexOf(':'));
    if (!hasFileScope(feature)) throw httpError(400, 'invalid', "Files can't be added there.");
    const ctx = context(request, scope.slice(feature.length + 1));
    if (!(await canUseFileScope('write', feature, ctx))) throw httpError(403, 'forbidden');
    return { feature, ctx };
  };

  const typeOf = async (tempPath: string, file: ReceivedFile & { name: string }) => {
    const reader = await store.reader(tempPath);
    return detectFileType({ ...file, read: reader.read }).finally(reader.close);
  };

  /** Uploads pause while the disk is almost full (Data settings, DS-08). */
  const checkFreeSpace = async (incoming: number) => {
    const floor = readFilesSettings(app.log).FILES_MIN_FREE_MB * MB;
    if (floor > 0 && (await store.freeBytes()) - incoming < floor) {
      throw httpError(507, 'too_large', PAUSED);
    }
  };

  /**
   * What to keep of a checked file: for pictures, a copy at `cleanPath` without location, camera and
   * other details (Data settings, DS-07), and the size they're shown at.
   */
  const withoutDetails = async (
    tempPath: string,
    cleanPath: string,
    received: ReceivedFile,
    type: FileType,
  ) => {
    const plain = { path: tempPath, file: { ...received, width: null, height: null } };
    if (type.kind !== 'picture') return plain;
    const reader = await store.reader(tempPath);
    const picture = await cleanPicture(type.mimeType, { size: received.size, read: reader.read })
      .catch((error: unknown) => {
        throw error instanceof PictureError ? httpError(400, 'invalid', DAMAGED) : error;
      })
      .finally(reader.close);
    if (!picture) return plain;
    const { width, height, pieces } = picture;
    if (!pieces) return { path: tempPath, file: { ...received, width, height } };
    const rebuilt = await store.rebuild(tempPath, pieces, cleanPath);
    return { path: cleanPath, file: { ...rebuilt, width, height } };
  };

  /** Moves a checked file into place and records it; returns what POST answers. */
  const keepFile = async (
    tempPath: string,
    file: ReceivedFile & {
      name: string;
      type: FileType;
      width: number | null;
      height: number | null;
      feature: string;
      ctx: FileScopeContext;
    },
  ) => {
    const storageKey = await store.keep(tempPath);
    try {
      const [row] = await app.db
        .insert(files)
        .values({
          workspaceId: file.ctx.member.workspaceId,
          scopeFeature: file.feature,
          scopeId: file.ctx.scopeId,
          uploadedBy: file.ctx.user.id,
          name: file.name,
          mimeType: file.type.mimeType,
          size: file.size,
          width: file.width,
          height: file.height,
          sha256: file.sha256,
          storageKey,
        })
        .returning();
      if (!row) throw new Error('The file was not saved.');
      return uploadedFileJson(row);
    } catch (error) {
      await store.remove(store.pathOf(storageKey));
      throw error;
    }
  };

  // Guests too: the scope decides (a page shared with them, for example).
  const guarded = { config: { allowGuests: true }, preHandler: app.requireMember };

  app.post('/', guarded, async (request, reply) => {
    const { scope } = fileUploadQuerySchema.parse(request.query);
    const { feature, ctx } = await writableScope(request, scope);
    const limitMb = readFilesSettings(app.log).FILES_MAX_MB;
    const declared = Number(request.headers['content-length'] ?? 0);
    if (declared > limitMb * MB + WRAPPING_BYTES) {
      throw httpError(413, 'too_large', tooLargeMessage(declared, limitMb));
    }
    if (!request.isMultipart()) throw httpError(400, 'invalid', NO_FILE);
    await checkFreeSpace(declared);
    const tempPath = store.tempPath();
    const cleanPath = store.tempPath();
    try {
      const upload = await receiveUpload(request, store, tempPath, limitMb * MB);
      if (upload.truncated) {
        throw httpError(413, 'too_large', tooLargeMessage(limitMb * MB + 1, limitMb));
      }
      const type = await typeOf(tempPath, upload);
      if (type === 'program') throw httpError(400, 'invalid', PROGRAMS);
      const kept = await withoutDetails(tempPath, cleanPath, upload, type);
      const file = { ...kept.file, name: upload.name, type, feature, ctx };
      return reply.code(201).send(await keepFile(kept.path, file));
    } finally {
      await Promise.all([store.remove(tempPath), store.remove(cleanPath)]);
    }
  });

  // A picture pasted from another website, copied so it keeps working (Pages and blocks, PB-D3).
  let copies = 0;
  app.post('/from-url', guarded, async (request, reply) => {
    const { url, scope } = fileFromUrlBodySchema.parse(request.body);
    const { feature, ctx } = await writableScope(request, scope);
    const limitMb = Math.min(FROM_URL_MAX_MB, readFilesSettings(app.log).FILES_MAX_MB);
    if (copies >= MAX_COPIES) throw httpError(429, 'rate_limited', BUSY);
    await checkFreeSpace(limitMb * MB);
    copies += 1;
    const remote = await downloadRemoteFile(url, { maxBytes: limitMb * MB })
      .catch((error: unknown) => {
        throw error instanceof RemoteError ? copyFailed(error, limitMb) : error;
      })
      .finally(() => {
        copies -= 1;
      });
    const tempPath = store.tempPath();
    const cleanPath = store.tempPath();
    try {
      const received = await store.receive(Readable.from([remote.bytes]), tempPath);
      const name = cleanFileName(remote.name || 'picture');
      const type = await typeOf(tempPath, { ...received, name });
      if (type === 'program' || type.kind !== 'picture') {
        throw httpError(400, 'invalid', NOT_A_PICTURE);
      }
      const kept = await withoutDetails(tempPath, cleanPath, received, type);
      const picture = { ...kept.file, name: withPictureEnding(name, type.mimeType), type };
      return reply.code(201).send(await keepFile(kept.path, { ...picture, feature, ctx }));
    } finally {
      await Promise.all([store.remove(tempPath), store.remove(cleanPath)]);
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
      return sendStoredFile(request, reply, store, file, download === '1');
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
