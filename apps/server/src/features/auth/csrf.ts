import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const newCsrfToken = () => randomBytes(32).toString('base64url');
/** The CSRF token that belongs to a session: an HMAC of its secret token, so a planted cookie can't match it. */
export const csrfTokenForSession = (sessionToken: string) =>
  createHmac('sha256', sessionToken).update('carehub-csrf').digest('base64url');
export const isWellFormedCsrfToken = (value: unknown): value is string =>
  typeof value === 'string' && TOKEN_FORMAT.test(value);

function same(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** No Origin header (not a browser), or it matches CAREHUB_PUBLIC_URL, or (when that isn't set) the Host header. */
export function isAllowedOrigin(
  origin: string | undefined,
  host: string | undefined,
  publicOrigin: string | null,
) {
  if (origin === undefined) return true;
  try {
    const url = new URL(origin);
    if (publicOrigin) return url.origin === new URL(publicOrigin).origin;
    return host !== undefined && new URL(`${url.protocol}//${host}`).host === url.host;
  } catch {
    return false;
  }
}

export interface CsrfInput {
  method: string;
  origin: string | undefined;
  host: string | undefined;
  publicOrigin: string | null;
  header: string | string[] | undefined;
  cookie: string | undefined;
  /** The request's valid session token, if any. The header must then also match that session's CSRF token. */
  sessionToken: string | undefined;
}

/** Double-submit check for state-changing requests. Returns what failed, or null. */
export function checkCsrf(input: CsrfInput): 'origin' | 'token' | null {
  if (SAFE_METHODS.has(input.method.toUpperCase())) return null;
  if (!isAllowedOrigin(input.origin, input.host, input.publicOrigin)) return 'origin';
  const { header, cookie, sessionToken } = input;
  if (!isWellFormedCsrfToken(header) || !isWellFormedCsrfToken(cookie) || !same(header, cookie))
    return 'token';
  if (sessionToken && !same(header, csrfTokenForSession(sessionToken))) return 'token';
  return null;
}
