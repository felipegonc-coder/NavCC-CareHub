import { describe, expect, it, vi } from 'vitest';
import type { Property, Row } from '../types';
import { CASE_PROPERTIES, CASE_ROW, CASES_SCHEMA, fixtureContext } from './fixtures';
import {
  FORMULA_BROKE,
  TOO_COMPLEX,
  TOO_MUCH_TEXT,
  TOO_SLOW,
  compileFormula,
  defineFunction,
  formulaBudget,
  listFunctions,
  toStoredFormula,
  typeName,
  type FormulaBudget,
  type FormulaContext,
} from './index';

function compile(source: string) {
  const stored = toStoredFormula(source, CASES_SCHEMA);
  if (!stored.ok) throw new Error(stored.error.message);
  const compiled = compileFormula(stored.expression, CASES_SCHEMA);
  if (!compiled.ok) throw new Error(compiled.error.message);
  return compiled;
}

const run = (source: string, ctx: FormulaContext = fixtureContext(), row: Row = CASE_ROW) =>
  compile(source).run(row, ctx);

describe('compileFormula', () => {
  it('works out the result kind and type when saving', () => {
    expect(compile('1 + 1').kind).toBe('number');
    expect(compile('prop("Tags")').kind).toBe('list');
    expect(typeName(compile('prop("Tags")').type)).toBe('List of Text');
    expect(typeName(compile('prop("Tasks")').type)).toBe('List of Row');
    expect(typeName(compile('prop("Owner")').type)).toBe('List of Person');
    expect(compile('').kind).toBeNull();
  });

  it('gives problems with their place in the stored formula', () => {
    expect(compileFormula('1 + "a"', CASES_SCHEMA)).toEqual({
      ok: false,
      error: {
        message: "Text and a number can't be added. Use format() to make the number text.",
        start: 0,
        end: 7,
      },
    });
    expect(compileFormula('x'.repeat(10_001), CASES_SCHEMA)).toMatchObject({
      ok: false,
      error: { message: 'Formulas can be up to 10,000 characters.' },
    });
  });

  it('shows where a problem happened in the preview', () => {
    const compiled = compile('1 + prop("Late fee")');
    expect(compiled.preview(CASE_ROW, fixtureContext())).toEqual({
      value: { kind: 'error', message: TOO_COMPLEX },
      error: { message: TOO_COMPLEX, start: 4, end: 18 },
    });
  });
});

describe('limits', () => {
  it('stops after too many steps', () => {
    const many =
      'split(repeat("a", 1000), "").map(split(repeat("b", 1000), "").map(current).length())';
    expect(run(many)).toEqual({ kind: 'error', message: TOO_COMPLEX });
  });

  it('stops lists past 10,000 items and very long texts', () => {
    expect(run('split(repeat("a", 10001), "")')).toEqual({ kind: 'error', message: TOO_COMPLEX });
    expect(run('repeat("a", 100001)')).toEqual({ kind: 'error', message: TOO_MUCH_TEXT });
    expect(run('padStart("a", 100001, "x")')).toEqual({ kind: 'error', message: TOO_MUCH_TEXT });
    expect(run('split(repeat("a", 10000), "").length()')).toEqual({
      kind: 'number',
      value: 10_000,
    });
  });

  it('says "⚠ Too slow" when the clock runs past the time limit', () => {
    let t = 0;
    const clock = vi.fn(() => (t += 100));
    const ctx = fixtureContext(CASE_PROPERTIES, { clock });
    expect(run('split(repeat("a", 100), "").map(current + "b")', ctx)).toEqual({
      kind: 'error',
      message: TOO_SLOW,
    });
    expect(run('1 + 1', fixtureContext(CASE_PROPERTIES, { clock: () => 0 }))).toEqual({
      kind: 'number',
      value: 2,
    });
  });

  it('turns unexpected failures into a plain message', () => {
    const ctx = fixtureContext(CASE_PROPERTIES, {
      userName: () => {
        throw new Error('directory offline');
      },
    });
    expect(run('name(prop("Created by"))', ctx)).toEqual({ kind: 'error', message: FORMULA_BROKE });
  });
});

