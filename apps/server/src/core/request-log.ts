// Request lines for the server log without link codes: anyone who has a code can open what it unlocks,
// so the log mustn't keep one (decision 0010: form link codes stay out of the Fastify logs).
import type { IncomingHttpHeaders } from 'node:http';

/**
 * Paths whose rest is a link code, or starts with one: everything after the prefix is hidden. A route
 * that takes a link code adds its prefix here. Other segments that look like a code are hidden anyway.
 */
export const CAPABILITY_PATHS: readonly string[] = ['/forms/', '/api/forms/'];

const HIDDEN = '***';
/** The built web files: public, and named after their content. */
const BUILD_FILES = '/assets/';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A file extension, as in a download link such as `/feed/<code>.ics`. */
const EXTENSION = /\.[A-Za-z0-9]{1,10}$/;

export interface MaskedUrl {
  url: string;
  /** Whether part of the path was hidden: a link code, or something that looks like one. */
  code: boolean;
}

/**
 * The URL as the log shows it. Query values become `***` (they can hold search words or sign-in
 * codes), and so does the rest of a capability path and any path segment that looks like a link code:
 * 22 or more letters, digits, `-` or `_` with a capital or a digit among them, as `randomBytes(16)`
 * gives in base64url. UUIDs stay, since IDs aren't secrets. The fragment is left out.
 */
export function maskUrl(url: string): MaskedUrl {
  const beforeHash = url.split('#', 1)[0] ?? '';
  const queryAt = beforeHash.indexOf('?');
  const path = queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt);
  const query = queryAt === -1 ? '' : `?${maskQuery(beforeHash.slice(queryAt + 1))}`;

  // The router decodes the path and the web app ignores case, so /%66orms/… and /Forms/… open a form.
  const plain = decodeAscii(path)
    .replace(/\/{2,}/g, '/')
    .toLowerCase();
  const prefix = CAPABILITY_PATHS.find((start) => plain.startsWith(start));
  if (prefix) return { url: `${prefix}${HIDDEN}${query}`, code: true };
  if (path.startsWith(BUILD_FILES)) return { url: `${path}${query}`, code: false };

  let code = false;
  const segments = path.split('/').map((segment) => {
    const shown = hideCode(segment);
    if (shown !== segment) code = true;
    return shown;
  });
  return { url: `${segments.join('/')}${query}`, code };
}

/** What Fastify gives the `req` log serializer: its request, or Node's request before routing. */
export interface LoggedRequest {
  method?: string;
  url?: string;
  host?: string;
  ip?: string;
  headers?: IncomingHttpHeaders;
  socket?: { remoteAddress?: string; remotePort?: number } | null;
}

export type RequestLogLine = {
  method?: string;
  url: string;
  host?: string;
  remoteAddress?: string;
  remotePort?: number;
};

/**
 * Fastify's `req` log serializer with link codes hidden (see maskUrl). When part of the path was
 * hidden, the address it came from is left out too, so an answer to a public form stays anonymous.
 */
export function serializeRequest(request: LoggedRequest): RequestLogLine {
  const { url, code } = maskUrl(request.url ?? '');
  const line: RequestLogLine = {
    method: request.method,
    url,
    host: request.host ?? request.headers?.host,
  };
  if (!code) {
    line.remoteAddress = request.ip ?? request.socket?.remoteAddress;
    line.remotePort = request.socket?.remotePort;
  }
  return line;
}

/** Names stay, unless they look like a code; values become `***`, and so does a part without `=`. */
function maskQuery(query: string): string {
  if (query === '') return '';
  return query
    .split('&')
    .map((part) => {
      const equals = part.indexOf('=');
      if (equals === -1) return part === '' ? '' : HIDDEN;
      const name = part.slice(0, equals);
      return `${looksLikeCode(decodeAscii(name)) ? HIDDEN : name}=${HIDDEN}`;
    })
    .join('&');
}

/** The segment, or `***` (plus its extension) when it looks like a link code. */
function hideCode(segment: string): string {
  const plain = decodeAscii(segment);
  const extension = EXTENSION.exec(plain)?.[0] ?? '';
  const stem = plain.slice(0, plain.length - extension.length);
  return looksLikeCode(stem) ? `${HIDDEN}${extension}` : segment;
}

function looksLikeCode(text: string): boolean {
  return /^[A-Za-z0-9_-]{22,}$/.test(text) && /[A-Z0-9]/.test(text) && !UUID.test(text);
}

/** Decodes `%XX` escapes of ASCII characters (all a path prefix or a code is made of); never throws. */
function decodeAscii(text: string): string {
  return text.replace(/%([0-7][0-9A-Fa-f])/g, (_escape, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
}
