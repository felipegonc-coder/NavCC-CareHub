import { z } from 'zod';
import { idSchema } from './compose';
import { SEARCH_MAX_WORDS, SEARCH_QUERY_MAX_LENGTH } from './constants';
import { findLinks } from './tokens';
import type { PageLinkMatcher } from './tokens';
import type { AttachmentKind } from './types';

const ACCENTS = /[\u0300-\u036f]/gu;
const SPECIAL_LETTERS: Readonly<Record<string, string>> = {
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  ø: 'o',
  ł: 'l',
  đ: 'd',
  ð: 'd',
  þ: 'th',
  ı: 'i',
  ħ: 'h',
};
const SPECIAL = /[ßæœøłđðþıħ]/gu;
const WORD = /[\p{L}\p{N}\p{M}]+/gu;
const QUOTE = /["“”„]/u;
/** Longer words are cut to this many characters, in the index and in queries alike. */
const WORD_MAX = 64;
/** Postgres limits: positions 1 to 16383, at most 255 positions per word. */
const POSITION_MAX = 16_383;
const POSITIONS_PER_WORD = 255;

/** Lower case without accents, so "Résumé", "RESUME" and "resume" match. */
export function foldForSearch(text: string): string {
  return text
    .normalize('NFKD')
    .replace(ACCENTS, '')
    .toLowerCase()
    .replace(SPECIAL, (letter) => SPECIAL_LETTERS[letter] ?? letter)
    .normalize('NFC');
}

export interface SearchWord {
  /** Folded. */
  word: string;
  /** Where the word is in the original text (UTF-16 offsets, end excluded). */
  start: number;
  end: number;
}

/** A text's words, folded, with their places in the original text. */
export function searchWords(text: string): SearchWord[] {
  const words: SearchWord[] = [];
  for (const match of text.matchAll(WORD)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    for (const part of foldForSearch(match[0]).match(WORD) ?? []) {
      words.push({ word: [...part].slice(0, WORD_MAX).join(''), start, end });
    }
  }
  return words;
}

const lexeme = (word: string) => `'${word.replace(/['\\]/gu, (char) => char + char)}'`;

/**
 * The search index of a message or notice as a Postgres `tsvector` literal (store it with
 * `$1::tsvector`), so the server matches words exactly as this package does. Pass the text as
 * people read it (mentions as names), file names, and a notice's title. Leave out page card titles:
 * search mustn't reveal pages someone can't open. Deleted messages get an empty index.
 */
export function searchVector(parts: readonly (string | null | undefined)[]): string {
  const positions = new Map<string, number[]>();
  let position = 0;
  for (const part of parts) {
    const words = searchWords(part ?? '');
    if (words.length === 0) continue;
    for (const { word } of words) {
      position = Math.min(position + 1, POSITION_MAX);
      const list = positions.get(word) ?? [];
      if (list.length < POSITIONS_PER_WORD && list.at(-1) !== position) list.push(position);
      positions.set(word, list);
    }
    // A gap, so a phrase never runs from one part into the next.
    position += 1;
  }
  return [...positions].map(([word, list]) => `${lexeme(word)}:${list.join(',')}`).join(' ');
}

export interface SearchQuery {
  /** Match whole words or their starts ("sched" finds "schedule"). */
  terms: string[];
  /** "Exact phrases": these whole words, in this order. */
  phrases: string[][];
}

/** The search box: words, and "quoted phrases" (an unclosed quote counts as words). */
export function parseSearchQuery(raw: string): SearchQuery {
  const parts = raw.slice(0, SEARCH_QUERY_MAX_LENGTH).split(QUOTE);
  const terms = new Set<string>();
  const phrases: string[][] = [];
  let budget = SEARCH_MAX_WORDS;
  parts.forEach((part, index) => {
    const words = searchWords(part)
      .map((found) => found.word)
      .slice(0, budget);
    budget -= words.length;
    const quoted = index % 2 === 1 && index < parts.length - 1;
    if (quoted && words.length > 0) phrases.push(words);
    else for (const word of words) terms.add(word);
  });
  return { terms: [...terms], phrases };
}

/** The query for Postgres (`search @@ $1::tsquery`), or null when there are no words to match. */
export function toTsQuery(query: SearchQuery): string | null {
  const parts = [
    ...query.terms.map((term) => `${lexeme(term)}:*`),
    ...query.phrases.map((words) =>
      words.length > 1 ? `(${words.map(lexeme).join(' <-> ')})` : words.map(lexeme).join(''),
    ),
  ];
  return parts.length > 0 ? parts.join(' & ') : null;
}

function phraseStarts(words: readonly SearchWord[], phrase: readonly string[]): number[] {
  const starts: number[] = [];
  for (let i = 0; i + phrase.length <= words.length; i += 1) {
    if (phrase.every((word, j) => words[i + j]?.word === word)) starts.push(i);
  }
  return starts;
}

/** Matching in the browser, such as chats by name or member: every word and phrase must be found. */
export function matchesSearch(fields: string | readonly string[], query: SearchQuery): boolean {
  const lists = (typeof fields === 'string' ? [fields] : fields).map((field) => searchWords(field));
  const hasTerm = (term: string) =>
    lists.some((words) => words.some((found) => found.word.startsWith(term)));
  const hasPhrase = (phrase: string[]) =>
    lists.some((words) => phraseStarts(words, phrase).length > 0);
  return query.terms.every(hasTerm) && query.phrases.every(hasPhrase);
}

export type TextRange = [start: number, end: number];

/** What to highlight in a result: matching words, and each phrase as one stretch; sorted, merged. */
export function highlightRanges(text: string, query: SearchQuery): TextRange[] {
  const words = searchWords(text);
  const ranges: TextRange[] = words
    .filter((found) => query.terms.some((term) => found.word.startsWith(term)))
    .map((found) => [found.start, found.end]);
  for (const phrase of query.phrases) {
    for (const i of phraseStarts(words, phrase)) {
      const first = words[i];
      const last = words[i + phrase.length - 1];
      if (first && last) ranges.push([first.start, last.end]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: TextRange[] = [];
  for (const [start, end] of ranges) {
    const previous = merged.at(-1);
    if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

/** Splits text at highlight ranges, for rendering as text (never HTML). */
export function highlightSegments(
  text: string,
  ranges: readonly TextRange[],
): { text: string; match: boolean }[] {
  const segments: { text: string; match: boolean }[] = [];
  let at = 0;
  for (const [start, end] of ranges) {
    if (start > at) segments.push({ text: text.slice(at, start), match: false });
    if (end > Math.max(start, at))
      segments.push({ text: text.slice(Math.max(start, at), end), match: true });
    at = Math.max(at, end);
  }
  if (at < text.length) segments.push({ text: text.slice(at), match: false });
  return segments;
}

/** The Has filter. A file is anything that isn't a picture; a link is a web link that isn't a page card. */
export const HAS_FILTERS = ['picture', 'file', 'link', 'pageCard'] as const;
export type HasFilter = (typeof HAS_FILTERS)[number];

/** What a message has, for the Has filter (store it with the message). */
export function messageHas(message: {
  text: string;
  attachmentKinds: readonly AttachmentKind[];
  pageCount: number;
  matchPageLink?: PageLinkMatcher;
}): HasFilter[] {
  const has: HasFilter[] = [];
  if (message.attachmentKinds.includes('picture')) has.push('picture');
  if (message.attachmentKinds.some((kind) => kind !== 'picture')) has.push('file');
  if (findLinks(message.text).some((link) => !message.matchPageLink?.(link.url))) has.push('link');
  if (message.pageCount > 0) has.push('pageCard');
  return has;
}

function parseCivilDate(date: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(date);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const value = new Date(0);
  value.setUTCFullYear(year, month - 1, day);
  const same =
    value.getUTCFullYear() === year &&
    value.getUTCMonth() === month - 1 &&
    value.getUTCDate() === day;
  return same ? value : null;
}

function nextDay(date: string): string {
  const value = parseCivilDate(date) ?? new Date(0);
  value.setUTCDate(value.getUTCDate() + 1);
  const pad = (n: number, width: number) => String(n).padStart(width, '0');
  return `${pad(value.getUTCFullYear(), 4)}-${pad(value.getUTCMonth() + 1, 2)}-${pad(value.getUTCDate(), 2)}`;
}

const civilDate = z
  .string()
  .refine((date) => parseCivilDate(date) !== null, 'Use a YYYY-MM-DD date');

/** The Date filter, in the searcher's own days (YYYY-MM-DD). "between" includes both days. */
export const dateFilterSchema = z
  .discriminatedUnion('op', [
    z.object({ op: z.literal('on'), date: civilDate }),
    z.object({ op: z.literal('before'), date: civilDate }),
    z.object({ op: z.literal('after'), date: civilDate }),
    z.object({ op: z.literal('between'), from: civilDate, to: civilDate }),
  ])
  .refine((filter) => filter.op !== 'between' || filter.from <= filter.to, {
    message: 'The first day is after the last day',
  });
export type DateFilter = z.infer<typeof dateFilterSchema>;

/** Whether a message sent on this day (in the searcher's time zone) passes the filter. */
export function matchesDateFilter(date: string, filter: DateFilter): boolean {
  switch (filter.op) {
    case 'on':
      return date === filter.date;
    case 'before':
      return date < filter.date;
    case 'after':
      return date > filter.date;
    case 'between':
      return filter.from <= date && date <= filter.to;
  }
}

/** The filter as days: from `start` (included) to `end` (left out); null means open-ended. */
export function dateFilterRange(filter: DateFilter): { start: string | null; end: string | null } {
  switch (filter.op) {
    case 'on':
      return { start: filter.date, end: nextDay(filter.date) };
    case 'before':
      return { start: null, end: filter.date };
    case 'after':
      return { start: nextDay(filter.date), end: null };
    case 'between':
      return { start: filter.from, end: nextDay(filter.to) };
  }
}

/** Body of a message search. Results come newest first, only from chats the person is in now. */
export const messageSearchBodySchema = z.object({
  q: z.string().max(1000).default(''),
  fromUserId: idSchema.optional(),
  chatId: idSchema.optional(),
  date: dateFilterSchema.optional(),
  has: z.enum(HAS_FILTERS).optional(),
});
export type MessageSearchBody = z.infer<typeof messageSearchBodySchema>;
