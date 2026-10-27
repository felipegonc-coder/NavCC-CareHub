/**
 * Checks a parsed formula against its database and works out the type of every part, giving the
 * typed tree that evaluate.ts runs. Each message is the one the formula editor shows.
 */
import { findPropertyByName } from '../row';
import { LIMITS } from '../types';
import type { ComputedValue, Id, Property } from '../types';
import { propertyType } from './kinds';
import type { Node } from './parser';
import { countMessage, fits, patternName, resolvePattern } from './signatures';
import {
  BOOLEAN,
  EMPTY_TYPE,
  FormulaFailure,
  NUMBER,
  TEXT,
  TOO_COMPLEX,
  bool,
  getFunction,
  listType,
  num,
  paramsFor,
  txt,
  typeName,
  unify,
  type FormulaError,
  type FormulaSchema,
  type FormulaType,
  type FunctionDef,
  type Param,
  type Signature,
  type TypePattern,
} from './registry';

/** A place in the formula text. */
export interface At {
  start: number;
  end: number;
}

/** The typed tree a formula runs as. Slots hold let variables and list functions' current and index. */
export type Expr =
  | (At & { op: 'value'; value: ComputedValue; type: FormulaType })
  | (At & { op: 'list'; items: Expr[]; type: FormulaType })
  | (At & { op: 'var'; slot: number; type: FormulaType })
  | (At & { op: 'prop'; property: Property; page: Expr | null; type: FormulaType })
  | (At & {
      op: 'call';
      def: FunctionDef;
      args: Expr[];
      slots: { current: number; index: number } | null;
      type: FormulaType;
    })
  | (At & { op: 'let'; slot: number; value: Expr; body: Expr; type: FormulaType })
  | (At & { op: 'add'; left: Expr; right: Expr; text: boolean; type: FormulaType })
  | (At & { op: 'neg'; operand: Expr; type: FormulaType })
  | (At & {
      op: 'compare';
      cmp: '>' | '>=' | '<' | '<=';
      left: Expr;
      right: Expr;
      type: FormulaType;
    });

/** A prop("…") the formula reads: the quoted part's place (quotes included) and the property. */
export interface PropertyRef extends At {
  property: Property;
  /** The relation property the row came through; null for the formula's own row. */
  via: Id | null;
}

/** "id": stored formulas, prop("<id>"). "name": formulas as typed, prop("Score"). */
export type CheckMode = 'id' | 'name';

/** The typed tree (null for an empty formula), or the first problem. */
export type CheckResult =
  | { ok: true; expr: Expr | null; type: FormulaType; slots: number; refs: PropertyRef[] }
  | { ok: false; error: FormulaError };

/** The message for Text + Number. */
export const TEXT_AND_NUMBER =
  "Text and a number can't be added. Use format() to make the number text.";
/** The message for reading rows more than LIMITS.formulaRelationDepth relations away. */
export const RELATION_DEPTH = `Formulas can read related rows at most ${LIMITS.formulaRelationDepth} relations away.`;
/** The message for a formula longer than LIMITS.formulaLength. */
export const LENGTH_MESSAGE = `Formulas can be up to ${LIMITS.formulaLength.toLocaleString('en-US')} characters.`;

class CheckFailure extends Error {
  readonly error: FormulaError;
  constructor(message: string, at: At) {
    super(message);
    this.error = { message, start: at.start, end: at.end };
  }
}

function reject(message: string, at: At): never {
  throw new CheckFailure(message, at);
}

interface Scope {
  name: string;
  slot: number;
  type: FormulaType;
  up: Scope | null;
}

type CallNode = Extract<Node, { type: 'call' }>;
const span = (n: At): At => ({ start: n.start, end: n.end });
const fitsKind = (t: FormulaType, kind: FormulaType['kind']) =>
  t.kind === kind || t.kind === 'empty';
const ARITHMETIC = new Map([
  ['-', 'subtract'],
  ['*', 'multiply'],
  ['/', 'divide'],
  ['%', 'mod'],
  ['^', 'pow'],
]);
const ORDERED = new Set<FormulaType['kind']>(['number', 'text', 'date', 'empty']);