describe('request time budget', () => {
  const error = (message: string) => ({ kind: 'error', message });

  it('gives "⚠ Too slow" without running once the deadline has passed', () => {
    let now = 0;
    const clock = vi.fn(() => now);
    const userName = vi.fn(() => 'Jordan Park');
    const budget: FormulaBudget = formulaBudget({ clock }, 200);
    const ctx = fixtureContext(CASE_PROPERTIES, { clock, userName, budget });
    const named = compile('name(prop("Created by"))');
    expect(named.run(CASE_ROW, ctx)).toEqual({ kind: 'text', value: 'Jordan Park' });
    now = 200;
    expect(named.run(CASE_ROW, ctx)).toEqual({ kind: 'text', value: 'Jordan Park' });
    now = 201;
    expect(named.preview(CASE_ROW, ctx)).toMatchObject({
      value: error(TOO_SLOW),
      error: { message: TOO_SLOW, start: 0 },
    });
    expect(budget.spent).toBe(true);
    clock.mockClear();
    userName.mockClear();
    now = 0; // spent stays spent
    for (let i = 0; i < 1000; i++) expect(named.run(CASE_ROW, ctx)).toEqual(error(TOO_SLOW));
    expect(clock).not.toHaveBeenCalled();
    expect(userName).not.toHaveBeenCalled();
  });

  it('keeps a query over many rows short', () => {
    let now = 0;
    const clock = vi.fn(() => (now += 1)); // each look at the clock: 1 ms later
    const ctx = fixtureContext(CASE_PROPERTIES, { clock, budget: { deadline: 100 } });
    const double = compile('prop("Score") * 2');
    const results = Array.from({ length: 10_000 }, () => double.run(CASE_ROW, ctx));
    expect(results.filter((v) => v.kind === 'number')).toHaveLength(100);
    expect(results.slice(100).every((v) => v.kind === 'error' && v.message === TOO_SLOW)).toBe(
      true,
    );
    expect(clock).toHaveBeenCalledTimes(101);
  });

  it('cuts a row short at the request deadline, before its own 50 ms', () => {
    let now = 0;
    const budget: FormulaBudget = { deadline: 10 };
    const ctx = fixtureContext(CASE_PROPERTIES, { clock: () => (now += 1), budget });
    expect(run('split(repeat("a", 2000), "").map(current + "b").length()', ctx)).toEqual(
      error(TOO_SLOW),
    );
    expect(budget.spent).toBe(true);
    expect(now).toBeLessThan(20);
  });

  it('makes budgets on the context clock', () => {
    expect(formulaBudget({ clock: () => 500 }, 250)).toEqual({ deadline: 750 });
    const before = Date.now();
    expect(formulaBudget({}).deadline).toBeGreaterThanOrEqual(before + 1000);
  });
});

describe('text budget', () => {
  const tooMuch = { kind: 'error', message: TOO_MUCH_TEXT };

  it('stops a row that builds more than 1,000,000 characters in all', () => {
    const nine = compile('split(repeat("a", 9), "").map(repeat("x", 99999)).length()');
    expect(nine.run(CASE_ROW, fixtureContext())).toEqual({ kind: 'number', value: 9 });
    expect(nine.run(CASE_ROW, fixtureContext())).toEqual({ kind: 'number', value: 9 });
    expect(run('split(repeat("a", 11), "").map(repeat("x", 99999)).length()')).toEqual(tooMuch);
    expect(run('split(repeat("a", 11), "").map(padEnd("x", 99999, "y")).length()')).toEqual(
      tooMuch,
    );
    expect(run('split(repeat("a", 11), "").map(repeat("x", 50000) + repeat("y", 49999))')).toEqual(
      tooMuch,
    );
  });

  it('checks join while it builds, not after', () => {
    const userName = vi.fn(() => 'Jordan Park');
    const ctx = fixtureContext(CASE_PROPERTIES, { userName });
    const people = 'split(repeat("a", 1000), "").map(prop("Created by"))';
    expect(run(`join(${people}, repeat("-", 99990))`, ctx)).toEqual(tooMuch);
    expect(userName).toHaveBeenCalledTimes(2);
    expect(run(`join(${people}, ", ").length()`, ctx)).toEqual({ kind: 'number', value: 12_998 });
  });

  it('counts what lists hold, even when items share one text or list', () => {
    const big = 'let(big, repeat("x", 99999), split(repeat("a", 11), "").map(big))';
    expect(run(`${big}.length()`)).toEqual(tooMuch);
    expect(run(`format(${big})`)).toEqual(tooMuch);
    const many = 'let(many, split(repeat("a", 10000), ""), many.map(many))';
    expect(run(`${many}.length()`)).toEqual({ kind: 'error', message: TOO_COMPLEX });
  });

  it('checks concat and flat before building', () => {
    const l = (n: number) => `split(repeat("a", ${n}), "")`;
    expect(run(`concat(${l(5000)}, ${l(5000)}).length()`)).toEqual({
      kind: 'number',
      value: 10_000,
    });
    expect(run(`concat(${l(6000)}, ${l(5000)})`)).toEqual({ kind: 'error', message: TOO_COMPLEX });
    expect(run(`flat([${l(6000)}, ${l(5000)}])`)).toEqual({ kind: 'error', message: TOO_COMPLEX });
  });
});

