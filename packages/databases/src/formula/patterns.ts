/**
 * The pattern engine behind test, match, replace and replaceAll (security #13). Typed patterns
 * never reach JavaScript RegExp: they run on re2js, a port of RE2, which reads a text once from
 * left to right whatever the pattern (no backtracking, so (a+)+$ is as quick as a+$). Patterns are
 * JavaScript regular expressions without slashes (\u00e9 and (?<name>…) work); lookarounds and
 * backreferences can't be matched that way and are refused.
 *
 * Limits: patterns up to MAX_PATTERN_LENGTH characters; counted repeats nested to at most
 * MAX_PATTERN_COPIES copies, checked before compiling, so ((a{100}){100}){100} never reaches the
 * compiler; compiled programs up to MAX_PATTERN_PROGRAM instructions; only the first
 * PATTERN_TEXT_LENGTH characters of a text are read (replace keeps the rest as it is). Each
 * pattern is checked and compiled once and kept in a small cache, refusals included. match stops
 * past its most matches and replace past its longest text while they're being made, and the row's
 * time is checked after compiling and after every match.
 */
import { RE2JS } from 're2js';
import { LIMITS } from '../types';
import {
  MAX_TEXT_LENGTH,
  TOO_COMPLEX,
  TOO_MUCH_TEXT,
  type PatternEngine,
  type PatternLimits,
  type PatternResult,
} from './registry';

/** Longest pattern, in characters. */
export const MAX_PATTERN_LENGTH = 200;
/** Characters of a text that patterns read; replace keeps the rest as it is. */
export const PATTERN_TEXT_LENGTH = 10_000;
/** Copies that counted repeats nested inside each other may make: (a{10}){100} makes 1,000. */
export const MAX_PATTERN_COPIES = 1_000;
/** Instructions a compiled pattern may have. */
export const MAX_PATTERN_PROGRAM = 2_000;
/** Patterns an engine keeps compiled; the least recently used goes first. */
export const PATTERN_CACHE_SIZE = 128;

/** What patterns that can't run, or run too long, say. Only "⚠ Pattern too slow" is the spec's. */
export const PATTERN_MESSAGES = {
  tooLong: `Patterns can be up to ${MAX_PATTERN_LENGTH} characters.`,
  tooComplex: 'This pattern is too complex.',
  unsupported: "Patterns can't look ahead, look behind or refer back to a group.",
  invalid: "This pattern isn't valid.",
  tooSlow: '⚠ Pattern too slow',
} as const;

/** RE2's reasons, said plainly: "This pattern isn't valid: a '(' has no ')'." */
const REASONS: Readonly<Record<string, string>> = {
  'missing closing )': "a '(' has no ')'",
  'unexpected )': "a ')' has no '('",
  'missing closing ]': "a '[' has no ']'",
  'missing argument to repetition operator': 'a repeat has nothing before it',
  'invalid nested repetition operator': 'two repeats follow each other',
  'trailing backslash at end of expression': 'it ends with a lone \\',
  'invalid escape sequence': 'it has an unknown \\ escape',
  'invalid character class range': 'a [ ] range or class is not valid',
  'invalid repeat count': 'a repeat count is backwards',
  'invalid named capture': 'a group name is not valid',
  'duplicate capture group name': 'two groups have the same name',
  'invalid or unsupported Perl syntax': 'it has an unknown (? group',
};

/** An engine with its cache, as PATTERNS is. */
export interface CachedPatternEngine extends PatternEngine {
  /** The problem with a pattern (too long, not valid, too complex), or null when it can run. */
  check(pattern: string): string | null;
  /** How many times this engine has called the compiler; a cached pattern isn't compiled again. */
  readonly compiled: number;
}

interface Compiled {
  re: RE2JS;
  groups: number;
  names: Readonly<Record<string, number>>;
}
type Entry = Compiled | { error: string };

const SLOW: PatternResult<never> = { ok: false, error: PATTERN_MESSAGES.tooSlow };
const failed = (error: string): PatternResult<never> => ({ ok: false, error });

