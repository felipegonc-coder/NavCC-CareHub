import { fileParamsSchema, fileReadQuerySchema, fileUploadQuerySchema } from '@carehub/shared';
import multipart from '@fastify/multipart';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { HttpError, httpError } from '../../core/errors';
import { detectFileType, hasBlockedEnding } from './detect';
import { cleanFileName, tooLargeMessage } from './names';
import { files } from './schema';
import { canUseFileScope, hasFileScope, type FileScopeContext } from './scopes';
import { FILE_CSP, sendStoredFile } from './serve';
import { deleteFiles, getFile, uploadedFileJson, type StoredFile } from './service';
import { readFilesSettings } from './settings';
import { fileStore, type FileStore } from './storage';

const MB = 1024 * 1024;
/** Room for the multipart wrapping around a file, when an upload is judged by its Content-Length. */
const WRAPPING_BYTES = 64 * 1024;
const PROGRAMS = "Programs can't be uploaded.";
const NO_FILE = 'Choose a file to upload.';
const CANCELLED = 'The upload was cancelled.';

/** /api/files: upload, show or download, and delete files (decision 0007, section 4.3). */
const filesRoutes: FastifyPluginAsync = async (app) => {
  const store = fileStore(readFilesSettings(app.log).FILES_DIR);
  await store.prepare();
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

  // Guests too: the scope decides (a page shared with them, for example).
  const guarded = { config: { allowGuests: true }, preHandler: app.requireMember };

  app.post('/', guarded, async (request, reply) => {
    const { scope } = fileUploadQuerySchema.parse(request.query);
    const feature = scope.slice(0, scope.indexOf(':'));
    if (!hasFileScope(feature)) throw httpError(400, 'invalid', "Files can't be added there.");
    const ctx = context(request, scope.slice(feature.length + 1));
    if (!(await canUseFileScope('write', feature, ctx))) throw httpError(403, 'forbidden');

    const limitMb = readFilesSettings(app.log).FILES_MAX_MB;
    const declared = Number(request.headers['content-length'] ?? 0);
    if (declared > limitMb * MB + WRAPPING_BYTES) {
      throw httpError(413, 'too_large', tooLargeMessage(declared, limitMb));
    }
    if (!request.isMultipart()) throw httpError(400, 'invalid', NO_FILE);
    const tempPath = store.tempPath();
    try {
      const upload = await receiveUpload(request, store, tempPath, limitMb * MB);
      if (upload.truncated) {
        throw httpError(413, 'too_large', tooLargeMessage(limitMb * MB + 1, limitMb));
      }
      const reader = await store.reader(tempPath);
      const type = await detectFileType({ ...upload, read: reader.read }).finally(reader.close);
      if (type === 'program') throw httpError(400, 'invalid', PROGRAMS);

      const storageKey = await store.keep(tempPath);
      try {
        const [file] = await app.db
          .insert(files)
          .values({
            workspaceId: ctx.member.workspaceId,
            scopeFeature: feature,
            scopeId: ctx.scopeId,
            uploadedBy: ctx.user.id,
            name: upload.name,
            mimeType: type.mimeType,
            size: upload.size,
            sha256: upload.sha256,
            storageKey,
          })
          .returning();
        if (!file) throw new Error('The file was not saved.');
        return reply.code(201).send(uploadedFileJson(file));
      } catch (error) {
        await store.remove(store.pathOf(storageKey));
        throw error;
      }
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
      return sendStoredFile(request, reply, store, file, download === '1');
    },
  });

  // The file is gone at once; the nightly clean-up removes its bytes (Data settings, DS-02).
  app.delete('/:id', guarded, async (request, reply) => {
    const file = await findFile(request, 'write');
    await deleteFiles(app.db, [file.id]);
    return reply.code(204).send();
  });
};

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