describe('values', () => {
  it('keeps style() and link() formatting as rich text', () => {
    expect(run('style("Hi", "b", "red")')).toEqual({
      kind: 'text',
      value: 'Hi',
      rich: [{ text: 'Hi', marks: ['bold'], color: 'red' }],
    });
    expect(run('link("Site", "https://example.com")')).toEqual({
      kind: 'text',
      value: 'Site',
      rich: [{ text: 'Site', link: 'https://example.com' }],
    });
    expect(run('link("Site", "javascript:alert(1)")')).toEqual({ kind: 'text', value: 'Site' });
    expect(run('"a" + style("b", "i", "blue_background")')).toEqual({
      kind: 'text',
      value: 'ab',
      rich: [{ text: 'a' }, { text: 'b', marks: ['italic'], color: 'blue_background' }],
    });
    expect(run('unstyle(style("Hi", "b", "u"), "b")')).toEqual({
      kind: 'text',
      value: 'Hi',
      rich: [{ text: 'Hi', marks: ['underline'] }],
    });
  });

  it('uses the injected pattern engine', () => {
    const test = vi.fn(() => ({ ok: true as const, value: true }));
    const patterns = {
      test,
      match: () => ({ ok: true as const, value: ['QA-1', 'QA-2'] }),
      replace: () => ({ ok: false as const, error: '⚠ Pattern too slow' }),
    };
    const ctx = fixtureContext(CASE_PROPERTIES, { patterns });
    expect(run('test(prop("Phone"), "^5")', ctx)).toEqual({ kind: 'boolean', value: true });
    expect(test.mock.calls[0]).toEqual(['555-0100', '^5']);
    expect(run('match("QA-1 QA-2", "QA-\\\\d")', ctx)).toEqual({
      kind: 'list',
      value: [
        { kind: 'text', value: 'QA-1' },
        { kind: 'text', value: 'QA-2' },
      ],
    });
    expect(run('replaceAll("a", "a", "b")', ctx)).toEqual({
      kind: 'error',
      message: '⚠ Pattern too slow',
    });
  });

  it('reads option names as they are now', () => {
    const renamed: Property[] = CASE_PROPERTIES.map((p) =>
      p.id === 'p_status' && p.config.type === 'select'
        ? {
            ...p,
            config: { ...p.config, options: [{ id: 's_open', name: 'New', color: 'green' }] },
          }
        : p,
    );
    expect(run('prop("Status")', fixtureContext(renamed))).toEqual({ kind: 'text', value: 'New' });
  });

  it('leaves out related rows the viewer cannot open', () => {
    expect(run('prop("Tasks").map(id(current))')).toMatchObject({
      value: [{ value: 't_fix' }, { value: 't_call' }],
    });
  });

  it('gives empty for an empty row', () => {
    const blank: Row = { ...CASE_ROW, title: '', values: {}, createdBy: null, uniqueNumber: null };
    for (const f of [
      'prop("Name")',
      'prop("Tags")',
      'prop("Ticket")',
      'prop("Created by")',
      'prop("Steps")',
    ]) {
      expect(run(f, fixtureContext(), blank)).toEqual({ kind: 'empty' });
    }
    expect(run('prop("Tags").length()', fixtureContext(), blank)).toEqual({
      kind: 'number',
      value: 0,
    });
  });
});

describe('function registry', () => {
  it('lists functions by group with how to use them', () => {
    const all = listFunctions();
    expect(all[0]?.name).toBe('if');
    const round = all.find((f) => f.name === 'round');
    expect(round).toMatchObject({ kinds: ['numbers'], usage: ['round(number, places?)'] });
    expect(all.find((f) => f.name === 'ifs')?.usage).toEqual([
      'ifs(condition, value, …, otherwise?)',
    ]);
    const kinds = all.map((f) => f.kinds[0]);
    expect(kinds.indexOf('lists') > kinds.lastIndexOf('dates')).toBe(true);
    expect(all.length >= 90).toBe(true);
  });

  it('refuses a second function with the same name', () => {
    const def = {
      name: 'abs',
      kind: 'numbers' as const,
      signatures: [],
      description: '',
      example: '',
    };
    expect(() => defineFunction({ ...def, evaluate: () => ({ kind: 'empty' }) })).toThrow(
      'Formula function "abs" is already defined',
    );
  });
});
