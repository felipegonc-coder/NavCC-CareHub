import { describe, expect, it } from 'vitest';
import type { ComputedValue } from '../types';
import { CASE_PROPERTIES, CASE_ROW, CASES_SCHEMA, fixtureContext } from './fixtures';
import {
  MAX_PATTERN_LENGTH,
  PATTERN_MESSAGES,
  PATTERN_TEXT_LENGTH,
  TOO_COMPLEX,
  TOO_MUCH_TEXT,
  TOO_SLOW,
  compileFormula,
  createPatternEngine,
  toStoredFormula,
  type FormulaBudget,
  type FormulaContext,
} from './index';

const M = PATTERN_MESSAGES;
const yes = { ok: true, value: true };
const no = { ok: true, value: false };
const ok = <T>(value: T) => ({ ok: true, value });
const bad = (error: string) => ({ ok: false, error });

function stored(source: string): string {
  const s = toStoredFormula(source, CASES_SCHEMA);
  if (!s.ok) throw new Error(s.error.message);
  return s.expression;
}

function run(source: string, ctx: FormulaContext = fixtureContext()): ComputedValue {
  const compiled = compileFormula(stored(source), CASES_SCHEMA);
  if (!compiled.ok) throw new Error(compiled.error.message);
  return compiled.run(CASE_ROW, ctx);
}

