/** Rich text for Text properties and form descriptions: spans with marks, colors, links and mentions. */
import {
  OPTION_COLORS,
  TEXT_MARKS,
  type Mention,
  type RichText,
  type RichTextSpan,
  type TextColor,
  type TextMark,
} from './types';

export function plainText(rt: RichText | null | undefined): string {
  return rt ? rt.map((s) => s.text).join('') : '';
}

export function fromPlainText(s: string): RichText {
  return s ? [{ text: s }] : [];
}

export function richTextLength(rt: RichText | null | undefined): number {
  return plainText(rt).length;
}

export function isRichTextEmpty(rt: RichText | null | undefined): boolean {
  return !rt || rt.every((s) => s.text === '' && !s.mention);
}

/**
 * http or https, then "//", a host (letters, digits, hyphens and dots, or a bracketed IPv6 address),
 * an optional port, then an optional path, query or fragment. No user name or password before the
 * host (issue #12), no spaces, control or invisible formatting characters anywhere.
 */
const SAFE_WEB_LINK =
  /^https?:\/\/(?:[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*|\[[0-9a-f:.]+\])(?::\d{1,5})?(?:[/?#][^\s\p{Cc}\p{Cf}]*)?$/iu;

/** Longest link we keep. */
export const MAX_LINK_LENGTH = 2_000;

/**
 * True for http and https web addresses only (checked without URL, which the package can't assume).
 * Use it before a value becomes an href, an "Open a link" target or a stored URL property value.
 * Anything else (javascript:, data:, vbscript:, //host, relative paths, user names before the host,
 * leading spaces or tabs, mixed-case schemes hiding script) is refused.
 */
export function isSafeWebLink(url: string): boolean {
  return typeof url === 'string' && url.length <= MAX_LINK_LENGTH && SAFE_WEB_LINK.test(url);
}

/** Links inside rich text follow the same rule as web links. */
export function isSafeLink(url: string): boolean {
  return isSafeWebLink(url);
}

const COLORS = new Set<string>(
  OPTION_COLORS.filter((c) => c !== 'default').flatMap((c) => [c, `${c}_background`]),
);
const MARKS = new Set<string>(TEXT_MARKS);

function sameFormat(a: RichTextSpan, b: RichTextSpan): boolean {
  return (
    !a.mention &&
    !b.mention &&
    a.link === b.link &&
    a.color === b.color &&
    (a.marks ?? []).join() === (b.marks ?? []).join()
  );
}

/** Drops empty spans, sorts and de-duplicates marks, and merges neighbours with the same formatting. */
export function normalizeRichText(rt: RichText): RichText {
  const out: RichTextSpan[] = [];
  for (const s of rt) {
    if (s.text === '' && !s.mention) continue;
    const span: RichTextSpan = { text: s.text };
    const marks = [...new Set(s.marks ?? [])]
      .filter((m) => MARKS.has(m))
      .sort((x, y) => TEXT_MARKS.indexOf(x) - TEXT_MARKS.indexOf(y));
    if (marks.length) span.marks = marks;
    if (s.color) span.color = s.color;
    if (s.link) span.link = s.link;
    if (s.mention) span.mention = s.mention;
    const prev = out[out.length - 1];
    if (prev && sameFormat(prev, span)) prev.text += span.text;
    else out.push(span);
  }
  return out;
}

function readMention(m: unknown): Mention | null {
  if (typeof m !== 'object' || m === null) return null;
  const v = m as Record<string, unknown>;
  if ((v.kind === 'user' || v.kind === 'page') && typeof v.id === 'string' && v.id)
    return { kind: v.kind, id: v.id };
  if (v.kind === 'date' && typeof v.date === 'object' && v.date !== null) {
    const d = v.date as Record<string, unknown>;
    if (
      typeof d.start === 'string' &&
      (d.end === null || typeof d.end === 'string') &&
      typeof d.hasTime === 'boolean'
    ) {
      return { kind: 'date', date: { start: d.start, end: d.end, hasTime: d.hasTime } };
    }
  }
  return null;
}

/**
 * Checks untrusted rich text (from a request). Unknown marks and colors are dropped, unsafe links
 * are removed, and bad mentions become plain text. Returns null if it isn't rich text or is too long.
 */
export function sanitizeRichText(input: unknown, maxLength: number): RichText | null {
  if (!Array.isArray(input)) return null;
  const spans: RichTextSpan[] = [];
  for (const raw of input) {
    if (typeof raw !== 'object' || raw === null) return null;
    const r = raw as Record<string, unknown>;
    if (typeof r.text !== 'string') return null;
    const span: RichTextSpan = { text: r.text };
    if (Array.isArray(r.marks)) {
      const marks = r.marks.filter((m): m is TextMark => typeof m === 'string' && MARKS.has(m));
      if (marks.length) span.marks = marks;
    }
    if (typeof r.color === 'string' && COLORS.has(r.color)) span.color = r.color as TextColor;
    if (typeof r.link === 'string' && isSafeLink(r.link)) span.link = r.link;
    const mention = readMention(r.mention);
    if (mention) span.mention = mention;
    spans.push(span);
  }
  const out = normalizeRichText(spans);
  return richTextLength(out) > maxLength ? null : out;
}
