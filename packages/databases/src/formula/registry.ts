/**
 * Formula types, the function registry, and the helpers function modules share.
 *
 * Function modules (functions/*.ts) call defineFunction when they load and index.ts imports
 * them, so adding functions never touches the engine. Values are ComputedValues from the
 * contract and are never changed after they're made.
 */
import { formatDateValue, startOfDayInstant } from '../dates';
import { numberToDecimal } from '../decimal';
import { compareText } from '../text';
import type { ComputedValue, DateValue, EvalContext, Id, Property, RichText, Row } from '../types';

// ------------------------------------------------------------------ static types

/**
 * The type of a formula value, worked out when the formula is saved. Empty fits every type.
 * A row ("page") knows its database when it came through a relation, how many relations away
 * it is, and which relation property it came through.
 */
export type FormulaType =
  | { kind: 'number' }
  | { kind: 'text' }
  | { kind: 'boolean' }
  | { kind: 'date' }
  | { kind: 'person' }
  | { kind: 'empty' }
  | { kind: 'page'; schema: FormulaSchema | null; depth: number; via: Id | null }
  | { kind: 'list'; of: FormulaType };

/** The Number type. */
export const NUMBER: FormulaType = { kind: 'number' };
/** The Text type. */
export const TEXT: FormulaType = { kind: 'text' };
/** The Checkbox type. */
export const BOOLEAN: FormulaType = { kind: 'boolean' };
/** The Date type. */
export const DATE: FormulaType = { kind: 'date' };
/** The Person type. */
export const PERSON: FormulaType = { kind: 'person' };
/** The type of a value that is always empty; it fits every type. */
export const EMPTY_TYPE: FormulaType = { kind: 'empty' };

/** A list type. */
export function listType(of: FormulaType): FormulaType {
  return { kind: 'list', of };
}

const TYPE_NAMES = {
  number: 'Number',
  text: 'Text',
  boolean: 'Checkbox',
  date: 'Date',
  person: 'Person',
  page: 'Row',
  empty: 'Empty',
} as const;

/** The name people see: Number, Text, Checkbox, Date, Person, Row, List of Text, List, Empty. */
export function typeName(t: FormulaType): string {
  if (t.kind === 'list') return t.of.kind === 'empty' ? 'List' : `List of ${typeName(t.of)}`;
  return TYPE_NAMES[t.kind];
}

/** The type both fit, or null. Empty fits anything; rows from different places lose their database. */
export function unify(a: FormulaType, b: FormulaType): FormulaType | null {
  if (a.kind === 'empty') return b;
  if (b.kind === 'empty') return a;
  if (a.kind === 'list' && b.kind === 'list') {
    const of = unify(a.of, b.of);
    return of ? listType(of) : null;
  }
  if (a.kind === 'page' && b.kind === 'page') {
    if (a.schema === b.schema && a.via === b.via && a.depth === b.depth) return a;
    const same = a.schema === b.schema;
    return {
      kind: 'page',
      schema: same ? a.schema : null,
      depth: Math.max(a.depth, b.depth),
      via: a.via === b.via ? a.via : null,
    };
  }
  return a.kind === b.kind ? a : null;
}

// ------------------------------------------------------------------ schema and context

/** What the checker knows about a database: its properties and the databases its relations reach. */
export interface FormulaSchema {
  properties: readonly Property[];
  /** The related database's schema, or null if it can't be read. */
  related(relationPropertyId: Id): FormulaSchema | null;
  /** The result type of a formula or rollup property; null when it has an error. */
  kindOf(prop: Property): FormulaType | null;
  /** Deleted properties (kept 30 days), so messages and the editor can still name them. */
  deleted?: readonly { id: Id; name: string }[];
}

/** Results of the injected pattern engine; error is a message for the cell, such as "⚠ Pattern too slow". */
export type PatternResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * A safe pattern engine for test, match, replace and replaceAll (security: typed patterns never
 * reach JavaScript RegExp). It enforces the pattern and input limits and its own time limit.
 */
export interface PatternEngine {
  test(text: string, pattern: string): PatternResult<boolean>;
  match(text: string, pattern: string): PatternResult<string[]>;
  replace(text: string, pattern: string, replacement: string, all: boolean): PatternResult<string>;
}

