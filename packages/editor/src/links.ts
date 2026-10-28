const SAFE_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);
const SCHEME = /^([a-z][a-z\d+.-]*):/i;

/**
 * Spaces, control characters and invisible characters (like U+00A0, U+200B, U+2028, U+3164 and
 * U+FEFF). Browsers skip some of them when they read a URL, and other programs may skip others,
 * so links are checked without any of them.
 */
const BLANK = /^[\s\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]$/u;
const isBlank = (char: string) => BLANK.test(char);

/** Removes every blank character, so none can hide a scheme (like `java\u200bscript:`). */
function compact(value: string): string {
  let out = '';
  for (const char of value) if (!isBlank(char)) out += char;
  return out;
}

/** `value` without blank characters at the start and end. */
function trimBlanks(value: string): string {
  const chars = [...value];
  let start = 0;
  let end = chars.length;
  while (start < end && isBlank(chars[start] ?? '')) start += 1;
  while (end > start && isBlank(chars[end - 1] ?? '')) end -= 1;
  return chars.slice(start, end).join('');
}

/** `//host/path` goes to another site, on the page's own scheme. Browsers read `\` as `/` here. */
const isProtocolRelative = (value: string) => /^[/\\]{2}/.test(value);
const isSlashOrBlank = (char: string) => char === '/' || char === '\\' || isBlank(char);

/** True if `value` reads as a URL with a host. */
function isUrl(value: string): boolean {
  try {
    return new URL(value).host !== '';
  } catch {
    return false;
  }
}

/**
 * The href to use for a link, or null if it isn't safe. Safe are http(s), mailto and tel links,
 * and links inside Care Hub (no scheme, like `/p/123`). A link starting with `//` goes to another
 * site, so it is only allowed as an https link: `//example.com` becomes `https://example.com`.
 * Blank characters at the ends are dropped, and the scheme is read without the ones inside.
 */
export function safeHref(href: unknown): string | null {
  if (typeof href !== 'string') return null;
  // The href it checks is the one it returns: blank characters are trimmed first.
  const raw = trimBlanks(href);
  const value = compact(raw);
  if (isProtocolRelative(value)) {
    const chars = [...raw];
    let start = 0;
    while (start < chars.length && isSlashOrBlank(chars[start] ?? '')) start += 1;
    const url = `https://${chars.slice(start).join('')}`;
    return isUrl(url) ? url : null;
  }
  if (!value) return null;
  const scheme = SCHEME.exec(value)?.[1];
  if (scheme !== undefined && !SAFE_SCHEMES.has(scheme.toLowerCase())) return null;
  return raw;
}

/** True for http(s), mailto and tel links, links inside Care Hub (like `/p/123`) and `//host`. */
export const isSafeHref = (href: string) => safeHref(href) !== null;

/** True for links to other sites (http, https or `//host`), which open in a new tab. */
export function opensNewTab(href: string): boolean {
  const value = compact(href);
  return isProtocolRelative(value) || /^https?:/i.test(value);
}

/**
 * Turns what someone typed into a link address, or returns null if it can't be one. An address
 * with a scheme, or starting with `/`, `#` or `?`, goes through `safeHref`, so `//host` becomes
 * `https://host`.
 */
export function normalizeLinkInput(raw: string): string | null {
  const value = raw.trim();
  if (!value || /\s/.test(value)) return null;
  if (/^(https?:\/\/|mailto:|tel:|[/#?])/i.test(value)) return safeHref(value);
  if (/^[^@/:]+@[^@/:]+\.[a-z]{2,}$/i.test(value)) return `mailto:${value}`;
  if (/^[a-z\d-]+(\.[a-z\d-]+)*\.[a-z]{2,}(:\d+)?([/?#]|$)/i.test(value)) return `https://${value}`;
  return null;
}

/**
 * The link mark's attributes for a safe `href`. `target` matches how the link is drawn: `_blank`
 * for other sites, none for Care Hub, `mailto` and `tel` links.
 */
export const linkAttributes = (href: string) => ({
  href,
  target: opensNewTab(href) ? '_blank' : null,
});

/** The address of a Care Hub page, `/p/<pageId>` (like `pageUrl` in @carehub/shared). */
export const pageHref = (pageId: string) => `/p/${encodeURIComponent(pageId)}`;