class Checker {
  slots = 0;
  readonly refs: PropertyRef[] = [];
  private readonly schema: FormulaSchema;
  private readonly mode: CheckMode;
  private readonly relatedMemo = new Map<FormulaSchema, Map<Id, FormulaSchema | null>>();

  constructor(schema: FormulaSchema, mode: CheckMode) {
    this.schema = schema;
    this.mode = mode;
  }

  check(node: Node, scope: Scope | null): Expr {
    const at = span(node);
    switch (node.type) {
      case 'number':
        return { op: 'value', value: num(node.value), type: NUMBER, ...at };
      case 'text':
        return { op: 'value', value: txt(node.value), type: TEXT, ...at };
      case 'boolean':
        return { op: 'value', value: bool(node.value), type: BOOLEAN, ...at };
      case 'list':
        return this.list(node.items, at, scope);
      case 'name':
        return this.name(node.name, at, scope);
      case 'call':
        if (node.name === 'prop') return this.prop(node, scope);
        if (node.name === 'let' || node.name === 'lets') return this.let(node, scope);
        return this.call(this.named(node), node.args, at, scope);
      case 'unary': {
        if (node.op === 'not') return this.call(this.def('not'), [node.operand], at, scope);
        const operand = this.check(node.operand, scope);
        if (!fitsKind(operand.type, 'number')) reject('- needs numbers', at);
        return { op: 'neg', operand, type: NUMBER, ...at };
      }
      case 'binary':
        return this.binary(node, scope);
      case 'conditional':
        return this.call(this.def('if'), [node.test, node.then, node.otherwise], at, scope);
    }
  }

  private def(name: string): FunctionDef {
    const def = getFunction(name);
    if (!def) throw new Error(`Formula function "${name}" isn't loaded`);
    return def;
  }

  private named(node: CallNode): FunctionDef {
    const def = getFunction(node.name);
    if (!def || def.special) {
      reject(`Unknown function "${node.name}".`, { start: node.nameStart, end: node.nameEnd });
    }
    return def;
  }

  private binary(node: Extract<Node, { type: 'binary' }>, scope: Scope | null): Expr {
    const at = span(node);
    const { op } = node;
    if (op === 'and' || op === 'or')
      return this.call(this.def(op), [node.left, node.right], at, scope);
    if (op === '==' || op === '!=') {
      const def = this.def(op === '==' ? 'equal' : 'unequal');
      return this.call(def, [node.left, node.right], at, scope);
    }
    const left = this.check(node.left, scope);
    const right = this.check(node.right, scope);
    const lt = left.type;
    const rt = right.type;
    // Operator messages are written as the spec writes "+ needs numbers or text": no period.
    if (op === '+') {
      const text = lt.kind === 'text' || rt.kind === 'text';
      if (text && fitsKind(lt, 'text') && fitsKind(rt, 'text')) {
        return { op: 'add', left, right, text: true, type: TEXT, ...at };
      }
      if (text && (lt.kind === 'number' || rt.kind === 'number')) reject(TEXT_AND_NUMBER, at);
      if (!text && fitsKind(lt, 'number') && fitsKind(rt, 'number')) {
        return { op: 'add', left, right, text: false, type: NUMBER, ...at };
      }
      reject('+ needs numbers or text', at);
    }
    if (op === '>' || op === '>=' || op === '<' || op === '<=') {
      if (lt.kind !== 'empty' && rt.kind !== 'empty' && lt.kind !== rt.kind) {
        reject(`${typeName(lt)} and ${typeName(rt)} can't be compared.`, at);
      }
      if (!ORDERED.has(lt.kind) || !ORDERED.has(rt.kind)) {
        reject(`${node.opText} needs numbers, text or dates`, at);
      }
      return { op: 'compare', cmp: op, left, right, type: BOOLEAN, ...at };
    }
    if (!fitsKind(lt, 'number') || !fitsKind(rt, 'number'))
      reject(`${node.opText} needs numbers`, at);
    const def = this.def(ARITHMETIC.get(op) ?? 'subtract');
    return { op: 'call', def, args: [left, right], slots: null, type: NUMBER, ...at };
  }

