// What people type in the search box, as terms the server turns into a Postgres full-text query
// (spec 3.2): all words must match unless OR is used, "quotes" match a phrase, -word excludes a
// word (a hyphen inside a word, as in QA-17, doesn't), and the last word also matches as a
// beginning while typing.
import { fold, titleKey } from './fold';

/** The longest search text, in characters. */
export const SEARCH_TEXT_MAX = 200;

export interface SearchTerm {
  /** Folded text: one word, or the words of a "phrase". */
  text: string;
  phrase: boolean;
  /** The last word typed: it also matches words that start with it. */
  prefix: boolean;
}

/** A word to highlight, folded. */
export interface MatchWord {
  word: string;
  prefix: boolean;
}

export interface ParsedQuery {
  /** Every group must match; a group matches when any of its terms does (OR). */
  all: SearchTerm[][];
  /** No result may match any of these. */
  none: SearchTerm[];
  /** The words in order, for exact and "starts with" title matches; null with OR. */
  key: string | null;
  /** Words to highlight in titles and snippets. */
  words: MatchWord[];
}

const SPACE = /\s/;
const WORD = /[\p{L}\p{N}]+/gu;

/** The letter and digit runs of folded text: "qa-17" gives ["qa", "17"]. */
export function wordsOf(text: string): string[] {
  return Array.from(text.matchAll(WORD), (match) => match[0]);
}

interface Token {
  text: string;
  quoted: boolean;
  negate: boolean;
}

function tokenize(source: string): (Token | 'OR')[] {
  const tokens: (Token | 'OR')[] = [];
  let at = 0;
  while (at < source.length) {
    if (SPACE.test(source[at] ?? '')) {
      at += 1;
      continue;
    }
    let negate = false;
    if (source[at] === '-' && at + 1 < source.length && !SPACE.test(source[at + 1] ?? '')) {
      negate = true;
      at += 1;
    }
    if (source[at] === '"') {
      const close = source.indexOf('"', at + 1);
      const end = close === -1 ? source.length : close;
      tokens.push({ text: source.slice(at + 1, end), quoted: true, negate });
      at = end + 1;
      continue;
    }
    let end = at;
    while (end < source.length && !SPACE.test(source[end] ?? '') && source[end] !== '"') end += 1;
    const text = source.slice(at, end);
    at = end;
    if (!negate && text === 'OR') tokens.push('OR');
    else tokens.push({ text, quoted: false, negate });
  }
  return tokens;
}

export interface ParseOptions {
  /** Whether the last word also matches as a beginning while typing (default true). */
  prefix?: boolean;
}

export function parseQuery(
  input: string,
  { prefix: whileTyping = true }: ParseOptions = {},
): ParsedQuery {
  const source = input.slice(0, SEARCH_TEXT_MAX);
  const typing = whileTyping && source.length > 0 && !SPACE.test(source[source.length - 1] ?? '');
  const tokens = tokenize(source);
  const lastWord = tokens.findLastIndex((token) => token !== 'OR');

  const all: SearchTerm[][] = [];
  const none: SearchTerm[] = [];
  const words: MatchWord[] = [];
  let usedOr = false;
  let joinNext = false;
  tokens.forEach((token, index) => {
    if (token === 'OR') {
      joinNext = all.length > 0;
      return;
    }
    const text = fold(token.text).trim();
    const parts = wordsOf(text);
    if (parts.length === 0) return;
    const prefix = typing && index === lastWord && !token.quoted && !token.negate;
    // Postgres reads the words of a term itself, as it did for the index ("qa-17" as "qa", "-17").
    const term: SearchTerm = { text, phrase: token.quoted, prefix };
    if (token.negate) {
      none.push(term);
      return;
    }
    parts.forEach((word, at) => words.push({ word, prefix: prefix && at === parts.length - 1 }));
    const group = joinNext ? all[all.length - 1] : undefined;
    if (group) {
      group.push(term);
      usedOr = true;
    } else all.push([term]);
    joinNext = false;
  });
  const key = usedOr ? null : titleKey(all.map((group) => group[0]?.text ?? '').join(' '));
  return { all, none, key: key || null, words };
}
