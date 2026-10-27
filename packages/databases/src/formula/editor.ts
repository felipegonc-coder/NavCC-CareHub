/**
 * Pure helpers for the formula editor (Formulas §2 and §6), free of any UI: colors, bracket
 * matching, suggestions, property chips, the Properties and Functions lists, hover help, keys, line
 * numbers, and the line under the code ("Number · 42", or the problem and its line). None of them
 * throws, so they work on a formula while it's being typed.
 */
import type { ComputedKind, ComputedValue, EvalContext, Id, Property, Row } from '../types';
import { formatComputed } from '../values';
import { checkFormula, findByName } from './check';
import { compileFormula, type FormulaInputs } from './evaluate';
import { propertyType } from './kinds';
import {
  ONE_CHAR_OPS,
  TWO_CHAR_OPS,
  isDigit,
  isNamePart,
  isNameStart,
  isSpace,
  numberEnd,
  readTextLiteral,
} from './lexer';
import { quoteText, toStoredFormula } from './names';
import { parseFormula } from './parser';
import {
  FUNCTION_KINDS,
  FUNCTION_KIND_LABELS,
  getFunction,
  inputRange,
  isEmpty,
  listFunctions,
  typeName,
  type FormulaContext,
  type FormulaError,
  type FormulaInput,
  type FormulaSchema,
  type FormulaType,
  type FunctionInfo,
  type FunctionKind,
} from './registry';

/** A property's type, for its icon. */
export type PropertyKind = Property['config']['type'];

/** What the editor says besides the formula's own messages. */
export const EDITOR_MESSAGES = {
  noRows: 'No rows yet. The preview uses empty values.',
  formulaError: '⚠ Formula error',
} as const;

// ------------------------------------------------------------------ keys and lines

/** The row of extra keys above a phone's keyboard: what each shows and what it types. */
export const PHONE_KEYS: readonly { label: string; insert: string }[] = [
  '(',
  ')',
  '"',
  ',',
  '.',
  '+',
  '−',
  '*',
  '/',
  '=',
].map((label) => ({ label, insert: label === '−' ? '-' : label }));

/** What a key does in the code box. */
export type EditorKey =
  'suggest' | 'accept' | 'next' | 'previous' | 'closeSuggestions' | 'closeEditor' | 'save';

