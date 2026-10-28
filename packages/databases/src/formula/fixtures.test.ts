import { describe, expect, it } from 'vitest';
import { FORMULA_FIXTURES, runFixture } from './fixtures';
import { listFunctions } from './index';
import { tokenize } from './lexer';
import { childrenOf, parseFormula, type Node } from './parser';

/** Every operator as written (§3.2), brackets and commas included. */
const OPERATORS = [
  '(',
  ')',
  '[',
  ']',
  ',',
  '.',
  'not',
  '!',
  '^',
  '*',
  '/',
  '%',
  '+',
  '-',
  '>',
  '>=',
  '<',
  '<=',
  '==',
  '!=',
  'and',
  '&&',
  'or',
  '||',
  '?',
  ':',
];

/** The functions a formula calls and the operators it's written with. */
function used(formula: string): string[] {
  const out: string[] = [];
  const walk = (n: Node) => {
    if (n.type === 'call') out.push(`${n.name}()`);
    childrenOf(n).forEach(walk);
  };
  const parsed = parseFormula(formula);
  if (parsed.ok && parsed.ast) walk(parsed.ast);
  try {
    for (const t of tokenize(formula)) {
      if (t.kind === 'op' || (t.kind === 'name' && ['not', 'and', 'or'].includes(t.value))) {
        out.push(t.value);
      }
    }
  } catch {
    // Writing mistakes are examples too; they don't count toward operators.
  }
  return out;
}

describe('formula fixtures (FX-01)', () => {
  it('has at least 300 examples, with empty results and errors among them', () => {
    expect(FORMULA_FIXTURES.length >= 300).toBe(true);
    const errors = FORMULA_FIXTURES.filter((f) => f.error !== undefined);
    const empties = FORMULA_FIXTURES.filter(
      (f) => f.error === undefined && (f.value ?? null) === null,
    );
    expect(errors.length >= 50).toBe(true);
    expect(empties.length >= 10).toBe(true);
  });

  it('uses every function and every operator', () => {
    const seen = new Set(FORMULA_FIXTURES.flatMap((f) => used(f.formula)));
    const missing = [...listFunctions().map((f) => `${f.name}()`), ...OPERATORS].filter(
      (name) => !seen.has(name),
    );
    expect(missing).toEqual([]);
  });

  it('gives the expected value or message for every example', () => {
    const wrong = FORMULA_FIXTURES.flatMap((f) => {
      const got = runFixture(f);
      const want = f.error !== undefined ? { error: f.error } : { value: f.value ?? null };
      return JSON.stringify(got) === JSON.stringify(want)
        ? []
        : [{ formula: f.formula, want, got }];
    });
    expect(wrong).toEqual([]);
  });

  it('gives the same results when run again (cached patterns change nothing)', () => {
    const twice = FORMULA_FIXTURES.map((f) => [runFixture(f), runFixture(f)]);
    expect(twice.every(([a, b]) => JSON.stringify(a) === JSON.stringify(b))).toBe(true);
  });
});
