import { isCareHubPath } from '@carehub/shared';

/**
 * A full link to a Care Hub path, for Copy link and anything else pasted outside Care Hub:
 * `fullLink(pageUrl(id))` is `https://carehub.example.test/p/<id>`. In the browser, Care Hub's web
 * address (CAREHUB_PUBLIC_URL) is the page's own origin: Care Hub is served there, and the server
 * refuses changes from any other origin. Links the server sends come from `app.links`
 * (apps/server/src/core/links.ts). Throws a RangeError for anything that isn't a Care Hub path.
 */
export function fullLink(path: string): string {
  const { origin } = window.location;
  const url = isCareHubPath(path) ? new URL(path, origin) : null;
  if (!url || url.origin !== origin) {
    throw new RangeError('A Care Hub link needs a path that starts with one slash.');
  }
  return url.href;
}