/** What a running formula can see besides its row. */
export interface FormulaContext extends EvalContext {
  /** A related row and its database's context; null when the viewer can't open it. */
  page(id: Id): { row: Row; ctx: FormulaContext } | null;
  /** A person's sign-in email; undefined if unknown. */
  userEmail(id: Id): string | undefined;
  /** Milliseconds from any fixed point. When given, a row gets LIMITS.formulaTimeMs, then "⚠ Too slow". */
  clock?(): number;
  /** Without an engine, the pattern functions give an error. */
  patterns?: PatternEngine;
}

/** A problem in a formula, with its place in the formula text (start inclusive, end exclusive). */
export interface FormulaError {
  message: string;
  start: number;
  end: number;
}

// ------------------------------------------------------------------ values

/** The empty value. */
export const EMPTY: ComputedValue = { kind: 'empty' };
/** Longest text a formula may build before "This formula is too complex." */
export const MAX_TEXT_LENGTH = 100_000;
/** Too many steps, items, nesting or text. */
export const TOO_COMPLEX = 'This formula is too complex.';
/** Past LIMITS.formulaTimeMs for one row. */
export const TOO_SLOW = '⚠ Too slow';

/** A number value; NaN and infinities become empty, and -0 becomes 0. */
export function num(n: number): ComputedValue {
  return Number.isFinite(n) ? { kind: 'number', value: n === 0 ? 0 : n } : EMPTY;
}

/** A text value, styled when `rich` is given. Refused past MAX_TEXT_LENGTH. */
export function txt(value: string, rich?: RichText): ComputedValue {
  if (value.length > MAX_TEXT_LENGTH) fail(TOO_COMPLEX);
  return rich ? { kind: 'text', value, rich } : { kind: 'text', value };
}

/** A checkbox value. */
export function bool(value: boolean): ComputedValue {
  return { kind: 'boolean', value };
}

/** empty(): empty values, "" and [] are empty; 0, false and " " are not. */
export function isEmpty(v: ComputedValue): boolean {
  return (
    v.kind === 'empty' ||
    (v.kind === 'text' && v.value === '') ||
    (v.kind === 'list' && v.value.length === 0)
  );
}

/** Stops the formula with a message shown in the cell. */
export class FormulaFailure extends Error {
  /** Where in the formula it happened; the engine fills it in. */
  at: { start: number; end: number } | null = null;
}

/** Stops the formula for this row; the cell shows the message. */
export function fail(message: string): never {
  throw new FormulaFailure(message);
}

/** A date's start (or end) in milliseconds; a date without a time starts at the viewer's midnight. */
export function dateMillis(
  v: DateValue,
  timeZone: string,
  which: 'start' | 'end' = 'start',
): number {
  const s = which === 'end' ? (v.end ?? v.start) : v.start;
  return Date.parse(v.hasTime ? s : startOfDayInstant(s, timeZone));
}

/** A value as text, as format() gives it: "1234.5", "Oct 26, 2026", "true", names, titles, lists with ", ". */
export function formatText(v: ComputedValue, ctx: FormulaContext): string {
  switch (v.kind) {
    case 'empty':
      return '';
    case 'text':
      return v.value;
    case 'number':
      return numberToDecimal(v.value) ?? String(v.value);
    case 'boolean':
      return v.value ? 'true' : 'false';
    case 'date':
      return formatDateValue(v.value, { format: 'full', viewer: ctx.viewer });
    case 'person':
      return ctx.userName(v.value) ?? '';
    case 'page': {
      const p = ctx.page(v.value);
      return p ? p.row.title || 'Untitled' : '';
    }
    case 'list':
      return v.value
        .filter((x) => x.kind !== 'empty')
        .map((x) => formatText(x, ctx))
        .join(', ');
    case 'error':
      return fail(v.message);
  }
}

