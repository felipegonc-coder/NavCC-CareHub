import { describe, expect, it } from 'vitest';
import { lineAt, tokenize } from './lexer';
import { parseFormula, type Node } from './parser';
import './index';

/** The tree as compact text, to check how it groups. */
function shape(n: Node | null): string {
  if (!n) return '∅';
  switch (n.type) {
    case 'number':
    case 'boolean':
      return String(n.value);
    case 'text':
      return JSON.stringify(n.value);
    case 'name':
      return n.name;
    case 'list':
      return `[${n.items.map(shape).join(' ')}]`;
    case 'call':
      return `${n.method ? '.' : ''}${n.name}(${n.args.map(shape).join(' ')})`;
    case 'unary':
      return `(${n.op} ${shape(n.operand)})`;
    case 'binary':
      return `(${n.op} ${shape(n.left)} ${shape(n.right)})`;
    case 'conditional':
      return `(? ${shape(n.test)} ${shape(n.then)} ${shape(n.otherwise)})`;
  }
}

function tree(source: string): string {
  const r = parseFormula(source);
  return r.ok ? shape(r.ast) : `error: ${r.error.message}`;
}

describe('tokenize', () => {
  it('reads numbers, texts, names and operators with their places', () => {
    const tokens = tokenize('prop("A") >= 1.5e2 && x');
    expect(tokens.map((t) => `${t.kind}:${t.value}`)).toEqual([
      'name:prop',
      'op:(',
      'text:A',
      'op:)',
      'op:>=',
      'number:1.5e2',
      'op:&&',
      'name:x',
      'end:',
    ]);
    expect(tokens[2]).toMatchObject({ start: 5, end: 8 });
  });

  it('works out escapes and keeps unknown ones', () => {
    expect(tokenize('"a\\"b\\\\c\\nd\\d"')[0]?.value).toBe('a"b\\c\nd\\d');
  });

  it('skips comments and counts lines', () => {
    expect(tokenize('1 /* two\nlines */ + 2').map((t) => t.value)).toEqual(['1', '+', '2', '']);
    expect(lineAt('a\nb\nc', 4)).toBe(3);
  });

  it('allows names in any language', () => {
    expect(tokenize('let(año, 1, año)')[2]).toMatchObject({ kind: 'name', value: 'año' });
  });
});

describe('parseFormula', () => {
  it('follows operator precedence', () => {
    expect(tree('1 + 2 * 3')).toBe('(+ 1 (* 2 3))');
    expect(tree('2 ^ 3 ^ 2')).toBe('(^ 2 (^ 3 2))');
    expect(tree('-2 ^ 2')).toBe('(^ -2 2)');
    expect(tree('-x ^ 2')).toBe('(^ (- x) 2)');
    expect(tree('a or b and c')).toBe('(or a (and b c))');
    expect(tree('a || b && not c')).toBe('(or a (and b (not c)))');
    expect(tree('1 < 2 == true')).toBe('(== (< 1 2) true)');
    expect(tree('a ? b : c ? d : e')).toBe('(? a b (? c d e))');
    expect(tree('10 - 2 - 3')).toBe('(- (- 10 2) 3)');
  });

  it('reads method calls as calls with the value first', () => {
    expect(tree('x.f(1).g()')).toBe('.g(.f(x 1))');
    expect(tree('-5.abs()')).toBe('(- .abs(5))');
    expect(tree('[1, 2].map(current)')).toBe('.map([1 2] current)');
  });

  it('reads not( and and( as calls', () => {
    expect(tree('not(a)')).toBe('not(a)');
    expect(tree('and(a, b)')).toBe('and(a b)');
    expect(tree('!a')).toBe('(not a)');
  });

  it('gives nothing for a formula of spaces and comments', () => {
    expect(parseFormula('  /* hi */ ')).toEqual({ ok: true, ast: null });
  });

  it('says where mistakes are', () => {
    const r = parseFormula('round(1,\n2 3)');
    expect(r).toEqual({
      ok: false,
      error: { message: "Unexpected '3' at line 2", start: 11, end: 12 },
    });
    expect(tree('f(1,)')).toBe('error: Missing a value at line 1');
    expect(tree('(1 + 2')).toBe("error: Missing ')' at line 1");
    expect(tree('x.')).toBe('error: Missing a value at line 1');
    expect(tree('x.1')).toBe("error: Unexpected '1' at line 1");
  });

  it('refuses formulas nested too deeply', () => {
    const deep = `${'('.repeat(101)}1${')'.repeat(101)}`;
    expect(tree(deep)).toBe('error: This formula is too complex.');
    expect(tree(Array(101).fill('1').join(' + '))).toBe('error: This formula is too complex.');
    expect(tree(Array(101).fill('2').join(' ^ '))).toBe('error: This formula is too complex.');
    expect(tree(Array(60).fill('1').join(' + '))).toContain('(+ ');
  });
});
