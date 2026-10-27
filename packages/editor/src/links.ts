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

/** Turns what someone typed into a link address, or returns null if it can't be one. */
export function normalizeLinkInput(raw: string): string | null {
  const value = raw.trim();
  if (!value || /\s/.test(value)) return null;
  if (/^(https?:\/\/|mailto:|tel:|[/#?])/i.test(value)) return isSafeHref(value) ? value : null;
  if (/^[^@/:]+@[^@/:]+\.[a-z]{2,}$/i.test(value)) return `mailto:${value}`;
  if (/^[a-z\d-]+(\.[a-z\d-]+)*\.[a-z]{2,}(:\d+)?([/?#]|$)/i.test(value)) return `https://${value}`;
  return null;
}

/** Link attributes for `href`: links inside Care Hub (no scheme) open in the same tab. */
export const linkAttributes = (href: string) =>
  /^[a-z][a-z\d+.-]*:/i.test(href) ? { href } : { href, target: null };

/** The address of a Care Hub page, `/p/<pageId>` (like `pageUrl` in @carehub/shared). */
export const pageHref = (pageId: string) => `/p/${encodeURIComponent(pageId)}`;
