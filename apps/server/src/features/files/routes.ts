import { Readable } from 'node:stream';
import {
  fileFromUrlBodySchema,
  fileParamsSchema,
  fileReadQuerySchema,
  fileUploadQuerySchema,
} from '@carehub/shared';
import multipart from '@fastify/multipart';
import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { HttpError, httpError } from '../../core/errors';
import type { Db, Tx } from '../../db';
import { registerPeriodicTask } from '../jobs';
import { getDefaultWorkspace } from '../workspaces';
import { anonymousRefusal } from './anonymous';
import { detectFileType, hasBlockedEnding, type FileType } from './detect';
import { cleanFileName, tooLargeMessage, withPictureEnding } from './names';
import {
  cleanPicture,
  PictureError,
  REDRAW_MAX_PIXELS,
  redrawPicture,
  type CleanedPicture,
} from './pictures';
import { downloadRemoteFile, RemoteError, type RemoteFailure } from './remote';
import { files } from './schema';
import {
  canUseFileScope,
  hasFileScope,
  isAnonymousScope,
  type AnonymousFileScopeContext,
  type FileScopeContext,
} from './scopes';
import { FILE_CSP, sendStoredFile } from './serve';
import {
  bytesUploadedToday,
  cleanUpFiles,
  deleteFiles,
  getFile,
  uploadedFileJson,
  type StoredFile,
} from './service';
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
const NOT_THERE = "Files can't be added there.";
/** Uploads to anonymous scopes at once, from anyone: each may hold a picture being drawn again. */
const MAX_ANONYMOUS = 8;
const BUSY_UPLOADS = 'Care Hub is taking in other files. Try again in a moment.';
const QUOTA = 'No more files can be added here today. Try again tomorrow.';
/** Pictures drawn again for anonymous scopes are read whole into memory. */
const REDRAW_MAX_MB = 64;
const PICTURE_TOO_LARGE =
  `This picture is too large to add here: the limit is ${REDRAW_MAX_PIXELS / 1_000_000} ` +
  `megapixels and ${REDRAW_MAX_MB} MB.`;
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

  /**
   * Where an upload goes, once it's clear the person may add files there. On the anonymous route the
   * scope sees no one, even someone signed in, so nothing ties them to the upload (decision 0010).
   */
  const writableScope = async (
    request: FastifyRequest,
    scope: string,
    { signedIn }: { signedIn: boolean },
  ): Promise<Target> => {
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
    return { feature, scopeId, workspaceId, userId: ctx.user?.id ?? null, anonymous };
  };

  /**
   * Anonymous scopes take at most FILES_ANONYMOUS_DAILY_MB in a day. Checked before an upload, then
   * again as it's recorded, one upload at a time per scope (`lock`).
   */
  const checkQuota = async (db: Db | Tx, target: Target, incoming: number, lock = false) => {
    if (lock) {
      const key = `files-quota:${target.feature}:${target.scopeId}`;
      await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
    }
    const quota = readFilesSettings(app.log).FILES_ANONYMOUS_DAILY_MB * MB;
    const used = await bytesUploadedToday(db, target.feature, target.scopeId);
    if (used + Math.max(0, incoming) > quota) throw httpError(429, 'rate_limited', QUOTA);
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

  /** Why a file can't be added to an anonymous scope, or null when it can. */
  const anonymousCheck = async (
    tempPath: string,
    file: ReceivedFile & { name: string },
    type: FileType,
  ) => {
    const reader = await store.reader(tempPath);
    return anonymousRefusal({ type, name: file.name, size: file.size, read: reader.read }).finally(
      reader.close,
    );
  };

  /**
   * What to keep of a checked file: for pictures, a copy at `cleanPath` without location, camera and
   * other details (Data settings, DS-07), and the size they're shown at. In anonymous scopes (`redraw`),
   * a new picture drawn from the pixels alone.
   */
  const withoutDetails = async (
    tempPath: string,
    cleanPath: string,
    received: ReceivedFile,
    type: FileType,
    redraw = false,
  ) => {
    const plain = { path: tempPath, file: { ...received, width: null, height: null } };
    if (type.kind !== 'picture') return plain;
    const reader = await store.reader(tempPath);
    const picture = await cleanPicture(type.mimeType, { size: received.size, read: reader.read })
      .catch((error: unknown) => {
        throw error instanceof PictureError ? httpError(400, 'invalid', DAMAGED) : error;
      })
      .finally(reader.close);
    if (redraw) return drawAgain(tempPath, cleanPath, received, type, picture);
    if (!picture) return plain;
    const { width, height, pieces } = picture;
    if (!pieces) return { path: tempPath, file: { ...received, width, height } };
    const rebuilt = await store.rebuild(tempPath, pieces, cleanPath);
    return { path: cleanPath, file: { ...rebuilt, width, height } };
  };

  /** A JPEG or PNG drawn again, upright, from the picture's pixels alone (decision 0200). */
  const drawAgain = async (
    tempPath: string,
    cleanPath: string,
    received: ReceivedFile,
    type: FileType,
    picture: CleanedPicture | null,
  ) => {
    const { mimeType } = type;
    if (mimeType !== 'image/jpeg' && mimeType !== 'image/png') {
      throw new Error(`${mimeType} pictures can't be drawn again.`);
    }
    if (!picture?.width || !picture.height) throw httpError(400, 'invalid', DAMAGED);
    if (picture.width * picture.height > REDRAW_MAX_PIXELS || received.size > REDRAW_MAX_MB * MB) {
      throw httpError(413, 'too_large', PICTURE_TOO_LARGE);
    }
    const original = await store.readAll(tempPath);
    const redrawn = await redrawPicture(mimeType, original, picture.orientation).catch(
      (error: unknown) => {
        if (!(error instanceof PictureError)) throw error;
        app.log.warn({ error: error.message }, 'an uploaded picture could not be drawn again');
        throw httpError(400, 'invalid', DAMAGED);
      },
    );
    const bytes = Buffer.from(redrawn.bytes.buffer, redrawn.bytes.byteOffset, redrawn.bytes.length);
    const file = await store.receive(Readable.from([bytes]), cleanPath);
    return { path: cleanPath, file: { ...file, width: redrawn.width, height: redrawn.height } };
  };

  /**
   * Moves a checked file into place and records it; returns what POST answers. In anonymous scopes, no
   * uploader is kept and the file waits to be claimed (claimFiles).
   */
  const keepFile = async (
    tempPath: string,
    file: ReceivedFile & {
      name: string;
      type: FileType;
      width: number | null;
      height: number | null;
    },
    target: Target,
  ) => {
    const storageKey = await store.keep(tempPath);
    const record = (db: Db | Tx) =>
      db
        .insert(files)
        .values({
          workspaceId: target.workspaceId,
          scopeFeature: target.feature,
          scopeId: target.scopeId,
          uploadedBy: target.anonymous ? null : target.userId,
          name: file.name,
          mimeType: file.type.mimeType,
          size: file.size,
          width: file.width,
          height: file.height,
          sha256: file.sha256,
          storageKey,
          claimDeadline: target.anonymous ? sql`now() + interval '1 hour'` : null,
        })
        .returning();
    try {
      const [row] = target.anonymous
        ? await app.db.transaction(async (tx: Tx) => {
            await checkQuota(tx, target, file.size, true);
            return record(tx);
          })
        : await record(app.db);
      if (!row) throw new Error('The file was not saved.');
      return uploadedFileJson(row);
    } catch (error) {
      await store.remove(store.pathOf(storageKey));
      throw error;
    }
  };

  /** Takes the file in a multipart upload, checks it, and keeps it at `target`. */
  const takeUpload = async (request: FastifyRequest, reply: FastifyReply, target: Target) => {
    const limitMb = readFilesSettings(app.log).FILES_MAX_MB;
    const declared = Number(request.headers['content-length'] ?? 0);
    if (declared > limitMb * MB + WRAPPING_BYTES) {
      throw httpError(413, 'too_large', tooLargeMessage(declared, limitMb));
    }
    if (!request.isMultipart()) throw httpError(400, 'invalid', NO_FILE);
    await checkFreeSpace(declared);
    if (target.anonymous) await checkQuota(app.db, target, declared - WRAPPING_BYTES);
    const tempPath = store.tempPath();
    const cleanPath = store.tempPath();
    try {
      const upload = await receiveUpload(request, store, tempPath, limitMb * MB);
      if (upload.truncated) {
        throw httpError(413, 'too_large', tooLargeMessage(limitMb * MB + 1, limitMb));
      }
      const type = await typeOf(tempPath, upload);
      if (type === 'program') throw httpError(400, 'invalid', PROGRAMS);
      let name = upload.name;
      if (target.anonymous) {
        const refusal = await anonymousCheck(tempPath, upload, type);
        if (refusal) throw httpError(400, 'invalid', refusal);
        if (type.kind === 'picture') name = withPictureEnding(name, type.mimeType);
      }
      const kept = await withoutDetails(tempPath, cleanPath, upload, type, target.anonymous);
      return reply.code(201).send(await keepFile(kept.path, { ...kept.file, name, type }, target));
    } finally {
      await Promise.all([store.remove(tempPath), store.remove(cleanPath)]);
    }
  };

  // Guests too: the scope decides (a page shared with them, for example).
  const guarded = { config: { allowGuests: true }, preHandler: app.requireMember };

  app.post('/', guarded, async (request, reply) => {
    const { scope } = fileUploadQuerySchema.parse(request.query);
    return takeUpload(request, reply, await writableScope(request, scope, { signedIn: true }));
  });

  // Uploads from people who aren't signed in, to anonymous scopes only: a form anyone can fill in
  // (decision 0010). The CSRF double-submit still applies.
  let anonymousUploads = 0;
  app.post('/anonymous', { config: { public: true } }, async (request, reply) => {
    const { scope } = fileUploadQuerySchema.parse(request.query);
    if (anonymousUploads >= MAX_ANONYMOUS) throw httpError(429, 'rate_limited', BUSY_UPLOADS);
    anonymousUploads += 1;
    try {
      return await takeUpload(
        request,
        reply,
        await writableScope(request, scope, { signedIn: false }),
      );
    } finally {
      anonymousUploads -= 1;
    }
  });

  // A picture pasted from another website, copied so it keeps working (Pages and blocks, PB-D3).
  let copies = 0;
  app.post('/from-url', guarded, async (request, reply) => {
    const { url, scope } = fileFromUrlBodySchema.parse(request.body);
    const target = await writableScope(request, scope, { signedIn: true });
    if (target.anonymous) throw httpError(400, 'invalid', NO_COPIES);
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
      return reply.code(201).send(await keepFile(kept.path, picture, target));
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

/** Where an upload goes (writableScope). */
interface Target {
  feature: string;
  scopeId: string;
  workspaceId: string;
  /** Who uploads; null on the anonymous route. */
  userId: string | null;
  /** The scope follows the anonymous rules (registered with `allowAnonymous: true`). */
  anonymous: boolean;
}

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