/** == : the same type and value; lists item by item; dates by moment; empty only equals empty. */
export function sameValue(a: ComputedValue, b: ComputedValue, ctx: FormulaContext): boolean {
  if (a.kind === 'error') fail(a.message);
  if (b.kind === 'error') fail(b.message);
  if (isEmpty(a) || isEmpty(b)) return isEmpty(a) && isEmpty(b);
  if (a.kind === 'list' && b.kind === 'list') {
    return (
      a.value.length === b.value.length &&
      a.value.every((x, i) => sameValue(x, b.value[i] ?? EMPTY, ctx))
    );
  }
  if (a.kind === 'date' && b.kind === 'date') {
    const tz = ctx.viewer.timeZone;
    const ends = (v: DateValue) => (v.end === null ? null : dateMillis(v, tz, 'end'));
    return dateMillis(a.value, tz) === dateMillis(b.value, tz) && ends(a.value) === ends(b.value);
  }
  if (a.kind === 'text' && b.kind === 'text') return a.value === b.value;
  if (a.kind === 'number' && b.kind === 'number') return a.value === b.value;
  if (a.kind === 'boolean' && b.kind === 'boolean') return a.value === b.value;
  if (a.kind === 'person' && b.kind === 'person') return a.value === b.value;
  if (a.kind === 'page' && b.kind === 'page') return a.value === b.value;
  return false;
}

/** Order of two non-empty values: numbers, texts A→Z ignoring case, dates by start, false before true; else null. */
export function compareValues(
  a: ComputedValue,
  b: ComputedValue,
  ctx: FormulaContext,
): number | null {
  if (a.kind === 'number' && b.kind === 'number') return Math.sign(a.value - b.value);
  if (a.kind === 'text' && b.kind === 'text') return Math.sign(compareText(a.value, b.value));
  if (a.kind === 'date' && b.kind === 'date') {
    const tz = ctx.viewer.timeZone;
    return Math.sign(dateMillis(a.value, tz) - dateMillis(b.value, tz));
  }
  if (a.kind === 'boolean' && b.kind === 'boolean') return Number(a.value) - Number(b.value);
  return null;
}

/** Joins texts, keeping style() and link() formatting when any part has it. */
export function joinTexts(parts: readonly ComputedValue[]): ComputedValue {
  let value = '';
  let styled = false;
  for (const p of parts) {
    if (p.kind === 'text') {
      value += p.value;
      if (p.rich) styled = true;
    }
  }
  if (!styled) return txt(value);
  const rich: RichText = [];
  for (const p of parts) {
    if (p.kind !== 'text') continue;
    if (p.rich) rich.push(...p.rich);
    else if (p.value) rich.push({ text: p.value });
  }
  return txt(value, rich);
}

// ------------------------------------------------------------------ functions

/**
 * Parameter types: a type, "any", the type variables "T" and "U" (every input with the same
 * variable must have the same type, which the result can use), a list of a type, or any of several.
 */
export type TypePattern =
  | 'number'
  | 'text'
  | 'boolean'
  | 'date'
  | 'person'
  | 'page'
  | 'any'
  | 'T'
  | 'U'
  | { list: TypePattern }
  | readonly TypePattern[];

/** One input of a signature. */
export interface Param {
  name: string;
  type: TypePattern;
  /** May be left out; only at the end of `params` or `last`. */
  optional?: boolean;
  /** A list-function input: worked out once per item of the first input, which sees current and index. */
  each?: boolean;
}

/** One way to call a function. */
export interface Signature {
  params: readonly Param[];
  /** Inputs that repeat after `params` (at least `minRepeat` times), like sum's values or ifs's pairs. */
  repeat?: readonly Param[];
  minRepeat?: number;
  /** Inputs after the repeated ones, like ifs's otherwise. */
  last?: readonly Param[];
  /** A pattern (type variables as bound by the inputs), or a function of the input types (a string is an error message). */
  result: TypePattern | ((inputs: readonly FormulaType[]) => FormulaType | string);
}

/** One call while a formula runs. Inputs are worked out only when asked for. */
export interface Call {
  readonly row: Row;
  readonly ctx: FormulaContext;
  /** How many inputs were given. */
  readonly count: number;
  /** The inputs' types and the result's, as checked when saving. */
  readonly types: readonly FormulaType[];
  readonly resultType: FormulaType;
  /** Input i (a missing input is empty). */
  value(i: number): ComputedValue;
  /** An "each" input for one item. */
  each(i: number, current: ComputedValue, index: number): ComputedValue;
  /** Input i as a number, text, date or list; null when empty. */
  number(i: number): number | null;
  text(i: number): string | null;
  date(i: number): DateValue | null;
  list(i: number): readonly ComputedValue[] | null;
  /** Input i as a checkbox; empty counts as false. */
  bool(i: number): boolean;
  /** A list result; past LIMITS.formulaListItems the formula stops with "This formula is too complex." */
  makeList(items: ComputedValue[]): ComputedValue;
  /** Counts extra work (for example one step per item compared) toward the step limit. */
  step(n: number): void;
}

