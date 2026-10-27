const SAFE_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);
const SCHEME = /^([a-z][a-z\d+.-]*):/i;

/** Spaces and control characters, which browsers skip when they read a URL. */
function isBlank(char: string): boolean {
  const code = char.charCodeAt(0);
  return code <= 0x20 || code === 0x7f;
}

/** Removes spaces and control characters, which browsers skip when they read a URL scheme. */
function compact(value: string): string {
  let out = '';
  for (const char of value) if (!isBlank(char)) out += char;
  return out;
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
 */
export function safeHref(href: unknown): string | null {
  if (typeof href !== 'string') return null;
  const value = compact(href);
  if (isProtocolRelative(value)) {
    let start = 0;
    while (start < href.length && isSlashOrBlank(href.charAt(start))) start += 1;
    const url = `https://${href.slice(start).trim()}`;
    return isUrl(url) ? url : null;
  }
  if (!value) return null;
  const scheme = SCHEME.exec(value)?.[1];
  if (scheme !== undefined && !SAFE_SCHEMES.has(scheme.toLowerCase())) return null;
  return href.trim();
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