  private list(items: Node[], at: At, scope: Scope | null): Expr {
    let type: FormulaType = EMPTY_TYPE;
    const exprs = items.map((item) => {
      const e = this.check(item, scope);
      const both = unify(type, e.type);
      if (!both) {
        reject(
          `A list has to hold one type; it holds ${typeName(type)} and ${typeName(e.type)}.`,
          e,
        );
      }
      type = both;
      return e;
    });
    if (exprs.length > LIMITS.formulaListItems) reject(TOO_COMPLEX, at);
    return { op: 'list', items: exprs, type: listType(type), ...at };
  }

  private name(name: string, at: At, scope: Scope | null): Expr {
    for (let s = scope; s; s = s.up) {
      if (s.name === name) return { op: 'var', slot: s.slot, type: s.type, ...at };
    }
    const def = getFunction(name);
    if (def && !def.special && def.signatures.some((sig) => paramsFor(sig, 0))) {
      return this.call(def, [], at, scope);
    }
    if (name === 'current' || name === 'index') {
      reject(`${name} only works inside a list function such as map() or filter().`, at);
    }
    const prop = findPropertyByName(this.schema.properties, name);
    if (prop) reject(`Use prop("${prop.name}") to read a property.`, at);
    reject(`Unknown name "${name}".`, at);
  }

  private call(def: FunctionDef, args: readonly Node[], at: At, scope: Scope | null): Expr {
    const options: { sig: Signature; params: readonly Param[] }[] = [];
    for (const sig of def.signatures) {
      const params = paramsFor(sig, args.length);
      if (params) options.push({ sig, params });
    }
    const [first] = options;
    if (!first) reject(countMessage(def, args.length), at);
    const exprs: Expr[] = [];
    let slots: { current: number; index: number } | null = null;
    for (const [i, arg] of args.entries()) {
      if (!first.params[i]?.each) {
        exprs.push(this.check(arg, scope));
        continue;
      }
      const list = exprs[0];
      const firstParam = first.params[0];
      if (list && firstParam) {
        const problem = this.mismatch(def, firstParam.type, list.type, new Map());
        if (problem) reject(problem, list);
      }
      const listT = list?.type;
      const item = listT?.kind === 'list' ? listT.of : EMPTY_TYPE;
      slots ??= { current: this.slots++, index: this.slots++ };
      const outer: Scope = { name: 'current', slot: slots.current, type: item, up: scope };
      exprs.push(this.check(arg, { name: 'index', slot: slots.index, type: NUMBER, up: outer }));
    }
    let problem: { message: string; at: At } | null = null;
    for (const { sig, params } of options) {
      const r = this.match(def, sig, params, exprs, at);
      if ('type' in r) return { op: 'call', def, args: exprs, slots, type: r.type, ...at };
      problem ??= r;
    }
    reject(problem?.message ?? countMessage(def, args.length), problem?.at ?? at);
  }

  private match(
    def: FunctionDef,
    sig: Signature,
    params: readonly Param[],
    exprs: readonly Expr[],
    at: At,
  ): { type: FormulaType } | { message: string; at: At } {
    const bound = new Map<string, FormulaType>();
    for (const [i, p] of params.entries()) {
      const e = exprs[i];
      if (!e) continue;
      const message = this.mismatch(def, p.type, e.type, bound);
      if (message) return { message, at: span(e) };
    }
    const types = exprs.map((e) => e.type);
    const result =
      typeof sig.result === 'function' ? sig.result(types) : resolvePattern(sig.result, bound);
    return typeof result === 'string' ? { message: result, at } : { type: result };
  }

  /** null when the type fits the pattern, else the message. */
  private mismatch(
    def: FunctionDef,
    pattern: TypePattern,
    type: FormulaType,
    bound: Map<string, FormulaType>,
  ): string | null {
    const r = fits(pattern, type, bound);
    if (r === true) return null;
    if (r && def.mismatch) return def.mismatch(typeName(r[0]), typeName(r[1]));
    return `${def.name}() needs ${patternName(pattern, bound)} here; it gets ${typeName(type)}.`;
  }

