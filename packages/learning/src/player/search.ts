import type { Block, Id, Link, Question } from '../format/index';
import type { PlayerCourse } from './course';
import { imageWords, plainOf } from './text';

/** Queries with fewer letters than this (spaces and edge punctuation aside) find nothing. */
export const COURSE_SEARCH_MIN_LENGTH = 2;

const DEFAULT_LIMIT = 50;
const SNIPPET_BEFORE = 40;
const SNIPPET_LENGTH = 120;

/** Part of a search snippet; the `match` parts are the searched words, for highlighting. */
export type SearchSnippetPart = { text: string; match: boolean };

/** One place in the course where every searched word appears. */
export type CourseSearchHit = {
  lessonId: Id;
  /** Position of the lesson in the course, counting from 1. */
  lessonNumber: number;
  lessonTitle: string;
  /** The block the words are in; missing when they are in the lesson itself (title, quiz intro, header picture). */
  blockId?: Id;
  /** Where the hit is, ready for the player's go(link). */
  link: Extract<Link, { kind: 'lesson' }>;
  /** A short piece of text around the first match, with "…" where it was cut. */
  snippet: SearchSnippetPart[];
  /** How many times the searched words appear in this place. */
  matches: number;
};

/** Hits in course order. `total` counts every hit, also those past the limit. */
export type CourseSearchResult = { hits: CourseSearchHit[]; total: number; tooShort: boolean };

type SearchField = { text: string; folded: string };
type SearchTarget = {
  lessonId: Id;
  lessonNumber: number;
  lessonTitle: string;
  blockId?: Id;
  fields: SearchField[];
};

/** A course prepared for searching. Build it once per course (for example with useMemo) and search it often. */
export type CourseSearchIndex = { readonly targets: readonly SearchTarget[] };

// ---------- Folding: lower case without accents, mapped back to the original text ----------

function foldChar(char: string): string {
  const code = char.charCodeAt(0);
  if (code < 0x80) return code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : char;
  return char.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
}

function fold(text: string): string {
  let folded = '';
  for (const char of text) folded += foldChar(char);
  return folded;
}

/** The folded text, with the range in `text` that each folded character came from. */
function foldMapped(text: string): { folded: string; from: number[]; to: number[] } {
  let folded = '';
  const from: number[] = [];
  const to: number[] = [];
  let index = 0;
  for (const char of text) {
    const end = index + char.length;
    const piece = foldChar(char);
    if (piece === '' && to.length > 0) to[to.length - 1] = end; // a separate accent mark joins the letter before it
    for (let i = 0; i < piece.length; i += 1) {
      from.push(index);
      to.push(end);
    }
    folded += piece;
    index = end;
  }
  return { folded, from, to };
}

const tidy = (text: string) => text.replace(/\s+/gu, ' ').trim();

/** The query's words, folded, without punctuation at their edges and without repeats. */
function queryWords(query: string): string[] {
  const words = fold(query)
    .split(/\s+/u)
    .map((word) => word.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, ''))
    .filter((word) => word !== '');
  return [...new Set(words)];
}

function occurrences(haystack: string, needle: string): number[] {
  const found: number[] = [];
  for (
    let at = haystack.indexOf(needle);
    at !== -1;
    at = haystack.indexOf(needle, at + needle.length)
  )
    found.push(at);
  return found;
}

// ---------- What a learner can read ----------
// Answers, feedback, coaching and scenario scenes are left out, so search never gives away a question or a
// scenario. Quiz lessons are searched by title and intro only.

function questionWords(question: Question): string[] {
  const words = [plainOf(question.prompt), ...imageWords(question.image)];
  switch (question.type) {
    case 'single_choice':
    case 'multiple_choice':
      return [...words, ...question.options.map((option) => option.text)];
    case 'true_false':
      return words;
    case 'matching':
    case 'drag_matching':
      return [...words, ...question.pairs.flatMap((pair) => [pair.prompt, pair.match])];
    case 'fill_blank':
      return [
        ...words,
        ...question.parts.flatMap((part) => (part.kind === 'text' ? [part.text] : [])),
      ];
    case 'ordering':
      return [...words, ...question.items.map((item) => item.text)];
    case 'hotspot':
      return [...words, ...question.spots.map((spot) => spot.label)];
  }
}

