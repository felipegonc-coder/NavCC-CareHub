/**
 * Turns formula text into a tree. Operators, tightest first: ( ), .method(), unary - and not (!),
 * ^ (right to left), * / %, + -, > >= < <=, == !=, and (&&), or (||), then ? :.
 * `x.f(a)` is the call f(x, a). Nesting deeper than LIMITS.formulaNesting is "too complex".
 */
import { LIMITS } from '../types';
import { FormulaSyntaxError, syntaxError, tokenize, type Token } from './lexer';
import { TOO_COMPLEX, type FormulaError } from './registry';

/** Where a node is in the formula text. */
export interface Span {
  start: number;
  end: number;
}

/** Binary operators, by meaning ("and" is also written &&, "or" also ||). */
export type BinaryOp =
  '^' | '*' | '/' | '%' | '+' | '-' | '>' | '>=' | '<' | '<=' | '==' | '!=' | 'and' | 'or';

/** A piece of a parsed formula. */
export type Node =
  | (Span & { type: 'number'; value: number })
  | (Span & { type: 'text'; value: string })
  | (Span & { type: 'boolean'; value: boolean })
  | (Span & { type: 'list'; items: Node[] })
  | (Span & { type: 'name'; name: string })
  | (Span & {
      type: 'call';
      name: string;
      /** For a method call, the value before the dot comes first. */
      args: Node[];
      method: boolean;
      nameStart: number;
      nameEnd: number;
    })
  | (Span & { type: 'unary'; op: '-' | 'not'; operand: Node })
  | (Span & { type: 'binary'; op: BinaryOp; opText: string; left: Node; right: Node })
  | (Span & { type: 'conditional'; test: Node; then: Node; otherwise: Node });

/** The parsed tree (null for a formula with nothing but spaces and comments), or the first mistake. */
export type ParseResult = { ok: true; ast: Node | null } | { ok: false; error: FormulaError };

/** A node's direct children, in the order they're written. */
export function childrenOf(node: Node): Node[] {
  switch (node.type) {
    case 'list':
      return node.items;
    case 'call':
      return node.args;
    case 'unary':
      return [node.operand];
    case 'binary':
      return [node.left, node.right];
    case 'conditional':
      return [node.test, node.then, node.otherwise];
    default:
      return [];
  }
}

const LEVELS: { ops: Map<string, BinaryOp>; right?: boolean }[] = [
  {
    ops: new Map([
      ['||', 'or'],
      ['or', 'or'],
    ]),
  },
  {
    ops: new Map([
      ['&&', 'and'],
      ['and', 'and'],
    ]),
  },
  {
    ops: new Map([
      ['==', '=='],
      ['!=', '!='],
    ]),
  },
  { ops: new Map(['>', '>=', '<', '<='].map((o) => [o, o as BinaryOp])) },
  { ops: new Map(['+', '-'].map((o) => [o, o as BinaryOp])) },
  { ops: new Map(['*', '/', '%'].map((o) => [o, o as BinaryOp])) },
  { ops: new Map([['^', '^']]), right: true },
];

class Parser {
  private pos = 0;
  private depth = 0;
  private readonly depths = new WeakMap<Node, number>();
  private readonly source: string;
  private readonly tokens: Token[];

  constructor(source: string, tokens: Token[]) {
    this.source = source;
    this.tokens = tokens;
  }

  private peek(offset = 0): Token {
    const last = this.tokens[this.tokens.length - 1];
    return this.tokens[this.pos + offset] ?? last ?? { kind: 'end', value: '', start: 0, end: 0 };
  }

  private next(): Token {
    const t = this.peek();
    if (this.pos < this.tokens.length - 1) this.pos++;
    return t;
  }

  private isOp(value: string, offset = 0): boolean {
    const t = this.peek(offset);
    return t.kind === 'op' && t.value === value;
  }

  private unexpected(t: Token): never {
    const shown = this.source.slice(t.start, Math.min(t.end, t.start + 20));
    syntaxError(this.source, `Unexpected '${shown}'`, t.start, t.end);
  }

  /** Takes the closing bracket, or says it's missing. */
  private close(op: string): Token {
    const t = this.peek();
    if (this.isOp(op)) return this.next();
    if (t.kind === 'end') syntaxError(this.source, `Missing '${op}'`, t.start, t.end);
    this.unexpected(t);
  }

  private enter(at: Token): void {
    this.depth++;
    if (this.depth > LIMITS.formulaNesting) {
      throw new FormulaSyntaxError({ message: TOO_COMPLEX, start: at.start, end: at.end });
    }
  }

  private node<T extends Node>(n: T, ...children: Node[]): T {
    let d = 0;
    for (const c of children) d = Math.max(d, this.depths.get(c) ?? 1);
    if (d + 1 > LIMITS.formulaNesting) {
      throw new FormulaSyntaxError({ message: TOO_COMPLEX, start: n.start, end: n.end });
    }
    this.depths.set(n, d + 1);
    return n;
  }