describe('pattern engine (re2js)', () => {
  it('runs patterns that make backtracking engines hang, in linear time', () => {
    const engine = createPatternEngine();
    const text = `${'a'.repeat(PATTERN_TEXT_LENGTH - 1)}!`;
    const started = Date.now();
    for (const pattern of ['(a+)+$', '(a|aa)+$', '(a|a)+$', '(x+x+)+y']) {
      expect(engine.test(text, pattern)).toEqual(no);
      expect(engine.match(text, pattern)).toEqual(ok([]));
      expect(engine.replace(text, pattern, 'x', true)).toEqual(ok(text));
    }
    expect(Date.now() - started).toBeLessThan(5_000);
    // JavaScript's RegExp would take years over these 41 characters.
    expect(run('test(repeat("a", 40) + "!", "(a+)+$")')).toEqual({ kind: 'boolean', value: false });
    expect(run('test(repeat("a", 40) + "!", "(a|aa)+$")')).toEqual({
      kind: 'boolean',
      value: false,
    });
    expect(run('test(repeat("a", 40), "(a|aa)+$")')).toEqual({ kind: 'boolean', value: true });
  });

  it('refuses nested counted repeats before compiling them', () => {
    const engine = createPatternEngine();
    expect(engine.check('((a{100}){100}){100}')).toBe(M.tooComplex);
    expect(engine.check('(a{100}){100}')).toBe(M.tooComplex);
    expect(engine.check('(?:x{2,}){500}')).toBe(M.tooComplex);
    expect(engine.check('(a{2,1000}b){2}')).toBe(M.tooComplex);
    expect(engine.check('a{1001}')).toBe(M.tooComplex);
    expect(engine.compiled).toBe(0);
    expect(engine.check('(a{10}){100}')).toBeNull();
    expect(engine.check('a{2,5}b{0,3}[{]x{,3}')).toBeNull();
    expect(engine.compiled).toBe(2);
    // Under the copy limit but too big a program once compiled.
    expect(engine.check('(a?){600}a{600}')).toBe(M.tooComplex);
  });

  it('handles the empty pattern', () => {
    const engine = createPatternEngine();
    expect(engine.test('abc', '')).toEqual(yes);
    expect(engine.test('', '')).toEqual(yes);
    expect(engine.match('abc', '')).toEqual(ok(['', '', '', '']));
    expect(engine.replace('abc', '', '-', false)).toEqual(ok('-abc'));
    expect(engine.replace('abc', '', '-', true)).toEqual(ok('-a-b-c-'));
    expect(engine.replace('a😀b', '', '-', true)).toEqual(ok('-a-😀-b-'));
    const long = 'a'.repeat(PATTERN_TEXT_LENGTH);
    // 10,001 empty matches: one more than a list may hold.
    expect(engine.match(long, '')).toEqual(bad(TOO_COMPLEX));
    expect(engine.replace(long, '', '-', true)).toEqual(ok(`-${'a-'.repeat(PATTERN_TEXT_LENGTH)}`));
    expect(engine.replace(long, '', 'x'.repeat(10), true)).toEqual(bad(TOO_MUCH_TEXT));
    expect(run('replaceAll("abc", "", "-")')).toEqual({ kind: 'text', value: '-a-b-c-' });
    expect(run('match("ab", "")')).toEqual({
      kind: 'list',
      value: [
        { kind: 'text', value: '' },
        { kind: 'text', value: '' },
        { kind: 'text', value: '' },
      ],
    });
  });

  it('stops match and replace at their limits while it makes them', () => {
    const engine = createPatternEngine();
    let calls = 0;
    const overTime = () => {
      calls++;
      return false;
    };
    const text = 'a'.repeat(1_000);
    expect(engine.match(text, 'a', { overTime, maxMatches: 3 })).toEqual(bad(TOO_COMPLEX));
    // Once after compiling and once per match kept: it stopped at the 4th of 1,000 matches.
    expect(calls).toBe(4);
    calls = 0;
    expect(engine.replace(text, 'a', 'bbbb', true, { overTime, maxLength: 10 })).toEqual(
      bad(TOO_MUCH_TEXT),
    );
    expect(calls).toBe(3);
    // $' copies the rest of the text for each match; the limit holds while that's built.
    expect(engine.replace('a'.repeat(5_000), 'a', "$'", true)).toEqual(bad(TOO_MUCH_TEXT));
    expect(engine.replace('abc', 'b', "$'", true, { maxLength: 4 })).toEqual(ok('acc'));
    expect(engine.replace('abc', 'b', "$'$'", true, { maxLength: 3 })).toEqual(bad(TOO_MUCH_TEXT));
    // In a formula the row's text budget is the limit.
    expect(run('replaceAll(repeat("a", 5000), "a", repeat("b", 21))')).toEqual({
      kind: 'error',
      message: TOO_MUCH_TEXT,
    });
  });

  it('compiles each pattern once and keeps it', () => {
    const engine = createPatternEngine(2);
    for (let i = 0; i < 100; i++) expect(engine.test(`row ${i}`, '\\d+')).toEqual(yes);
    expect(engine.compiled).toBe(1);
    engine.test('x', 'a');
    engine.test('x', 'b');
    engine.test('x', '\\d+');
    expect(engine.compiled).toBe(4);
    // Patterns that can't run are kept too.
    expect(engine.check('(abc')).not.toBeNull();
    expect(engine.check('(abc')).not.toBeNull();
    expect(engine.compiled).toBe(5);
    // A formula worked out for 1,000 rows compiles its pattern once.
    const shared = createPatternEngine();
    const ctx = fixtureContext(CASE_PROPERTIES, { patterns: shared });
    const f = compileFormula(stored('test(prop("Phone"), "^555-\\\\d+$")'), CASES_SCHEMA);
    if (!f.ok) throw new Error(f.error.message);
    for (let i = 0; i < 1_000; i++) {
      expect(f.run(CASE_ROW, ctx)).toEqual({ kind: 'boolean', value: true });
    }
    expect(shared.compiled).toBe(1);
  });

  it('reads the first 10,000 characters of a text and keeps the rest', () => {
    const engine = createPatternEngine();
    const text = `${'a'.repeat(PATTERN_TEXT_LENGTH)}b`;
    expect(engine.test(text, 'b')).toEqual(no);
    expect(engine.replace(text, 'a+', 'x', false)).toEqual(ok('xb'));
    expect(engine.replace(text, 'b|a$', 'x', true)).toEqual(ok(`${'a'.repeat(9_999)}xb`));
    // A pair isn't split: an emoji that starts at the last place is left with the rest.
    const pair = `${'a'.repeat(PATTERN_TEXT_LENGTH - 1)}😀`;
    expect(engine.match(pair, '😀')).toEqual(ok([]));
    expect(engine.replace(pair, 'a', '', true)).toEqual(ok('😀'));
  });

  it('refuses long, unsupported and broken patterns with plain messages', () => {
    const engine = createPatternEngine();
    expect(engine.check('a'.repeat(MAX_PATTERN_LENGTH))).toBeNull();
    expect(engine.check('a'.repeat(MAX_PATTERN_LENGTH + 1))).toBe(M.tooLong);
    for (const p of ['(?=a)', 'a(?!b)', '(?<=a)b', '(?<!a)b', '(a)\\1']) {
      expect(engine.check(p)).toBe(M.unsupported);
    }
    expect(engine.check('[(?=a)]\\(?!')).toBeNull();
    expect(engine.check('(abc')).toBe("This pattern isn't valid: a '(' has no ')'.");
    expect(engine.check('abc)')).toBe("This pattern isn't valid: a ')' has no '('.");
    expect(engine.check('[a-')).toBe("This pattern isn't valid: a '[' has no ']'.");
    expect(engine.check('*a')).toBe("This pattern isn't valid: a repeat has nothing before it.");
    expect(engine.check('a{3,2}')).toBe("This pattern isn't valid: a repeat count is backwards.");
    expect(engine.check('[z-a]')).toBe(
      "This pattern isn't valid: a [ ] range or class is not valid.",
    );
    expect(engine.test('abc', '(abc')).toEqual(bad("This pattern isn't valid: a '(' has no ')'."));
  });

  it('reads JavaScript pattern syntax and replacements', () => {
    const engine = createPatternEngine();
    expect(engine.match('café crème', '\\u00e9')).toEqual(ok(['é']));
    expect(engine.match('a😀b', '.')).toEqual(ok(['a', '😀', 'b']));
    expect(engine.test('ABC', '(?i)abc')).toEqual(yes);
    expect(engine.test('a/b', 'a/b')).toEqual(yes);
    const date = '(?<y>\\d{4})-(\\d\\d)-(\\d\\d)';
    expect(engine.replace('On 2026-10-26.', date, '$3/$2/$<y>', false)).toEqual(
      ok('On 26/10/2026.'),
    );
    expect(engine.replace('a-b', '-', "[$&] $$ [$`|$']", false)).toEqual(ok('a[-] $ [a|b]b'));
    expect(engine.replace('ab', '(a)', '$2$1$0$', false)).toEqual(ok('$2a$0$b'));
    expect(engine.replace('ab', '(a)?b', '[$1]', true)).toEqual(ok('[a]'));
    expect(engine.replace('b', '(a)?b', '[$1]', true)).toEqual(ok('[]'));
    expect(engine.replace('ab', 'a', '$<x>', false)).toEqual(ok('$<x>b'));
    expect(run('replace("2026-10-26", "(\\\\d+)-(\\\\d+)-(\\\\d+)", "$3.$2.$1")')).toEqual({
      kind: 'text',
      value: '26.10.2026',
    });
  });

  it('stops with "⚠ Pattern too slow" once the row\'s time is up', () => {
    const engine = createPatternEngine();
    let left = 3;
    const overTime = () => left-- <= 0;
    expect(engine.match('a'.repeat(100), 'a', { overTime })).toEqual(bad(M.tooSlow));
    expect(left).toBe(-1);
    // In a formula, on the row's clock: 20 ms pass between readings, a row gets 50 ms.
    let now = 0;
    const clock = () => (now += 20);
    const ctx = fixtureContext(CASE_PROPERTIES, { clock, patterns: engine });
    expect(run('match(repeat("a", 100), "a")', ctx)).toEqual({ kind: 'error', message: M.tooSlow });
    // Past the request's deadline: the budget is spent and later rows don't run.
    now = 0;
    const budget: FormulaBudget = { deadline: 50 };
    const tight = fixtureContext(CASE_PROPERTIES, { clock: () => (now += 30), budget });
    expect(run('test("abc", "b")', tight)).toEqual({ kind: 'error', message: M.tooSlow });
    expect(budget.spent).toBe(true);
    expect(run('1 + 1', tight)).toEqual({ kind: 'error', message: TOO_SLOW });
  });

  it('checks patterns written in a formula when it is saved', () => {
    const source = 'if(test(prop("Phone"), "(\\\\d"), 1, 2)';
    const start = source.indexOf('"(');
    expect(toStoredFormula(source, CASES_SCHEMA)).toEqual({
      ok: false,
      error: { message: "This pattern isn't valid: a '(' has no ')'.", start, end: start + 6 },
    });
    const method = 'prop("p_phone").replaceAll("((a{100}){100}){100}", "")';
    const literal = '"((a{100}){100}){100}"';
    const at = method.indexOf(literal);
    expect(compileFormula(method, CASES_SCHEMA)).toEqual({
      ok: false,
      error: { message: M.tooComplex, start: at, end: at + literal.length },
    });
    // A pattern worked out while the formula runs is checked when it runs.
    expect(run('test("abc", "(" + "a")')).toEqual({
      kind: 'error',
      message: "This pattern isn't valid: a '(' has no ')'.",
    });
  });
});