/** An engine with its own cache of up to `cacheSize` patterns. */
export function createPatternEngine(cacheSize: number = PATTERN_CACHE_SIZE): CachedPatternEngine {
  const cache = new Map<string, Entry>();
  let compiled = 0;
  const compile = (source: string): RE2JS => {
    compiled++;
    return RE2JS.compile(source);
  };
  const entry = (pattern: string): Entry => {
    const known = cache.get(pattern);
    if (known) cache.delete(pattern);
    const e = known ?? prepare(pattern, compile);
    cache.set(pattern, e);
    if (cache.size > Math.max(1, cacheSize)) {
      const oldest = cache.keys().next();
      if (!oldest.done) cache.delete(oldest.value);
    }
    return e;
  };
  /** The compiled pattern, or why it can't run (including the row's time being up). */
  const ready = (pattern: string, limits?: PatternLimits): Compiled | PatternResult<never> => {
    const e = entry(pattern);
    if ('error' in e) return failed(e.error);
    return limits?.overTime?.() ? SLOW : e;
  };
  return {
    get compiled() {
      return compiled;
    },
    check(pattern) {
      const e = entry(pattern);
      return 'error' in e ? e.error : null;
    },
    test(text, pattern, limits) {
      const c = ready(pattern, limits);
      if (!('re' in c)) return c;
      const found = c.re.matcher(text.slice(0, readLength(text))).find();
      return limits?.overTime?.() ? SLOW : { ok: true, value: found };
    },
    match(text, pattern, limits) {
      const c = ready(pattern, limits);
      if (!('re' in c)) return c;
      const head = text.slice(0, readLength(text));
      const m = c.re.matcher(head);
      const most = limits?.maxMatches ?? LIMITS.formulaListItems;
      const found: string[] = [];
      while (m.find()) {
        if (found.length >= most) return failed(TOO_COMPLEX);
        found.push(head.slice(m.start(), m.end()));
        if (limits?.overTime?.()) return SLOW;
      }
      return { ok: true, value: found };
    },
    replace(text, pattern, replacement, all, limits) {
      const c = ready(pattern, limits);
      if (!('re' in c)) return c;
      const cut = readLength(text);
      const head = text.slice(0, cut);
      const m = c.re.matcher(head);
      const pieces = parseReplacement(replacement, c);
      const out = new Output(limits?.maxLength ?? MAX_TEXT_LENGTH);
      let pos = 0;
      while (m.find()) {
        const start = m.start();
        const end = m.end();
        if (!out.add(head.slice(pos, start))) return failed(TOO_MUCH_TEXT);
        for (const p of pieces) {
          const s =
            typeof p === 'string'
              ? p
              : p === BEFORE
                ? text.slice(0, start)
                : p === AFTER
                  ? text.slice(end)
                  : (m.group(p) ?? '');
          if (!out.add(s)) return failed(TOO_MUCH_TEXT);
        }
        pos = end;
        if (limits?.overTime?.()) return SLOW;
        if (!all) break;
      }
      if (!out.add(head.slice(pos)) || !out.add(text.slice(cut))) return failed(TOO_MUCH_TEXT);
      return { ok: true, value: out.text() };
    },
  };
}

/** The shared engine the pattern functions use unless a context brings its own. */
export const PATTERNS: CachedPatternEngine = createPatternEngine();

/** How much of a text patterns read: PATTERN_TEXT_LENGTH characters, without splitting a pair. */
function readLength(text: string): number {
  if (text.length <= PATTERN_TEXT_LENGTH) return text.length;
  const last = text.charCodeAt(PATTERN_TEXT_LENGTH - 1);
  return last >= 0xd800 && last <= 0xdbff ? PATTERN_TEXT_LENGTH - 1 : PATTERN_TEXT_LENGTH;
}

/** Text built piece by piece that refuses to grow past its limit. */
class Output {
  private readonly parts: string[] = [];
  private length = 0;
  private readonly max: number;
  constructor(max: number) {
    this.max = max;
  }
  /** Adds a piece; false (and nothing added) when it would pass the limit. */
  add(s: string): boolean {
    if (this.length + s.length > this.max) return false;
    this.length += s.length;
    if (s) this.parts.push(s);
    return true;
  }
  text(): string {
    return this.parts.join('');
  }
}

/** Checks a pattern and compiles it, or says why it can't run. */
function prepare(pattern: string, compile: (source: string) => RE2JS): Entry {
  if (pattern.length > MAX_PATTERN_LENGTH) return { error: PATTERN_MESSAGES.tooLong };
  let source: string;
  try {
    source = RE2JS.translateRegExp(pattern);
  } catch {
    return { error: PATTERN_MESSAGES.invalid };
  }
  const shape = scan(source);
  if (shape.unsupported) return { error: PATTERN_MESSAGES.unsupported };
  if (shape.copies > MAX_PATTERN_COPIES) return { error: PATTERN_MESSAGES.tooComplex };
  let re: RE2JS;
  try {
    re = compile(source);
  } catch (e) {
    return { error: compileProblem(e) };
  }
  if (re.programSize() > MAX_PATTERN_PROGRAM) return { error: PATTERN_MESSAGES.tooComplex };
  return { re, groups: re.groupCount(), names: re.namedGroups() };
}

/** The message for a pattern RE2 can't compile. */
function compileProblem(e: unknown): string {
  const reason = e instanceof Error && 'error' in e ? String(e.error) : '';
  const part = e instanceof Error && 'input' in e ? String(e.input ?? '') : '';
  if (reason === 'invalid escape sequence' && /^\\[1-9]/.test(part)) {
    return PATTERN_MESSAGES.unsupported;
  }
  if (reason === 'expression nests too deeply' || reason === 'expression too large') {
    return PATTERN_MESSAGES.tooComplex;
  }
  const why = REASONS[reason];
  return why ? `This pattern isn't valid: ${why}.` : PATTERN_MESSAGES.invalid;
}