  finish(): void {
    const t = this.peek();
    if (t.kind !== 'end') this.unexpected(t);
  }

  expression(): Node {
    this.enter(this.peek());
    const test = this.binary(0);
    let result = test;
    if (this.isOp('?')) {
      this.next();
      const then = this.expression();
      this.close(':');
      const otherwise = this.expression();
      const span = { start: test.start, end: otherwise.end };
      result = this.node(
        { type: 'conditional', test, then, otherwise, ...span },
        test,
        then,
        otherwise,
      );
    }
    this.depth--;
    return result;
  }

  private binary(level: number): Node {
    const spec = LEVELS[level];
    if (!spec) return this.unary();
    let left = this.binary(level + 1);
    for (;;) {
      const t = this.peek();
      const op = t.kind === 'op' || t.kind === 'name' ? spec.ops.get(t.value) : undefined;
      if (!op) return left;
      this.next();
      if (spec.right) this.enter(t);
      const right = spec.right ? this.binary(level) : this.binary(level + 1);
      if (spec.right) this.depth--;
      const span = { start: left.start, end: right.end };
      left = this.node({ type: 'binary', op, opText: t.value, left, right, ...span }, left, right);
      if (spec.right) return left;
    }
  }

  private unary(): Node {
    const t = this.peek();
    const minus = t.kind === 'op' && t.value === '-';
    const not =
      (t.kind === 'op' && t.value === '!') ||
      (t.kind === 'name' && t.value === 'not' && !this.isOp('(', 1));
    if (!minus && !not) return this.postfix();
    this.next();
    this.enter(t);
    const operand = this.unary();
    this.depth--;
    if (minus && operand.type === 'number') {
      return this.node({ type: 'number', value: -operand.value, start: t.start, end: operand.end });
    }
    const op = minus ? '-' : 'not';
    return this.node({ type: 'unary', op, operand, start: t.start, end: operand.end }, operand);
  }

  private postfix(): Node {
    let node = this.primary();
    while (this.isOp('.')) {
      this.next();
      const name = this.peek();
      if (name.kind === 'end') syntaxError(this.source, 'Missing a value', name.start, name.end);
      if (name.kind !== 'name') this.unexpected(name);
      this.next();
      let args: Node[] = [];
      let end = name.end;
      if (this.isOp('(')) ({ args, end } = this.args(')'));
      const call: Node = {
        type: 'call',
        name: name.value,
        args: [node, ...args],
        method: true,
        nameStart: name.start,
        nameEnd: name.end,
        start: node.start,
        end,
      };
      node = this.node(call, node, ...args);
    }
    return node;
  }

  /** Inputs after an opening bracket, up to the closing one. */
  private args(closing: string): { args: Node[]; end: number } {
    this.next();
    const args: Node[] = [];
    if (this.isOp(closing)) return { args, end: this.next().end };
    for (;;) {
      args.push(this.expression());
      if (!this.isOp(',')) return { args, end: this.close(closing).end };
      this.next();
    }
  }

  private primary(): Node {
    const t = this.peek();
    const span = { start: t.start, end: t.end };
    if (t.kind === 'number') {
      this.next();
      return this.node({ type: 'number', value: Number(t.value), ...span });
    }
    if (t.kind === 'text') {
      this.next();
      return this.node({ type: 'text', value: t.value, ...span });
    }
    if (t.kind === 'name') {
      this.next();
      if (this.isOp('(')) {
        const { args, end } = this.args(')');
        const call: Node = {
          type: 'call',
          name: t.value,
          args,
          method: false,
          nameStart: t.start,
          nameEnd: t.end,
          start: t.start,
          end,
        };
        return this.node(call, ...args);
      }
      if (t.value === 'true' || t.value === 'false') {
        return this.node({ type: 'boolean', value: t.value === 'true', ...span });
      }
      return this.node({ type: 'name', name: t.value, ...span });
    }
    if (this.isOp('(')) {
      this.next();
      const inner = this.expression();
      this.close(')');
      return inner;
    }
    if (this.isOp('[')) {
      const { args, end } = this.args(']');
      return this.node({ type: 'list', items: args, start: t.start, end }, ...args);
    }
    syntaxError(this.source, 'Missing a value', t.start, t.end);
  }
}

/** Parses a formula. Nothing but spaces and comments gives a null tree. */
export function parseFormula(source: string): ParseResult {
  try {
    const tokens = tokenize(source);
    if (tokens.length === 1) return { ok: true, ast: null };
    const parser = new Parser(source, tokens);
    const ast = parser.expression();
    parser.finish();
    return { ok: true, ast };
  } catch (e) {
    if (e instanceof FormulaSyntaxError) return { ok: false, error: e.error };
    throw e;
  }
}