/** A key press, as a keyboard event has it. */
export interface KeyPress {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

/**
 * The editor's action for a key (§6): Ctrl+Space shows suggestions, Enter or Tab accepts one, the
 * arrows move through them, Esc closes them and then the editor, Ctrl+Enter (⌘+Enter) saves. null:
 * the code box handles the key itself (Enter makes a new line when no suggestions show).
 */
export function editorKey(press: KeyPress, suggestionsOpen: boolean): EditorKey | null {
  const mod = press.ctrlKey === true || press.metaKey === true;
  if (press.key === 'Enter' && mod) return 'save';
  if (press.key === ' ' && press.ctrlKey === true && press.altKey !== true) return 'suggest';
  if (press.key === 'Escape') return suggestionsOpen ? 'closeSuggestions' : 'closeEditor';
  if (!suggestionsOpen || mod || press.altKey === true) return null;
  if (press.key === 'Enter' || (press.key === 'Tab' && press.shiftKey !== true)) return 'accept';
  if (press.key === 'ArrowDown') return 'next';
  if (press.key === 'ArrowUp') return 'previous';
  return null;
}

/** How many lines the code box numbers. */
export function lineCount(source: string): number {
  let lines = 1;
  for (let i = 0; i < source.length; i++) if (source.charCodeAt(i) === 10) lines++;
  return lines;
}

/** The line and column (both from 1) of a place in the formula. */
export function lineAndColumn(source: string, offset: number): { line: number; column: number } {
  const at = Math.max(0, Math.min(offset, source.length));
  const before = source.slice(0, at);
  const lineStart = before.lastIndexOf('\n') + 1;
  return { line: lineCount(before), column: at - lineStart + 1 };
}

/** The text after putting `insert` in place of from…to, and where the cursor goes. */
export function applyInsert(
  source: string,
  from: number,
  to: number,
  insert: string,
  cursor: number = insert.length,
): { source: string; cursor: number } {
  return { source: source.slice(0, from) + insert + source.slice(to), cursor: from + cursor };
}

// ------------------------------------------------------------------ reading as typed

type PieceKind = 'space' | 'comment' | 'number' | 'text' | 'name' | 'op' | 'error';

/** A piece of the formula as typed; `value` is a text's value with its escapes worked out. */
interface Piece {
  kind: PieceKind;
  start: number;
  end: number;
  value: string;
  closed: boolean;
}

/** The formula in pieces, the lexer's way, but going on past mistakes. */
function scan(source: string): Piece[] {
  const pieces: Piece[] = [];
  const n = source.length;
  let i = 0;
  while (i < n) {
    const c = source[i] ?? '';
    const start = i;
    let kind: PieceKind;
    let value: string | null = null;
    let closed = true;
    if (isSpace(c)) {
      while (i < n && isSpace(source[i] ?? '')) i++;
      kind = 'space';
    } else if (c === '/' && source[i + 1] === '*') {
      const close = source.indexOf('*/', i + 2);
      closed = close >= 0;
      i = closed ? close + 2 : n;
      kind = 'comment';
    } else if (isDigit(c)) {
      i = numberEnd(source, i);
      kind = 'number';
    } else if (c === '"') {
      const text = readTextLiteral(source, i);
      i = text.end;
      value = text.value;
      closed = text.closed;
      kind = 'text';
    } else if (isNameStart(c)) {
      while (i < n && isNamePart(source[i] ?? '')) i++;
      kind = 'name';
    } else if (TWO_CHAR_OPS.has(source.slice(i, i + 2))) {
      i += 2;
      kind = 'op';
    } else if (ONE_CHAR_OPS.has(c)) {
      i += 1;
      kind = 'op';
    } else {
      i += String.fromCodePoint(source.codePointAt(i) ?? 0).length;
      kind = 'error';
    }
    pieces.push({ kind, start, end: i, value: value ?? source.slice(start, i), closed });
  }
  return pieces;
}

/** The pieces, the ones that aren't spaces or comments, and which brackets pair up. */
interface Reading {
  pieces: Piece[];
  /** Indexes into pieces of everything but spaces and comments. */
  code: number[];
  /** Bracket piece → its partner's piece. */
  partner: Map<number, number>;
  /** Bracket piece → how many brackets it's inside. */
  depth: Map<number, number>;
}

function read(source: string): Reading {
  const pieces = scan(source);
  const code: number[] = [];
  pieces.forEach((p, i) => {
    if (p.kind !== 'space' && p.kind !== 'comment') code.push(i);
  });
  const partner = new Map<number, number>();
  const depth = new Map<number, number>();
  const open: number[] = [];
  for (const i of code) {
    const v = pieces[i]?.value;
    if (pieces[i]?.kind !== 'op') continue;
    if (v === '(' || v === '[') {
      depth.set(i, open.length);
      open.push(i);
    } else if (v === ')' || v === ']') {
      const top = open[open.length - 1];
      if (top !== undefined && pieces[top]?.value === (v === ')' ? '(' : '[')) {
        open.pop();
        partner.set(top, i);
        partner.set(i, top);
      }
      depth.set(i, open.length);
    }
  }
  return { pieces, code, partner, depth };
}

/** The k-th piece that isn't a space or comment. */
const codeAt = (r: Reading, k: number): Piece | undefined => {
  const i = r.code[k];
  return i === undefined ? undefined : r.pieces[i];
};

/** The last piece that isn't a space or comment and ends by `pos`. */
function lastCodeBefore(r: Reading, pos: number): Piece | undefined {
  let found: Piece | undefined;
  for (const i of r.code) {
    const p = r.pieces[i];
    if (!p || p.end > pos) break;
    found = p;
  }
  return found;
}
const isOp = (p: Piece | undefined, op: string) => p?.kind === 'op' && p.value === op;

/** A prop("…") call as typed: where it is, its key, and whether it's row.prop("…"). */
interface PropCall {
  start: number;
  end: number;
  key: Piece;
  method: boolean;
}

function propCalls(r: Reading): PropCall[] {
  const calls: PropCall[] = [];
  for (let k = 0; k < r.code.length; k++) {
    const name = codeAt(r, k);
    const key = codeAt(r, k + 2);
    const close = codeAt(r, k + 3);
    if (name?.kind !== 'name' || name.value !== 'prop' || !isOp(codeAt(r, k + 1), '(')) continue;
    if (key?.kind !== 'text' || !key.closed || !close || !isOp(close, ')')) continue;
    calls.push({ start: name.start, end: close.end, key, method: isOp(codeAt(r, k - 1), '.') });
  }
  return calls;
}

// ------------------------------------------------------------------ colors and brackets

/** What a part of the formula is, for its color. */
export type HighlightKind =
  | 'number'
  | 'text'
  | 'property'
  | 'function'
  | 'name'
  | 'keyword'
  | 'operator'
  | 'bracket'
  | 'comment'
  | 'space'
  | 'error';

/** One colored part. Together they cover the whole formula, in order. */
export interface HighlightToken {
  kind: HighlightKind;
  start: number;
  end: number;
  /** Brackets: how many brackets they're inside (for matching colors). */
  depth?: number;
  /** Brackets without a partner. */
  unmatched?: true;
  /** A text or comment that isn't closed yet. */
  unclosed?: true;
}

const KEYWORDS = new Set(['true', 'false', 'not', 'and', 'or']);

/** The formula's colored parts: numbers, texts, properties (the quoted name in prop), functions… */
export function highlightFormula(source: string): HighlightToken[] {
  const r = read(source);
  const keys = new Set(propCalls(r).map((c) => c.key.start));
  const nextCode = new Map<number, Piece | undefined>();
  r.code.forEach((i, k) => nextCode.set(i, codeAt(r, k + 1)));
  return r.pieces.map((p, i): HighlightToken => {
    const at = { start: p.start, end: p.end };
    switch (p.kind) {
      case 'space':
      case 'number':
      case 'error':
        return { kind: p.kind, ...at };
      case 'comment':
      case 'text': {
        const kind = p.kind === 'text' && keys.has(p.start) ? 'property' : p.kind;
        return p.closed ? { kind, ...at } : { kind, ...at, unclosed: true };
      }
      case 'name': {
        if (isOp(nextCode.get(i), '(')) return { kind: 'function', ...at };
        return { kind: KEYWORDS.has(p.value) ? 'keyword' : 'name', ...at };
      }
      case 'op': {
        const depth = r.depth.get(i);
        if (depth === undefined) return { kind: 'operator', ...at };
        return r.partner.has(i)
          ? { kind: 'bracket', ...at, depth }
          : { kind: 'bracket', ...at, depth, unmatched: true };
      }
    }
  });
}

/**
 * The bracket just before the cursor (or else just after it) and its partner, to show both;
 * partner is null when it has none. null when the cursor isn't next to a bracket.
 */
export function matchBracket(
  source: string,
  cursor: number,
): { bracket: number; partner: number | null } | null {
  const r = read(source);
  for (const pos of [cursor - 1, cursor]) {
    const i = r.pieces.findIndex((p) => p.start === pos && p.end === pos + 1);
    if (i < 0 || !r.depth.has(i)) continue;
    const partner = r.partner.get(i);
    return {
      bracket: pos,
      partner: partner === undefined ? null : (r.pieces[partner]?.start ?? null),
    };
  }
  return null;
}

// ------------------------------------------------------------------ properties and functions

/** A property, or a button's input, as the Properties list shows it. */
export interface PropertyListItem {
  id: Id;
  name: string;
  /** "Number", "List of Text"…; null when the property has an error. */
  type: string | null;
  /** For the icon; null for inputs. */
  propertyType: PropertyKind | null;
  /** A button's Pressed by, Pressed at, This row or a variable. */
  input: boolean;
  /** What picking it puts in the formula. */
  insert: string;
}

const typeOf = (prop: Property, schema: FormulaSchema): string | null => {
  const t = propertyType(prop, schema, 0, (id) => schema.related(id));
  return typeof t === 'string' ? null : typeName(t);
};

const propInsert = (name: string) => `prop(${quoteText(name)})`;

/** The Properties list: the database's properties with their types (not buttons), then the inputs. */
export function propertyList(schema: FormulaSchema): PropertyListItem[] {
  const props = schema.properties
    .filter((p) => p.config.type !== 'button')
    .map((p) => ({
      id: p.id,
      name: p.name,
      type: typeOf(p, schema),
      propertyType: p.config.type,
      input: false,
      insert: propInsert(p.name),
    }));
  const inputs = (schema.inputs ?? []).map((i) => ({
    id: i.id,
    name: i.name,
    type: typeName(i.type),
    propertyType: null,
    input: true,
    insert: propInsert(i.name),
  }));
  return [...props, ...inputs];
}

/** One group of the Functions list. */
export interface FunctionGroup {
  kind: FunctionKind;
  label: string;
  functions: FunctionInfo[];
}

/** The Functions list, grouped as in the spec (a function can be in two groups, like length). */
export function functionGroups(): FunctionGroup[] {
  const all = listFunctions();
  return FUNCTION_KINDS.map((kind) => ({
    kind,
    label: FUNCTION_KIND_LABELS[kind],
    functions: all.filter((f) => f.kinds.includes(kind)),
  })).filter((g) => g.functions.length > 0);
}

/**
 * What picking a function puts in the formula: "round()" with the cursor between the brackets, or
 * "now()" with it after them. As a method (after a dot) the value before the dot is its first input.
 */
export function functionInsert(name: string, method = false): { insert: string; cursor: number } {
  if (name === 'prop') return { insert: 'prop("")', cursor: 6 };
  const def = getFunction(name);
  const most = Math.max(0, ...(def?.signatures.map((s) => inputRange(s)[1]) ?? [0]));
  const inside = most > (method ? 1 : 0);
  const insert = `${name}()`;
  return { insert, cursor: inside ? name.length + 1 : insert.length };
}

// ------------------------------------------------------------------ chips

/** A prop("…") in the formula, shown as a chip with the name and type icon. */
export interface FormulaChip {
  /** From "prop" to its ")"; for row.prop("…"), the part after the dot. */
  start: number;
  end: number;
  /** The quoted part's place, quotes included. */
  keyStart: number;
  keyEnd: number;
  /** A property, a button's input, a deleted property, or nothing this formula can read. */
  kind: 'property' | 'input' | 'deleted' | 'unknown';
  id: Id | null;
  /** The name to show: the property's or input's current name, or what's typed. */
  name: string;
  /** "Number"…; null when unknown or the property has an error. */
  type: string | null;
  /** For the icon; null for inputs and unknown ones. */
  propertyType: PropertyKind | null;
}

/** The databases a formula's rows can come from: this one, related ones, and This row's. */
function reachable(schema: FormulaSchema): FormulaSchema[] {
  const out: FormulaSchema[] = [schema];
  const seen = new Set(out);
  const add = (s: FormulaSchema | null) => {
    if (s && !seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  };
  for (const i of schema.inputs ?? []) if (i.type.kind === 'page') add(i.type.schema);
  for (let k = 0; k < out.length && k < 50; k++) {
    const s = out[k];
    for (const p of s?.properties ?? [])
      if (p.config.type === 'relation') add(s?.related(p.id) ?? null);
  }
  return out;
}

const findById = (schema: FormulaSchema, key: string, own: boolean) =>
  schema.properties.find((p) => p.id === key) ??
  (own ? schema.inputs?.find((i) => i.id === key) : undefined);

const isInput = (x: Property | FormulaInput): x is FormulaInput => !('config' in x);

/** The property chips of a formula as typed (names) or stored (ids). */
export function formulaChips(source: string, schema: FormulaSchema): FormulaChip[] {
  const r = read(source);
  const parsed = parseFormula(source);
  const checked = parsed.ok ? checkFormula(parsed.ast, schema, 'name') : null;
  const refs = new Map((checked?.ok ? checked.refs : []).map((ref) => [ref.start, ref]));
  const others = reachable(schema).slice(1);
  return propCalls(r).map((call): FormulaChip => {
    const key = call.key.value;
    const own = !call.method;
    const place = {
      start: call.start,
      end: call.end,
      keyStart: call.key.start,
      keyEnd: call.key.end,
    };
    const ref = refs.get(call.key.start);
    let found: Property | FormulaInput | undefined;
    let home = schema;
    if (ref?.property && !own) {
      found = ref.property;
      home = others.find((s) => s.properties.includes(ref.property as Property)) ?? schema;
    } else if (own) found = findByName(schema, key, true) ?? findById(schema, key, true);
    else {
      for (const s of others) {
        found = findByName(s, key, false) ?? findById(s, key, false);
        if (found) {
          home = s;
          break;
        }
      }
    }
    if (found && isInput(found)) {
      const t = { type: typeName(found.type), propertyType: null };
      return { ...place, kind: 'input', id: found.id, name: found.name, ...t };
    }
    if (found) {
      const t = { type: typeOf(found, home), propertyType: found.config.type };
      return { ...place, kind: 'property', id: found.id, name: found.name, ...t };
    }
    const gone = [schema, ...others]
      .flatMap((s) => s.deleted ?? [])
      .find((d) => d.id === key || d.name === key);
    const none = { type: null, propertyType: null };
    return gone
      ? { ...place, kind: 'deleted', id: gone.id, name: gone.name, ...none }
      : { ...place, kind: 'unknown', id: null, name: key, ...none };
  });
}

// ------------------------------------------------------------------ suggestions

/** One suggestion. */
export interface FormulaSuggestion {
  kind: 'variable' | 'input' | 'property' | 'function' | 'keyword';
  label: string;
  /** A function's usage ("round(number, places?)"), a property's type ("Number"). */
  detail: string;
  /** For functions; "" otherwise. Screen readers hear it with the label. */
  description: string;
  example: string;
  /** Put in place of the list's from…to; the cursor goes `cursor` characters into it. */
  insert: string;
  cursor: number;
}

/** The suggestions at the cursor and the part of the formula accepting one replaces. */
export interface SuggestionList {
  from: number;
  to: number;
  items: FormulaSuggestion[];
}

const KIND_ORDER = ['variable', 'input', 'property', 'function', 'keyword'] as const;
const squash = (s: string) => s.replace(/\s+/g, '').toLowerCase();

/** 0 exact, 1 starts with it, 2 a word starts with it, 3 has it; null: no match. */
function matchRank(label: string, typed: string): number | null {
  if (!typed) return 1;
  const l = squash(label);
  const t = squash(typed);
  if (l === t) return 0;
  if (l.startsWith(t)) return 1;
  if (
    label
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .some((w) => w.startsWith(t))
  )
    return 2;
  return l.includes(t) ? 3 : null;
}

function rank(items: FormulaSuggestion[], typed: string, limit: number): FormulaSuggestion[] {
  const seen = new Set<string>();
  return items
    .map((item, order) => ({ item, order, rank: matchRank(item.label, typed) }))
    .filter((x): x is typeof x & { rank: number } => x.rank !== null)
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        KIND_ORDER.indexOf(a.item.kind) - KIND_ORDER.indexOf(b.item.kind) ||
        a.order - b.order,
    )
    .map((x) => x.item)
    .filter((item) => {
      const id = `${item.kind}\n${item.label}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .slice(0, limit);
}

const valueItem = (
  kind: 'variable' | 'input' | 'property' | 'keyword',
  label: string,
  detail: string,
  insert = label,
): FormulaSuggestion => ({
  kind,
  label,
  detail,
  description: '',
  example: '',
  insert,
  cursor: insert.length,
});

/** One open bracket around the cursor: the function it calls (if any) and which input it's in. */
interface Frame {
  name: string | null;
  method: boolean;
  input: number;
  /** let/lets names defined so far inside it. */
  names: string[];
}

/** The brackets open at `pos`, outermost first. */
function framesAt(r: Reading, pos: number): Frame[] {
  const frames: Frame[] = [];
  let first = true;
  for (let k = 0; k < r.code.length; k++) {
    const p = codeAt(r, k);
    if (!p || p.end > pos) break;
    const top = frames[frames.length - 1];
    if (p.kind === 'op' && (p.value === '(' || p.value === '[')) {
      const before = codeAt(r, k - 1);
      const name = p.value === '(' && before?.kind === 'name' ? before.value : null;
      frames.push({
        name,
        method: name !== null && isOp(codeAt(r, k - 2), '.'),
        input: 0,
        names: [],
      });
      first = true;
      continue;
    }
    if (p.kind === 'op' && (p.value === ')' || p.value === ']')) {
      frames.pop();
      first = false;
      continue;
    }
    if (top && p.kind === 'op' && p.value === ',') {
      top.input++;
      first = true;
      continue;
    }
    const lets = top?.name === 'let' || top?.name === 'lets';
    const next = codeAt(r, k + 1);
    if (top && lets && first && top.input % 2 === 0 && p.kind === 'name' && isOp(next, ',')) {
      if (next && next.end <= pos) top.names.push(p.value);
    }
    first = false;
  }
  return frames;
}

/** Whether input `input` of a call to `name` is worked out per item (it sees current and index). */
function perItem(frame: Frame): boolean {
  const def = frame.name ? getFunction(frame.name) : undefined;
  const at = frame.input + (frame.method ? 1 : 0);
  return def?.signatures.some((s) => s.params[at]?.each === true) ?? false;
}

/** Properties a row.prop("…") might read: those of related databases and This row's, by name. */
function relatedProperties(schema: FormulaSchema): { prop: Property; home: FormulaSchema }[] {
  const seen = new Set<string>();
  const out: { prop: Property; home: FormulaSchema }[] = [];
  for (const home of reachable(schema).slice(1)) {
    for (const prop of home.properties) {
      if (prop.config.type === 'button' || seen.has(prop.name)) continue;
      seen.add(prop.name);
      out.push({ prop, home });
    }
  }
  return out;
}

/**
 * The suggestions at the cursor. While a name is typed: variables (let names; current and index
 * inside a list function), properties and inputs (accepting one makes prop("Name")), functions and
 * true/false; after a dot, functions only; inside prop("…"), property names. With nothing typed,
 * only when asked (`explicit`, Ctrl+Space). null when there's nothing to suggest.
 */
export function suggestAt(
  source: string,
  cursor: number,
  schema: FormulaSchema,
  options: { explicit?: boolean; limit?: number } = {},
): SuggestionList | null {
  const r = read(source);
  const limit = options.limit ?? 50;
  const at = r.pieces.find((p) => p.start < cursor && cursor <= p.end);
  const inside = at && (cursor < at.end || !at.closed);
  if (at?.kind === 'comment' && inside) return null;
  if (at?.kind === 'text' && inside) return propertyNames(source, r, at, cursor, schema, limit);
  const typing = at?.kind === 'name' ? at : null;
  const typed = typing ? source.slice(typing.start, cursor) : '';
  if (!typed && options.explicit !== true) return null;
  const from = typing ? typing.start : cursor;
  const to = typing ? typing.end : cursor;
  const method = isOp(lastCodeBefore(r, from), '.');
  const fns = listFunctions().map((f): FormulaSuggestion => {
    const { insert, cursor: c } = functionInsert(f.name, method);
    const detail = f.usage[0] ?? `${f.name}()`;
    return {
      kind: 'function',
      label: f.name,
      detail,
      description: f.description,
      example: f.example,
      insert,
      cursor: c,
    };
  });
  if (method) return { from, to, items: rank(fns, typed, limit) };
  const frames = framesAt(r, from);
  const variables = frames.flatMap((f) => f.names).map((n) => valueItem('variable', n, 'let'));
  if (frames.some(perItem)) {
    variables.push(valueItem('variable', 'current', 'The item'));
    variables.push(valueItem('variable', 'index', "The item's position, from 0"));
  }
  const values = propertyList(schema).map((p) =>
    valueItem(p.input ? 'input' : 'property', p.name, p.type ?? '', p.insert),
  );
  const keywords = ['true', 'false'].map((w) => valueItem('keyword', w, 'Checkbox'));
  return {
    from,
    to,
    items: rank([...variables.reverse(), ...values, ...fns, ...keywords], typed, limit),
  };
}

/** Suggestions inside prop("…"): replacing the quoted name, and closing the bracket if needed. */
function propertyNames(
  source: string,
  r: Reading,
  text: Piece,
  cursor: number,
  schema: FormulaSchema,
  limit: number,
): SuggestionList | null {
  const k = r.code.findIndex((i) => r.pieces[i] === text);
  const open = codeAt(r, k - 1);
  const name = codeAt(r, k - 2);
  if (!isOp(open, '(') || name?.kind !== 'name' || name.value !== 'prop') return null;
  const method = isOp(codeAt(r, k - 3), '.');
  const openIndex = r.code[k - 1];
  const closed = openIndex !== undefined && r.partner.has(openIndex);
  const typed = source.slice(text.start + 1, cursor);
  const tail = closed ? '' : ')';
  const item = (kind: 'property' | 'input', label: string, detail: string | null) => {
    const insert = quoteText(label) + tail;
    return valueItem(kind, label, detail ?? '', insert);
  };
  const items = method
    ? relatedProperties(schema).map(({ prop, home }) =>
        item('property', prop.name, typeOf(prop, home)),
      )
    : propertyList(schema).map((p) => item(p.input ? 'input' : 'property', p.name, p.type));
  return { from: text.start, to: text.end, items: rank(items, typed, limit) };
}

// ------------------------------------------------------------------ hover

/** Help for the part of the formula under the pointer. */
export interface FormulaHover {
  start: number;
  end: number;
  title: string;
  /** A function's usage (one line per way to call it), or a property's type. */
  detail: string;
  description: string;
  example: string;
}

/** Help for a function name or a property chip at `offset`; null elsewhere. */
export function hoverAt(
  source: string,
  offset: number,
  schema: FormulaSchema,
): FormulaHover | null {
  const chip = formulaChips(source, schema).find((c) => c.start <= offset && offset < c.end);
  if (chip) {
    const detail = chip.kind === 'deleted' ? 'Deleted' : (chip.type ?? '');
    return {
      start: chip.start,
      end: chip.end,
      title: chip.name,
      detail,
      description: '',
      example: '',
    };
  }
  const r = read(source);
  const k = r.code.findIndex((i) => {
    const p = r.pieces[i];
    return p !== undefined && p.start <= offset && offset < p.end;
  });
  const p = codeAt(r, k);
  const def = p?.kind === 'name' && isOp(codeAt(r, k + 1), '(') ? getFunction(p.value) : undefined;
  if (!p || !def) return null;
  const info = listFunctions().find((f) => f.name === def.name);
  return {
    start: p.start,
    end: p.end,
    title: def.name,
    detail: (info?.usage ?? []).join('\n'),
    description: def.description,
    example: def.example,
  };
}

// ------------------------------------------------------------------ the line under the code

/** Where a problem is, in the formula as typed, for the red wavy line. */
export interface ProblemPlace {
  start: number;
  end: number;
  line: number;
  column: number;
}

/** What the editor shows under the code, and whether Done is on. */
export type FormulaEditorState =
  | {
      ok: true;
      /** What to save: the formula with ids, and its result kind. */
      expression: string;
      kind: ComputedKind | null;
      /** "Number". */
      type: string;
      value: ComputedValue;
      /** "Number · 42"; or, when the preview row gives an error, its message. */
      message: string;
      /** Where the preview's error happened; null when it worked. */
      problem: ProblemPlace | null;
      /** EDITOR_MESSAGES.noRows when there was no row to preview. */
      note: string | null;
    }
  | { ok: false; message: string; problem: ProblemPlace };

/** What the preview runs on: the current (or first) row, null when there are none. */
export interface EditorPreview {
  row: Row | null;
  ctx: FormulaContext;
  /** A button's input values (see button-inputs). */
  inputs?: FormulaInputs;
}

const placeOf = (source: string, e: Pick<FormulaError, 'start' | 'end'>): ProblemPlace => ({
  start: e.start,
  end: e.end,
  ...lineAndColumn(source, e.start),
});

/** A row with every value empty, for previews when there are no rows. */
function emptyRow(ctx: FormulaContext): Row {
  const now = ctx.viewer.now.toISOString();
  return {
    id: '',
    title: '',
    values: {},
    createdAt: now,
    createdBy: null,
    editedAt: now,
    editedBy: null,
    uniqueNumber: null,
  };
}

/**
 * "Number · 42": the result's type and its value as a cell shows it (lists: 100 items, then
 * "+12 more"; checkboxes true or false). An empty result shows "Number · Empty".
 */
export function resultLabel(type: FormulaType, value: ComputedValue, ctx: FormulaContext): string {
  const name = typeName(type);
  if (type.kind === 'empty') return name;
  if (value.kind === 'error') return value.message;
  if (isEmpty(value)) return `${name} · Empty`;
  if (value.kind === 'boolean') return `${name} · ${value.value ? 'true' : 'false'}`;
  const cells: EvalContext = {
    properties: ctx.properties,
    viewer: ctx.viewer,
    userName: (id) => ctx.userName(id),
    rowTitle: (id) => (ctx.rowTitle ? ctx.rowTitle(id) : ctx.page(id)?.row.title),
    ...(ctx.isRemovedUser ? { isRemovedUser: (id: Id) => ctx.isRemovedUser?.(id) === true } : {}),
  };
  return `${name} · ${formatComputed(value, null, cells)}`;
}

/**
 * Checks the formula as typed and previews it: Done is on only when `ok`. A problem comes with its
 * place and line ("Missing ')' at line 2"); a valid formula with its type and the preview's value.
 */
export function editorState(
  source: string,
  schema: FormulaSchema,
  preview: EditorPreview,
): FormulaEditorState {
  const stored = toStoredFormula(source, schema);
  if (!stored.ok) {
    return { ok: false, message: stored.error.message, problem: placeOf(source, stored.error) };
  }
  const compiled = compileFormula(source, schema, 'name');
  if (!compiled.ok) {
    return { ok: false, message: compiled.error.message, problem: placeOf(source, compiled.error) };
  }
  const row = preview.row ?? emptyRow(preview.ctx);
  const { value, error } = compiled.preview(row, preview.ctx, preview.inputs);
  return {
    ok: true,
    expression: stored.expression,
    kind: stored.kind,
    type: typeName(compiled.type),
    value,
    message: resultLabel(compiled.type, value, preview.ctx),
    problem: value.kind === 'error' && error ? placeOf(source, error) : null,
    note: preview.row ? null : EDITOR_MESSAGES.noRows,
  };
}

/**
 * For screen readers (§6: they hear errors when they appear): the message to announce when the
 * state changes to a problem or to a different problem; null otherwise.
 */
export function announcement(
  before: FormulaEditorState | null,
  after: FormulaEditorState,
): string | null {
  if (after.ok && !after.problem) return null;
  return before?.message === after.message ? null : after.message;
}
