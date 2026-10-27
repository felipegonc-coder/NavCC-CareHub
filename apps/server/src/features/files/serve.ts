import { createReadStream } from 'node:fs';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { httpError } from '../../core/errors';
import { showsInBrowser } from './detect';
import { contentDisposition } from './names';
import type { StoredFile } from './service';
import type { FileStore } from './storage';

/** Sent with every file answer, errors included: nothing in a file can run or load anything. */
export const FILE_CSP =
  "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'";

export type ByteRange = { start: number; end: number };

/**
 * A single `Range: bytes=…` (RFC 9110, section 14). `null` means send the whole file: no Range, one that
 * isn't understood, or several ranges. `'unsatisfiable'` means answer 416.
 */
export function parseRange(
  header: string | undefined,
  size: number,
): ByteRange | 'unsatisfiable' | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header?.trim() ?? '');
  if (!match) return null;
  const [, first = '', last = ''] = match;
  if (!first && !last) return null;
  if (!first) {
    const suffix = Number(last);
    if (suffix === 0 || size === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(first);
  if (last && Number(last) < start) return null;
  if (start >= size) return 'unsatisfiable';
  return { start, end: last ? Math.min(Number(last), size - 1) : size - 1 };
}

/** Whether `If-None-Match` lists this ETag (weak comparison) or is `*`. */
export function etagMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header
    .split(',')
    .map((tag) => tag.trim().replace(/^W\//, ''))
    .some((tag) => tag === '*' || tag === etag);
}

/**
 * Answers GET or HEAD for a stored file: the whole file, one range of it, 304 when unchanged, or 416.
 * Only pictures, video, audio and PDFs are shown in the browser; everything else downloads.
 */
export async function sendStoredFile(
  request: FastifyRequest,
  reply: FastifyReply,
  store: FileStore,
  file: StoredFile,
  download: boolean,
) {
  const filePath = store.pathOf(file.storageKey);
  if (!(await store.exists(filePath))) {
    request.log.error({ fileId: file.id }, 'a stored file is missing from FILES_DIR');
    throw httpError(404, 'not_found');
  }
  const etag = `"${file.sha256}"`;
  const inline = !download && showsInBrowser(file.mimeType);
  reply
    .header('Content-Type', file.mimeType)
    .header('Content-Disposition', contentDisposition(inline ? 'inline' : 'attachment', file.name))
    // Asks again every time, so access is checked on every view.
    .header('Cache-Control', 'private, no-cache')
    .header('ETag', etag)
    .header('Accept-Ranges', 'bytes');
  if (etagMatches(request.headers['if-none-match'], etag)) return reply.code(304).send();

  const ifRange = request.headers['if-range'];
  const range =
    ifRange === undefined || ifRange === etag ? parseRange(request.headers.range, file.size) : null;
  if (range === 'unsatisfiable') {
    return reply.code(416).header('Content-Range', `bytes */${file.size}`).send();
  }
  const { start, end } = range ?? { start: 0, end: file.size - 1 };
  if (range) reply.code(206).header('Content-Range', `bytes ${start}-${end}/${file.size}`);
  reply.header('Content-Length', String(end - start + 1));
  if (request.method === 'HEAD' || file.size === 0) return reply.send();
  return reply.send(createReadStream(filePath, { start, end }));
}
