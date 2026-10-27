import { personName } from './names';
import type { NameOf } from './types';

/** User and page IDs in tokens and links: letters, digits, "_" and "-", 1 to 64 (UUIDs fit). */
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MENTION_TOKEN = /<@([A-Za-z0-9_-]{1,64})>/g;

/** The stored form of an @mention: `<@userId>`. */
export function mentionToken(userId: string): string {
  if (!ID_PATTERN.test(userId)) throw new Error(`Not a user ID: ${userId}`);
  return `<@${userId}>`;
}

/** User IDs mentioned in stored text, each once, in order. */
export function findMentions(text: string): string[] {
  const ids = new Set<string>();
  for (const match of text.matchAll(MENTION_TOKEN)) {
    if (match[1]) ids.add(match[1]);
  }
  return [...ids];
}

export interface LinkSpan {
  start: number;
  end: number;
  url: string;
}

/** http(s):// not straight after a letter or digit, up to a space or a character URLs can't hold. */
const LINK_CANDIDATE = /(?<![\p{L}\p{N}])https?:\/\/[^\s<>"`\p{Cc}]+/giu;
const SAFE_HREF = /^https?:\/\/[^\s<>"`\p{Cc}]+$/iu;
const TRAILING = /[.,:;!?'…]/u;
const LABEL = '[\\p{L}\\p{N}](?:[\\p{L}\\p{N}-]*[\\p{L}\\p{N}])?';
const HOST = new RegExp(`^(?:\\[[0-9a-f:.]+\\]|${LABEL}(?:\\.${LABEL})*)(?::\\d{1,5})?$`, 'iu');
const CLOSERS: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

const countOf = (text: string, char: string) => text.split(char).length - 1;

/** Drops trailing punctuation and unbalanced closing brackets: "(see https://example.com)." */
function trimLinkEnd(url: string): string {
  let out = url;
  while (out.length > 0) {
    const last = out.charAt(out.length - 1);
    const opener = CLOSERS[last];
    const unbalanced = opener !== undefined && countOf(out, last) > countOf(out, opener);
    if (!TRAILING.test(last) && !unbalanced) break;
    out = out.slice(0, -1);
  }
  return out;
}

/** A host (letters, digits, dots, hyphens or [IPv6]) and optional port; no "user@" part. */
function hasValidHost(url: string): boolean {
  const authority = url.slice(url.indexOf('//') + 2).split(/[/?#]/u, 1)[0] ?? '';
  return !authority.includes('@') && HOST.test(authority);
}

/** Web links (http and https) in text, as written. */
export function findLinks(text: string): LinkSpan[] {
  const links: LinkSpan[] = [];
  for (const match of text.matchAll(LINK_CANDIDATE)) {
    const url = trimLinkEnd(match[0]);
    const start = match.index ?? 0;
    if (hasValidHost(url)) links.push({ start, end: start + url.length, url });
  }
  return links;
}

/** The address when it's safe in an href (http or https, nothing that breaks out), else null. */
export function safeHref(url: string): string | null {
  return SAFE_HREF.test(url) && hasValidHost(url) ? url : null;
}

/** Returns the page ID when `url` is a Care Hub page link, otherwise null. */
export type PageLinkMatcher = (url: string) => string | null;

/**
 * Matches links like `https://carehub.example.com/p/<pageId>` (then optionally "/", "?" or "#").
 * `origins` are the site's addresses; `pathPrefix` is the page route, starting with "/".
 */
export function pageLinkMatcher(options: {
  origins: readonly string[];
  pathPrefix: string;
}): PageLinkMatcher {
  const { pathPrefix } = options;
  if (!pathPrefix.startsWith('/')) throw new Error('pathPrefix must start with "/"');
  const origins = options.origins.map((origin) => origin.replace(/\/+$/u, '').toLowerCase());
  return (url) => {
    for (const origin of origins) {
      const path = url.slice(origin.length);
      if (url.slice(0, origin.length).toLowerCase() !== origin || !path.startsWith(pathPrefix)) {
        continue;
      }
      const id = path.slice(pathPrefix.length).split(/[/?#]/u, 1)[0] ?? '';
      if (ID_PATTERN.test(id)) return id;
    }
    return null;
  };
}

/** Plain data for rendering: text stays text (never HTML); links carry checked addresses. */
export type MessageSegment =
  | { type: 'text'; text: string }
  | { type: 'mention'; userId: string }
  | { type: 'link'; url: string }
  | { type: 'page'; url: string; pageId: string };

export interface ParseOptions {
  /** Only these people become mentions (pass the message's mentioned people); other tokens stay text. */
  mentionable?: Iterable<string>;
  /** Care Hub page links become `page` segments (they're also shown as cards). */
  matchPageLink?: PageLinkMatcher;
}

/** Splits stored text into text, mention, link and page segments, in order. */
export function parseMessageText(text: string, options: ParseOptions = {}): MessageSegment[] {
  const allowed = options.mentionable ? new Set(options.mentionable) : null;
  const spans: { start: number; end: number; segment: MessageSegment }[] = [];
  for (const match of text.matchAll(MENTION_TOKEN)) {
    const userId = match[1] ?? '';
    const start = match.index ?? 0;
    if (allowed && !allowed.has(userId)) continue;
    spans.push({ start, end: start + match[0].length, segment: { type: 'mention', userId } });
  }
  for (const link of findLinks(text)) {
    const pageId = options.matchPageLink?.(link.url) ?? null;
    const segment: MessageSegment = pageId
      ? { type: 'page', url: link.url, pageId }
      : { type: 'link', url: link.url };
    spans.push({ start: link.start, end: link.end, segment });
  }
  spans.sort((a, b) => a.start - b.start);

  const segments: MessageSegment[] = [];
  const pushText = (value: string) => {
    const last = segments.at(-1);
    if (!value) return;
    if (last?.type === 'text') last.text += value;
    else segments.push({ type: 'text', text: value });
  };
  let at = 0;
  for (const span of spans) {
    if (span.start < at) continue;
    pushText(text.slice(at, span.start));
    segments.push(span.segment);
    at = span.end;
  }
  pushText(text.slice(at));
  return segments;
}

/** The text as people read it: mentions become "@Avery Lin"; links stay as written. */
export function messagePlainText(text: string, nameOf: NameOf, options: ParseOptions = {}): string {
  return parseMessageText(text, options)
    .map((segment) => {
      if (segment.type === 'text') return segment.text;
      if (segment.type === 'mention') return `@${personName(nameOf(segment.userId))}`;
      return segment.url;
    })
    .join('');
}