  private prop(node: CallNode, scope: Scope | null): Expr {
    const at = span(node);
    const given = node.method ? node.args.length - 1 : node.args.length;
    if (given !== 1) reject(`prop() takes 1 input; it gets ${given}.`, at);
    let page: Expr | null = null;
    let schema = this.schema;
    let depth = 0;
    let via: Id | null = null;
    const receiver = node.method ? node.args[0] : undefined;
    if (receiver) {
      page = this.check(receiver, scope);
      const t = page.type;
      if (t.kind !== 'page') reject(`prop() needs Row here; it gets ${typeName(t)}.`, page);
      if (t.depth > LIMITS.formulaRelationDepth) reject(RELATION_DEPTH, at);
      if (!t.schema) reject("The related database can't be read here.", at);
      schema = t.schema;
      depth = t.depth;
      via = t.via;
    }
    const key = node.args[node.method ? 1 : 0];
    if (key?.type !== 'text') {
      reject('prop() needs a property name in quotes, like prop("Score").', key ?? at);
    }
    const property = this.lookup(schema, key.value, key);
    this.refs.push({ start: key.start, end: key.end, property, via });
    const type = propertyType(property, schema, depth, (id) => this.related(schema, id));
    if (typeof type === 'string') reject(type, key);
    return { op: 'prop', property, page, type, ...at };
  }

  private lookup(schema: FormulaSchema, key: string, at: At): Property {
    const props = schema.properties;
    const byId = () => props.find((p) => p.id === key);
    const byName = () => props.find((p) => p.name === key) ?? findPropertyByName(props, key);
    const found = this.mode === 'id' ? (byId() ?? byName()) : (byName() ?? byId());
    if (found) return found;
    const gone = schema.deleted?.find((d) => d.id === key || d.name === key);
    if (gone) reject(`Property "${gone.name}" was deleted.`, at);
    reject(
      this.mode === 'id'
        ? 'A property this formula uses was deleted.'
        : `Property "${key}" doesn't exist.`,
      at,
    );
  }

  private related(schema: FormulaSchema, relationId: Id): FormulaSchema | null {
    let memo = this.relatedMemo.get(schema);
    if (!memo) this.relatedMemo.set(schema, (memo = new Map()));
    if (!memo.has(relationId)) memo.set(relationId, schema.related(relationId));
    return memo.get(relationId) ?? null;
  }

  private let(node: CallNode, scope: Scope | null): Expr {
    const at = span(node);
    const args = node.args;
    const n = args.length;
    if (node.name === 'let' ? n !== 3 : n < 3 || n % 2 === 0) {
      reject(
        node.name === 'let'
          ? `let() takes 3 inputs; it gets ${n}.`
          : `lets() takes names and values in pairs, then one more input; it gets ${n}.`,
        at,
      );
    }
    const pairs: { slot: number; value: Expr }[] = [];
    let inner = scope;
    for (let i = 0; i + 2 < n; i += 2) {
      const nameNode = args[i];
      const valueNode = args[i + 1];
      if (nameNode?.type !== 'name') {
        reject(
          `${node.name}() needs a name first, like let(total, 1 + 2, total * 2).`,
          nameNode ?? at,
        );
      }
      if (!valueNode) break;
      const value = this.check(valueNode, inner);
      const slot = this.slots++;
      pairs.push({ slot, value });
      inner = { name: nameNode.name, slot, type: value.type, up: inner };
    }
    const bodyNode = args[n - 1];
    if (!bodyNode) reject(`${node.name}() needs a result at the end.`, at);
    let expr = this.check(bodyNode, inner);
    for (const p of pairs.reverse()) {
      expr = { op: 'let', slot: p.slot, value: p.value, body: expr, type: expr.type, ...at };
    }
    return expr;
  }
}

/** Checks a parsed formula. Problems come back with their place in the formula text. */
export function checkFormula(
  ast: Node | null,
  schema: FormulaSchema,
  mode: CheckMode,
): CheckResult {
  if (!ast) return { ok: true, expr: null, type: EMPTY_TYPE, slots: 0, refs: [] };
  const checker = new Checker(schema, mode);
  try {
    const expr = checker.check(ast, null);
    return { ok: true, expr, type: expr.type, slots: checker.slots, refs: checker.refs };
  } catch (e) {
    if (e instanceof CheckFailure) return { ok: false, error: e.error };
    if (e instanceof FormulaFailure) {
      return { ok: false, error: { message: e.message, start: ast.start, end: ast.end } };
    }
    throw e;
  }
}
