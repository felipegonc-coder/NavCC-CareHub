// Highlighted titles and snippets (spec 2 and 3.2). Postgres decides what matches; this only finds
// the words to show in bold, with a rough English stem so "refunds" also marks "refund".
import { foldWithMap } from './fold';
import type { MatchWord } from './query';

/** Snippets are up to this many characters around the first match. */
export const SNIPPET_MAX_CHARS = 160;

/** `[start, end)` in the shown text. */
export type TextRange = [start: number, end: number];

export interface Snippet {
  text: string;
  ranges: TextRange[];
}

const SUFFIXES = ['ies', 'ing', 'ed', 'es', 's', 'ly', 'y'];

/** "refunds" → "refund", "policies" → "polic". Words keep at least 3 letters. */
export function roughStem(word: string): string {
  for (const suffix of SUFFIXES) {
    if (word.length - suffix.length >= 3 && word.endsWith(suffix)) {
      return word.slice(0, -suffix.length);
    }
  }
  return word;
}

function matchesWord(textWord: string, query: MatchWord): boolean {
  if (textWord === query.word) return true;
  if (query.prefix && textWord.startsWith(query.word)) return true;
  const stem = roughStem(query.word);
  return textWord.startsWith(stem) && textWord.length <= stem.length + 4;
}

/** The matching words in `text`, as ranges of the original text. */
export function highlightRanges(text: string, words: readonly MatchWord[]): TextRange[] {
  if (words.length === 0 || text.length === 0) return [];
  const folded = foldWithMap(text);
  const ranges: TextRange[] = [];
  for (const match of folded.text.matchAll(/[\p{L}\p{N}]+/gu)) {
    const start = match.index;
    if (!words.some((word) => matchesWord(match[0], word))) continue;
    ranges.push([folded.from[start] ?? 0, folded.from[start + match[0].length] ?? text.length]);
  }
  return ranges;
}

const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/**
 * Up to `maxChars` of the block (one per line) with the most matching words, around its first
 * match, with "…" where it was cut. Null when no block matches.
 */
export function makeSnippet(
  text: string,
  words: readonly MatchWord[],
  maxChars = SNIPPET_MAX_CHARS,
): Snippet | null {
  let best: { block: string; ranges: TextRange[] } | null = null;
  for (const block of text.split('\n')) {
    const ranges = highlightRanges(block, words);
    if (ranges.length > (best?.ranges.length ?? 0)) best = { block, ranges };
  }
  const first = best?.ranges[0];
  if (!best || !first) return null;
  const { block } = best;
  let start = Math.max(0, Math.min(first[0] - Math.floor(maxChars / 4), block.length - maxChars));
  if (start > 0) {
    const space = block.indexOf(' ', start - 1);
    start = space !== -1 && space < first[0] ? space + 1 : start;
    if (isLowSurrogate(block.charCodeAt(start))) start += 1;
  }
  let end = Math.min(block.length, start + maxChars);
  if (end < block.length) {
    const space = block.lastIndexOf(' ', end);
    end = space > first[1] ? space : end;
    if (isLowSurrogate(block.charCodeAt(end))) end -= 1;
  }
  const before = start > 0 ? '…' : '';
  const shift = before.length - start;
  const ranges = best.ranges
    .filter(([from, to]) => from >= start && to <= end)
    .map(([from, to]): TextRange => [from + shift, to + shift]);
  return { text: `${before}${block.slice(start, end)}${end < block.length ? '…' : ''}`, ranges };
}

/** The words of a title or snippet to find again on the web side, for example in tests. */
export function rangeTexts(text: string, ranges: readonly TextRange[]): string[] {
  return ranges.map(([from, to]) => text.slice(from, to));
}
