import type { StoredFile } from './file-store';

/** Sent with every file, so nothing in one can run as Care Hub, even when it's opened on its own. */
export const FILE_CSP = "sandbox; default-src 'none'; style-src 'unsafe-inline'";

const OPENS_IN_BROWSER = /^(image|video|audio)\/|^application\/pdf$/;

/**
 * Headers for sending a stored file. Pictures, video, audio and PDFs open in the browser; everything else (and
 * anything asked for with `?download=1`) downloads. Every read is checked again, so nothing is cached.
 */
export function fileHeaders(file: StoredFile, download: boolean): Record<string, string> {
  const inline = !download && OPENS_IN_BROWSER.test(file.mimeType);
  return {
    'content-type': file.mimeType,
    'content-disposition': contentDisposition(inline ? 'inline' : 'attachment', file.name),
    'x-content-type-options': 'nosniff',
    'content-security-policy': FILE_CSP,
    'cross-origin-resource-policy': 'same-origin',
    'cache-control': 'private, no-store',
    'accept-ranges': 'bytes',
  };
}

/** A Content-Disposition value with a plain ASCII name and the full UTF-8 name (RFC 6266). */
export function contentDisposition(type: 'inline' | 'attachment', name: string): string {
  const plain = name.replace(/[^\x20-\x7e]|["\\]/g, '_');
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${type}; filename="${plain}"; filename*=UTF-8''${encoded}`;
}

/**
 * The bytes a `Range` header asks for (`end` included), null to send the whole file (no header, several ranges
 * or one that can't be read), or 'unsatisfiable' when the range starts past the end.
 */
export function parseRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | null | 'unsatisfiable' {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header?.trim() ?? '');
  const [first = '', last = ''] = match ? match.slice(1) : [];
  if (!match || (first === '' && last === '')) return null;
  if (first === '') {
    const length = Number(last);
    return length === 0 || size === 0
      ? 'unsatisfiable'
      : { start: Math.max(0, size - length), end: size - 1 };
  }
  const start = Number(first);
  if (start >= size) return 'unsatisfiable';
  const end = last === '' ? size - 1 : Math.min(Number(last), size - 1);
  return end < start ? null : { start, end };
}