/**
 * What a pattern holds, read before compiling: the most copies its nested counted repeats make
 * (x{3} is 3 copies of x, x{2,5} 5, x{2,} 3; so (a{10}){100} is 1,000), and whether it has a
 * lookaround, which RE2 can't run.
 */
function scan(p: string): { copies: number; unsupported: boolean } {
  const groups: number[] = [1];
  let last = 0;
  let unsupported = false;
  const atom = (copies: number) => {
    last = Math.min(copies, 1e9);
    const top = groups.length - 1;
    groups[top] = Math.max(groups[top] ?? 1, last);
  };
  let i = 0;
  while (i < p.length) {
    const c = p[i];
    if (c === '\\') {
      i = skipEscape(p, i);
      atom(1);
    } else if (c === '[') {
      i = skipClass(p, i);
      atom(1);
    } else if (c === '(') {
      if (/^\(\?(?:[=!]|<[=!])/.test(p.slice(i, i + 4))) unsupported = true;
      groups.push(1);
      last = 0;
      i++;
    } else if (c === ')') {
      const inner = groups.length > 1 ? (groups.pop() ?? 1) : 1;
      atom(inner);
      i++;
    } else if (c === '{') {
      const m = /^\{(\d+)(,(\d*))?\}/.exec(p.slice(i));
      if (m && last > 0) {
        const n = Number(m[1]);
        const most = m[2] === undefined ? n : m[3] ? Number(m[3]) : n + 1;
        atom(last * Math.max(1, n, most));
        i += m[0].length;
      } else {
        atom(1);
        i++;
      }
    } else if (c === '|') {
      last = 0;
      i++;
    } else {
      if (c !== '*' && c !== '+' && c !== '?') atom(1);
      i++;
    }
  }
  return { copies: Math.max(...groups), unsupported };
}

/** Past an escape: \Q…\E, \p{…}, \P{…}, \x{…}, or a backslash and one character. */
function skipEscape(p: string, i: number): number {
  const next = p[i + 1];
  if (next === 'Q') {
    const end = p.indexOf('\\E', i + 2);
    return end < 0 ? p.length : end + 2;
  }
  if ((next === 'p' || next === 'P' || next === 'x') && p[i + 2] === '{') {
    const end = p.indexOf('}', i + 3);
    return end < 0 ? p.length : end + 1;
  }
  return i + 2;
}

/** Past a [ ] class: a ] right after [ or [^ is a character, and [:alpha:] is a class name. */
function skipClass(p: string, i: number): number {
  let j = i + 1;
  if (p[j] === '^') j++;
  if (p[j] === ']') j++;
  while (j < p.length && p[j] !== ']') {
    if (p[j] === '\\') j += 2;
    else if (p[j] === '[' && p[j + 1] === ':') {
      const end = p.indexOf(':]', j + 2);
      j = end < 0 ? j + 1 : end + 2;
    } else j++;
  }
  return j + 1;
}

const BEFORE = Symbol('before');
const AFTER = Symbol('after');
/** A piece of a replacement: text, a group (number or name), or the text before or after the match. */
type Piece = string | number | typeof BEFORE | typeof AFTER;

/**
 * A replacement as JavaScript reads one: $$ is $, $& the match, $` and $' the text before and
 * after it, $1 to $99 a group and $<name> a named group (empty when it didn't take part).
 */
function parseReplacement(r: string, c: Compiled): Piece[] {
  if (!r.includes('$')) return r ? [r] : [];
  const pieces: Piece[] = [];
  let text = '';
  const push = (p: Piece) => {
    if (text) pieces.push(text);
    text = '';
    pieces.push(p);
  };
  let i = 0;
  while (i < r.length) {
    const ch = r[i] ?? '';
    const next = r[i + 1] ?? '';
    if (ch !== '$' || !next) {
      text += ch;
      i++;
    } else if (next === '$') {
      text += '$';
      i += 2;
    } else if (next === '&') {
      push(0);
      i += 2;
    } else if (next === '`') {
      push(BEFORE);
      i += 2;
    } else if (next === "'") {
      push(AFTER);
      i += 2;
    } else if (next >= '0' && next <= '9') {
      const two = Number(r.slice(i + 1, i + 3));
      const one = Number(next);
      if (/^\d\d$/.test(r.slice(i + 1, i + 3)) && two >= 1 && two <= c.groups) {
        push(two);
        i += 3;
      } else if (one >= 1 && one <= c.groups) {
        push(one);
        i += 2;
      } else {
        text += '$';
        i++;
      }
    } else if (next === '<' && Object.keys(c.names).length) {
      const close = r.indexOf('>', i + 2);
      if (close < 0) {
        text += '$';
        i++;
      } else {
        const group = c.names[r.slice(i + 2, close)];
        if (group !== undefined) push(group);
        i = close + 1;
      }
    } else {
      text += '$';
      i++;
    }
  }
  if (text) pieces.push(text);
  return pieces;
}