function blockWords(block: Block): string[] {
  switch (block.type) {
    case 'heading':
    case 'statement':
      return [block.text];
    case 'paragraph':
      return [plainOf(block.text)];
    case 'list':
      return block.items.map((item) => plainOf(item.text));
    case 'callout':
      return [block.title ?? '', plainOf(block.text)];
    case 'quote':
      return [block.text, block.attribution ?? '', ...imageWords(block.background)];
    case 'quote_carousel':
      return block.quotes.flatMap((quote) => [quote.text, quote.attribution ?? '']);
    case 'two_column':
      return [plainOf(block.left), plainOf(block.right)];
    case 'divider':
    case 'continue':
      return [];
    case 'code':
      return [block.code];
    case 'table':
      return block.rows.flat();
    case 'image':
      return [...imageWords(block.image), plainOf(block.text)];
    case 'gallery':
      return block.images.flatMap(imageWords);
    case 'labeled_graphic':
      return [
        ...imageWords(block.image),
        ...block.markers.flatMap((marker) => [marker.title, plainOf(marker.text)]),
      ];
    case 'video':
    case 'audio':
      return [block.title, plainOf(block.transcript)];
    case 'file':
      return [block.name, block.description ?? ''];
    case 'embed':
      return [block.title];
    case 'accordion':
      return block.items.flatMap((item) => [item.title, plainOf(item.body)]);
    case 'tabs':
      return block.tabs.flatMap((tab) => [tab.title, plainOf(tab.body)]);
    case 'timeline':
      return block.items.flatMap((item) => [item.label, item.title, plainOf(item.body)]);
    case 'process':
      return [
        block.intro?.title ?? '',
        plainOf(block.intro?.body),
        ...block.steps.flatMap((step) => [
          step.title,
          plainOf(step.body),
          ...imageWords(step.image),
        ]),
        block.summary?.title ?? '',
        plainOf(block.summary?.body),
      ];
    case 'flashcards':
      return block.cards.flatMap((card) => [
        card.front,
        ...imageWords(card.frontImage),
        card.back,
        ...imageWords(card.backImage),
      ]);
    case 'sorting':
      return [
        ...block.categories.map((category) => category.title),
        ...block.items.map((item) => item.text),
      ];
    case 'button':
      return [block.label, block.description ?? ''];
    case 'knowledge_check':
      return questionWords(block.question);
    case 'scenario':
      return [
        block.title,
        plainOf(block.intro),
        ...block.characters.flatMap((person) => [person.name, person.role ?? '']),
      ];
  }
}

// ---------- Index and search ----------

/** Collects the text a learner can see in every lesson and block, ready for `searchCourseIndex`. */
export function buildCourseSearchIndex(course: Pick<PlayerCourse, 'lessons'>): CourseSearchIndex {
  const targets: SearchTarget[] = [];
  const add = (target: Omit<SearchTarget, 'fields'>, texts: readonly string[]) => {
    const fields = texts
      .map(tidy)
      .filter((text) => text !== '')
      .map((text) => ({ text, folded: fold(text) }));
    if (fields.length > 0) targets.push({ ...target, fields });
  };
  course.lessons.forEach((lesson, index) => {
    const where = { lessonId: lesson.id, lessonNumber: index + 1, lessonTitle: lesson.title };
    if (lesson.kind === 'quiz') {
      add(where, [lesson.title, plainOf(lesson.intro)]);
      return;
    }
    add(where, [lesson.title, ...imageWords(lesson.headerImage)]);
    for (const block of lesson.blocks) add({ ...where, blockId: block.id }, blockWords(block));
  });
  return { targets };
}

