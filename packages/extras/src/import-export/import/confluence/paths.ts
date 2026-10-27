// Finding the files a Confluence page links to in its space's HTML export (Import and export spec,
// section 3.2; IE-06). A link's address is read against the folder of the page it's on, then
// looked up among the zip's entry names. The names are only looked up, never used as paths, and
// an address that would leave the zip finds nothing.

/** An address with a scheme ("https:", "javascript:") or one from the site's root ("/", "//"). */
const NOT_RELATIVE = /^(?:[a-z][a-z\d+.-]*:|[\\/])/i;

/**
 * The zip entry that `href`, on the page `page` (an entry name), points at, or null when it isn't
 * in the zip. A query or a #part is left off, as Confluence adds them to pictures and headings.
 */
export function entryOf(page: string, href: string, names: ReadonlySet<string>): string | null {
  const address = href.trim();
  if (address === '' || NOT_RELATIVE.test(address)) return null;
  const path = address.replace(/[?#].*$/s, '');
  if (path === '') return null;
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    // A stray "%" stays as it is.
  }
  for (const candidate of new Set([decoded, path])) {
    const parts = page.split('/').slice(0, -1);
    let inside = true;
    for (const part of candidate.split('/')) {
      if (part === '' || part === '.') continue;
      if (part !== '..') parts.push(part);
      else if (parts.pop() === undefined) inside = false;
    }
    const entry = parts.join('/');
    if (inside && names.has(entry)) return entry;
  }
  return null;
}

/** The space's folder in the zip: the folder of its index.html, or of its first page. */
export function spaceFolder(names: readonly string[]): string {
  const pages = names.filter((name) => /\.html?$/i.test(name));
  const index = pages
    .filter((name) => /(?:^|\/)index\.html?$/i.test(name))
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))[0];
  const first = index ?? [...pages].sort()[0] ?? '';
  return first.includes('/') ? first.slice(0, first.lastIndexOf('/') + 1) : '';
}
