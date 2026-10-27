/**
 * Reads formula text into tokens: numbers, texts, names and operators, each with its place.
 * Spaces and comments are skipped. Mistakes say which line they're on.
 */
import type { FormulaError } from './registry';

/** What a token is. */
export type TokenKind = 'number' | 'text' | 'name' | 'op' | 'end';

/** One piece of a formula; start is inclusive and end exclusive. */
export interface Token {
  kind: TokenKind;
  /** The digits as typed, the text with its escapes worked out, the name, or the operator. */
  value: string;
  start: number;
  end: number;
}

/** A mistake in how the formula is written, with where it is. */
export class FormulaSyntaxError extends Error {
  readonly error: FormulaError;
  constructor(error: FormulaError) {
    super(error.message);
    this.error = error;
  }
}

/** The line (from 1) a position is on. */
export function lineAt(source: string, pos: number): number {
  let line = 1;
  for (let i = 0; i < pos && i < source.length; i++) if (source.charCodeAt(i) === 10) line++;
  return line;
}

/** Stops reading with "<what> at line N", plus an optional hint sentence. */
export function syntaxError(
  source: string,
  what: string,
  start: number,
  end: number,
  hint?: string,
): never {
  const message = `${what} at line ${lineAt(source, start)}${hint ? `. ${hint}` : ''}`;
  throw new FormulaSyntaxError({ message, start, end });
}

const TWO = new Set(['>=', '<=', '==', '!=', '&&', '||']);
const ONE = new Set('()[],.+-*/%^><!?:');
const ESCAPES = new Map([
  ['"', '"'],
  ['\\', '\\'],
  ['n', '\n'],
]);
const SPACE = /\s/;
const NAME_START = /[\p{L}_]/u;
const NAME_PART = /[\p{L}\p{N}_]/u;

const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9';

/** The tokens of a formula, ending with an "end" token. */
export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const n = source.length;
  let i = 0;
  while (i < n) {
    const c = source[i] ?? '';
    if (SPACE.test(c)) {
      i++;
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      const close = source.indexOf('*/', i + 2);
      if (close < 0) syntaxError(source, "Missing '*/'", i, n);
      i = close + 2;
      continue;
    }
    const start = i;
    if (isDigit(c)) {
      while (isDigit(source[i])) i++;
      if (source[i] === '.' && isDigit(source[i + 1])) {
        i++;
        while (isDigit(source[i])) i++;
      }
      if (source[i] === 'e' || source[i] === 'E') {
        let j = i + 1;
        if (source[j] === '+' || source[j] === '-') j++;
        if (isDigit(source[j])) {
          i = j;
          while (isDigit(source[i])) i++;
        }
      }
      tokens.push({ kind: 'number', value: source.slice(start, i), start, end: i });
      continue;
    }
    if (c === '"') {
      i = readText(source, i, tokens);
      continue;
    }
    if (NAME_START.test(c)) {
      while (i < n && NAME_PART.test(source[i] ?? '')) i++;
      tokens.push({ kind: 'name', value: source.slice(start, i), start, end: i });
      continue;
    }
    const two = source.slice(i, i + 2);
    if (TWO.has(two)) {
      tokens.push({ kind: 'op', value: two, start, end: i + 2 });
      i += 2;
      continue;
    }
    if (ONE.has(c)) {
      tokens.push({ kind: 'op', value: c, start, end: i + 1 });
      i++;
      continue;
    }
    if (c === '=') syntaxError(source, "Unexpected '='", i, i + 1, 'Use == to compare.');
    const ch = String.fromCodePoint(source.codePointAt(i) ?? 0);
    syntaxError(source, `Unexpected '${ch}'`, i, i + ch.length);
  }
  tokens.push({ kind: 'end', value: '', start: n, end: n });
  return tokens;
}

/** Reads a "text" starting at the quote; \" \\ and \n are escapes, other backslashes stay. */
function readText(source: string, from: number, tokens: Token[]): number {
  let value = '';
  let i = from + 1;
  for (;;) {
    if (i >= source.length) syntaxError(source, `Missing '"'`, from, source.length);
    const ch = source[i] ?? '';
    if (ch === '"') break;
    if (ch === '\\' && i + 1 < source.length) {
      const next = source[i + 1] ?? '';
      value += ESCAPES.get(next) ?? `\\${next}`;
      i += 2;
      continue;
    }
    value += ch;
    i++;
  }
  tokens.push({ kind: 'text', value, start: from, end: i + 1 });
  return i + 1;
}