/** Groups in the editor's function list, in this order. */
export const FUNCTION_KINDS = ['logic', 'text', 'numbers', 'dates', 'people', 'lists'] as const;
/** A group in the function list. */
export type FunctionKind = (typeof FUNCTION_KINDS)[number];
/** Group names as shown. */
export const FUNCTION_KIND_LABELS: Record<FunctionKind, string> = {
  logic: 'Logic',
  text: 'Text',
  numbers: 'Numbers',
  dates: 'Dates',
  people: 'People and rows',
  lists: 'Lists',
};

/** A formula function: its signatures, help text and how it works out its value. */
export interface FunctionDef {
  name: string;
  kind: FunctionKind | readonly FunctionKind[];
  signatures: readonly Signature[];
  /** One plain line for the editor. */
  description: string;
  example: string;
  evaluate(call: Call): ComputedValue;
  /** The message when inputs that share a type variable differ, given the two type names. */
  mismatch?(a: string, b: string): string;
  /** Handled by the checker itself (prop, let, lets); evaluate is never called. */
  special?: boolean;
}

const registry = new Map<string, FunctionDef>();

/** Adds a function. Names are case-sensitive and can be defined once. */
export function defineFunction(def: FunctionDef): void {
  if (registry.has(def.name)) throw new Error(`Formula function "${def.name}" is already defined`);
  registry.set(def.name, def);
}

/** The function with this exact name. */
export function getFunction(name: string): FunctionDef | undefined {
  return registry.get(name);
}

/** The inputs a signature takes for `count` inputs, or null if that count doesn't fit. */
export function paramsFor(sig: Signature, count: number): readonly Param[] | null {
  const fixed = sig.params;
  if (!sig.repeat) {
    const required = fixed.filter((p) => !p.optional).length;
    return count >= required && count <= fixed.length ? fixed.slice(0, count) : null;
  }
  const group = sig.repeat;
  const last = sig.last ?? [];
  const rest = count - fixed.length;
  for (const tail of [last.length, last.filter((p) => !p.optional).length]) {
    const r = rest - tail;
    if (r >= 0 && r % group.length === 0 && r / group.length >= (sig.minRepeat ?? 0)) {
      const repeated: Param[] = [];
      for (let k = 0; k < r / group.length; k++) repeated.push(...group);
      return [...fixed, ...repeated, ...last.slice(0, tail)];
    }
  }
  return null;
}

/** The smallest and largest number of inputs a signature takes. */
export function inputRange(sig: Signature): [number, number] {
  const req = (ps: readonly Param[]) => ps.filter((p) => !p.optional).length;
  if (!sig.repeat) return [req(sig.params), sig.params.length];
  const min = sig.params.length + sig.repeat.length * (sig.minRepeat ?? 0) + req(sig.last ?? []);
  return [min, Infinity];
}

/** "round(number, places?)", "sum(values, …)", "ifs(condition, value, …, otherwise?)". */
export function usageText(name: string, sig: Signature): string {
  const show = (p: Param) => (p.optional ? `${p.name}?` : p.name);
  const parts = sig.params.map(show);
  if (sig.repeat) parts.push(...sig.repeat.map(show), '…');
  if (sig.last) parts.push(...sig.last.map(show));
  return `${name}(${parts.join(', ')})`;
}

/** A function as the editor lists it. */
export interface FunctionInfo {
  name: string;
  kinds: FunctionKind[];
  usage: string[];
  description: string;
  example: string;
}

/** Every function, grouped by kind in FUNCTION_KINDS order, then in the order they were defined. */
export function listFunctions(): FunctionInfo[] {
  const all = [...registry.values()].map((d) => ({
    name: d.name,
    kinds: typeof d.kind === 'string' ? [d.kind] : [...d.kind],
    usage: d.signatures.map((s) => usageText(d.name, s)),
    description: d.description,
    example: d.example,
  }));
  const rank = (f: FunctionInfo) => FUNCTION_KINDS.indexOf(f.kinds[0] ?? 'logic');
  return all.sort((a, b) => rank(a) - rank(b));
}
