/** The address of a page, database or row: `/p/<pageId>`. */
export function pageUrl(id: string): string {
  return `/p/${encodeURIComponent(id)}`;
}

/**
 * Whether `path` is a path on Care Hub itself, such as `/p/<id>` or `/calendar?event=7#today`: one
 * leading slash, and no backslashes, spaces or control characters, which browsers can read as the
 * start of another site's address. For links made from paths (`fullLink` in the web app,
 * `app.links.to` on the server).
 */
export function isCareHubPath(path: string): boolean {
  if (!path.startsWith('/') || path.startsWith('//')) return false;
  for (const char of path) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0x7f || char === '\\' || /\s/u.test(char)) return false;
  }
  return true;
}