/** Cuts a snippet around the first match in `text` and marks every match inside it. */
function snippetOf(text: string, words: readonly string[]): SearchSnippetPart[] {
  const { folded, from, to } = foldMapped(text);
  const ranges: [number, number][] = [];
  for (const word of words) {
    for (const at of occurrences(folded, word))
      ranges.push([from[at] ?? 0, to[at + word.length - 1] ?? text.length]);
  }
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: [number, number][] = [];
  for (const [start, end] of ranges) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  const [firstStart, firstEnd] = merged[0] ?? [0, 0];
  let start = Math.max(0, firstStart - SNIPPET_BEFORE);
  let end = Math.min(text.length, Math.max(firstEnd, start + SNIPPET_LENGTH));
  if (start > 0 && text[start - 1] !== ' ') {
    const space = text.indexOf(' ', start);
    if (space !== -1 && space < firstStart) start = space + 1;
  }
  if (end < text.length && text[end] !== ' ') {
    const space = text.lastIndexOf(' ', end - 1);
    if (space >= firstEnd) end = space;
  }
  const isLowSurrogate = (at: number) => /[\uDC00-\uDFFF]/.test(text[at] ?? '');
  if (isLowSurrogate(start)) start -= 1;
  if (isLowSurrogate(end)) end += 1;

  const parts: SearchSnippetPart[] = [];
  const push = (piece: string, match: boolean) => {
    const last = parts[parts.length - 1];
    if (last && last.match === match) last.text += piece;
    else if (piece !== '') parts.push({ text: piece, match });
  };
  if (start > 0) push('…', false);
  let cursor = start;
  for (const [rangeStart, rangeEnd] of merged) {
    if (rangeEnd <= start || rangeStart >= end) continue;
    const matchStart = Math.max(rangeStart, start);
    const matchEnd = Math.min(rangeEnd, end);
    push(text.slice(cursor, matchStart), false);
    push(text.slice(matchStart, matchEnd), true);
    cursor = matchEnd;
  }
  push(text.slice(cursor, end), false);
  if (end < text.length) push('…', false);
  return parts;
}

/**
 * Finds the places in a course where every word of `query` appears, ignoring case and accents ("resume" finds
 * "Résumé"). Each lesson (title, quiz intro, header picture) and each block is one place; hits come in course order
 * with a short snippet. Queries under `COURSE_SEARCH_MIN_LENGTH` letters find nothing and set `tooShort`.
 */
export function searchCourseIndex(
  index: CourseSearchIndex,
  query: string,
  options: { limit?: number } = {},
): CourseSearchResult {
  const words = queryWords(query);
  if (words.join('').length < COURSE_SEARCH_MIN_LENGTH)
    return { hits: [], total: 0, tooShort: true };
  const limit = options.limit ?? DEFAULT_LIMIT;
  const hits: CourseSearchHit[] = [];
  let total = 0;
  for (const target of index.targets) {
    const counts = target.fields.map((field) =>
      words.map((word) => occurrences(field.folded, word).length),
    );
    if (!words.every((_, w) => counts.some((perWord) => (perWord[w] ?? 0) > 0))) continue;
    total += 1;
    if (hits.length >= limit) continue;
    // The snippet comes from the first field with the most of the words.
    let best = 0;
    let bestFound = -1;
    counts.forEach((perWord, f) => {
      const found = perWord.filter((count) => count > 0).length;
      if (found > bestFound) [best, bestFound] = [f, found];
    });
    const { lessonId, lessonNumber, lessonTitle, blockId } = target;
    hits.push({
      lessonId,
      lessonNumber,
      lessonTitle,
      ...(blockId === undefined ? {} : { blockId }),
      link: { kind: 'lesson', lessonId, ...(blockId === undefined ? {} : { blockId }) },
      snippet: snippetOf(target.fields[best]?.text ?? '', words),
      matches: counts.flat().reduce((sum, count) => sum + count, 0),
    });
  }
  return { hits, total, tooShort: false };
}

/** Searches a course once. To search as someone types, build the index once and call `searchCourseIndex`. */
export function searchCourse(
  course: Pick<PlayerCourse, 'lessons'>,
  query: string,
  options: { limit?: number } = {},
): CourseSearchResult {
  return searchCourseIndex(buildCourseSearchIndex(course), query, options);
}
