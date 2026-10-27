const SAFE_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);

/** Removes control characters and spaces, which browsers skip when they read a URL scheme. */
function compact(value: string): string {
  let out = '';
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code > 0x20 && code !== 0x7f) out += char;
  }
  return out;
}

/** True for http(s), mailto and tel links, and for links without a scheme (like `/p/123`). */
export function isSafeHref(href: string): boolean {
  const value = compact(href);
  if (!value) return false;
  const scheme = /^([a-z][a-z\d+.-]*):/i.exec(value)?.[1];
  return scheme === undefined || SAFE_SCHEMES.has(scheme.toLowerCase());
}
