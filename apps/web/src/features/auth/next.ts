export const SIGN_IN_PATH = '/sign-in';

// Any origin works: `next` only ever names a path on this site.
const BASE = 'https://care-hub.invalid';

/** The sign-in screen, coming back to `next` (a path with its query and hash) afterwards. */
export function signInPath(next = '/'): string {
  return next === '/' || next === ''
    ? SIGN_IN_PATH
    : `${SIGN_IN_PATH}?next=${encodeURIComponent(next)}`;
}

/**
 * Where to go after signing in: `raw` when it is a path on this site, else Home. Refuses other
 * sites (`//host`, `/\host`, `https:`), and the sign-in screen itself.
 */
export function safeNext(raw: string | null | undefined): string {
  if (!raw?.startsWith('/')) return '/';
  let url: URL;
  try {
    url = new URL(raw, BASE);
  } catch {
    return '/';
  }
  if (url.origin !== BASE || url.pathname.startsWith('//')) return '/';
  if (url.pathname === SIGN_IN_PATH || url.pathname.startsWith(`${SIGN_IN_PATH}/`)) return '/';
  return `${url.pathname}${url.search}${url.hash}`;
}
