/**
 * Runs checked formulas. compileFormula parses and checks a stored formula once; run() then works
 * it out for any row. Limits (security): more than LIMITS.formulaSteps steps or
 * LIMITS.formulaListItems list items give "This formula is too complex."; a text past
 * MAX_TEXT_LENGTH, or more than ROW_TEXT_LIMIT characters built for one row, gives "This formula
 * makes too much text."; with ctx.clock or ctx.budget, more than LIMITS.formulaTimeMs for a row, or
 * passing the request's deadline, gives "⚠ Too slow".
 */
import { decimalToNumber } from '../decimal';
import { plainText } from '../richtext';
import { readValue } from '../row';
import { LIMITS } from '../types';
import type {
  ChecklistItem,
  ComputedKind,
  ComputedValue,
  DateValue,
  FileRef,
  Id,
  Property,
  RichText,
  Row,
} from '../types';
import { LENGTH_MESSAGE, checkFormula, type Expr } from './check';
import { resultKindOf } from './kinds';
import { parseFormula } from './parser';
import {
  EMPTY,
  FormulaFailure,
  ROW_TEXT_LIMIT,
  TOO_COMPLEX,
  TOO_MUCH_TEXT,
  TOO_SLOW,
  bool,
  compareValues,
  fail,
  isEmpty,
  joinTexts,
  num,
  txt,
  withMeter,
  type Call,
  type FormulaBudget,
  type FormulaContext,
  type FormulaError,
  type FormulaSchema,
  type FormulaType,
  type FunctionDef,
} from './registry';

/** A compiled formula. */
export interface CompiledFormula {
  ok: true;
  /** The result kind to save as the property's resultKind (null: always empty). */
  kind: ComputedKind | null;
  type: FormulaType;
  /** The value for a row; a problem comes back as { kind: "error" } with its message. */
  run(row: Row, ctx: FormulaContext): ComputedValue;
  /** The value and, for a problem, where in the formula it happened (the editor's preview). */
  preview(row: Row, ctx: FormulaContext): { value: ComputedValue; error: FormulaError | null };
}

/** A compiled formula, or the first problem with its place. */
export type CompileResult = CompiledFormula | { ok: false; error: FormulaError };

/** Shown when something unexpected stops a formula. */
export const FORMULA_BROKE = "This formula couldn't be worked out.";

interface Frame {
  row: Row;
  ctx: FormulaContext;
  slots: ComputedValue[];
  steps: number;
  /** When the row stops with "⚠ Too slow", on the context's clock; null without a time limit. */
  deadline: number | null;
  nextClock: number;
  budget: FormulaBudget | null;
  /** Property values read so far, so reading one again builds nothing new. */
  reads: Map<Row, Map<Id, ComputedValue>>;
}

type Run = (f: Frame) => ComputedValue;

/** The time on the context's clock, or Date.now without one. */
const timeOf = (ctx: FormulaContext): number => (ctx.clock ? ctx.clock() : Date.now());

function tick(f: Frame, n: number): void {
  f.steps += n;
  if (f.steps > LIMITS.formulaSteps) fail(TOO_COMPLEX);
  if (f.deadline !== null && f.steps >= f.nextClock) {
    f.nextClock = f.steps + 64;
    const now = timeOf(f.ctx);
    if (now > f.deadline) {
      if (f.budget && now > f.budget.deadline) f.budget.spent = true;
      fail(TOO_SLOW);
    }
  }
}

/** Items in a list, counting the items of lists inside it, and the characters of text it holds. */
interface ListSize {
  items: number;
  chars: number;
}

/**
 * Items a list may hold counting the items of lists inside it. Lists can share items, so without
 * this a list of 10,000 copies of a 10,000-item list would be small to make but huge to send.
 */
const NESTED_ITEMS = 10 * LIMITS.formulaListItems;
const listSizes = new WeakMap<readonly ComputedValue[], ListSize>();

/** A list's size, counted up to just past the limits. */
function sizeOf(items: readonly ComputedValue[]): ListSize {
  const known = listSizes.get(items);
  if (known) return known;
  const size: ListSize = { items: 0, chars: 0 };
  for (const v of items) {
    size.items += 1;
    if (v.kind === 'text') size.chars += v.value.length;
    else if (v.kind === 'list') {
      const inner = sizeOf(v.value);
      size.items += inner.items;
      size.chars += inner.chars;
    }
    if (size.items > NESTED_ITEMS || size.chars > ROW_TEXT_LIMIT) break;
  }
  listSizes.set(items, size);
  return size;
}

function listOf(items: ComputedValue[]): ComputedValue {
  if (items.length > LIMITS.formulaListItems) fail(TOO_COMPLEX);
  const size = sizeOf(items);
  if (size.items > NESTED_ITEMS) fail(TOO_COMPLEX);
  if (size.chars > ROW_TEXT_LIMIT) fail(TOO_MUCH_TEXT);
  return { kind: 'list', value: items };
}

const KIND_NAMES: Record<ComputedValue['kind'], string> = {
  empty: 'Empty',
  text: 'Text',
  number: 'Number',
  boolean: 'Checkbox',
  date: 'Date',
  person: 'Person',
  page: 'Row',
  list: 'List',
  error: 'an error',
};

class CallImpl implements Call {
  readonly types: readonly FormulaType[];
  readonly resultType: FormulaType;
  private readonly frame: Frame;
  private readonly def: FunctionDef;
  private readonly args: readonly Run[];
  private readonly slots: { current: number; index: number } | null;
  private readonly memo: (ComputedValue | undefined)[] = [];

  constructor(frame: Frame, e: Extract<Expr, { op: 'call' }>, args: readonly Run[]) {
    this.frame = frame;
    this.def = e.def;
    this.args = args;
    this.slots = e.slots;
    this.types = e.args.map((a) => a.type);
    this.resultType = e.type;
  }

  get row(): Row {
    return this.frame.row;
  }
  get ctx(): FormulaContext {
    return this.frame.ctx;
  }
  get count(): number {
    return this.args.length;
  }

  value(i: number): ComputedValue {
    const known = this.memo[i];
    if (known) return known;
    const run = this.args[i];
    const v = run ? run(this.frame) : EMPTY;
    if (v.kind === 'error') fail(v.message);
    this.memo[i] = v;
    return v;
  }

  each(i: number, current: ComputedValue, index: number): ComputedValue {
    const run = this.args[i];
    if (!run || !this.slots) return EMPTY;
    this.frame.slots[this.slots.current] = current;
    this.frame.slots[this.slots.index] = num(index);
    const v = run(this.frame);
    if (v.kind === 'error') fail(v.message);
    return v;
  }

  private wrong(want: string, v: ComputedValue): never {
    return fail(`${this.def.name}() needs ${want} here; it gets ${KIND_NAMES[v.kind]}.`);
  }

  number(i: number): number | null {
    const v = this.value(i);
    if (v.kind === 'number') return v.value;
    return isEmpty(v) ? null : this.wrong('Number', v);
  }

  text(i: number): string | null {
    const v = this.value(i);
    if (v.kind === 'text') return v.value === '' ? null : v.value;
    return isEmpty(v) ? null : this.wrong('Text', v);
  }

  date(i: number): DateValue | null {
    const v = this.value(i);
    if (v.kind === 'date') return v.value;
    return isEmpty(v) ? null : this.wrong('Date', v);
  }

  list(i: number): readonly ComputedValue[] | null {
    const v = this.value(i);
    if (v.kind === 'list') return v.value.length ? v.value : null;
    return isEmpty(v) ? null : this.wrong('List', v);
  }

  bool(i: number): boolean {
    const v = this.value(i);
    if (v.kind === 'boolean') return v.value;
    return isEmpty(v) ? false : this.wrong('Checkbox', v);
  }

  makeList(items: ComputedValue[]): ComputedValue {
    return listOf(items);
  }

  step(n: number): void {
    tick(this.frame, n);
  }

  timeUp(): boolean {
    const f = this.frame;
    if (f.deadline === null) return false;
    const now = timeOf(f.ctx);
    if (now <= f.deadline) return false;
    if (f.budget && now > f.budget.deadline) f.budget.spent = true;
    return true;
  }
}

const propertyCache = new WeakMap<readonly Property[], Map<Id, Property>>();

/** The property as the row's database has it now (options may have been renamed since saving). */
function currentProperty(properties: readonly Property[], saved: Property): Property {
  let byId = propertyCache.get(properties);
  if (!byId) {
    byId = new Map(properties.map((p) => [p.id, p]));
    propertyCache.set(properties, byId);
  }
  const p = byId.get(saved.id);
  return p && p.config.type === saved.config.type ? p : saved;
}

const dateOnly = (v: DateValue): DateValue => {
  const out: DateValue = { start: v.start, end: v.end, hasTime: v.hasTime };
  if (v.timeZone) out.timeZone = v.timeZone;
  return out;
};
const textOrEmpty = (s: string | null): ComputedValue => (s ? txt(s) : EMPTY);
const listOrEmpty = (items: ComputedValue[]): ComputedValue =>
  items.length ? { kind: 'list', value: items } : EMPTY;

/** A property's value as a formula sees it. */
export function readProperty(row: Row, ctx: FormulaContext, prop: Property): ComputedValue {
  const c = prop.config;
  const raw = readValue(row, prop, ctx);
  switch (c.type) {
    case 'title':
    case 'url':
    case 'email':
    case 'phone':
      return textOrEmpty(raw as string | null);
    case 'text':
      return textOrEmpty(plainText(raw as RichText | null));
    case 'number':
      return raw === null ? EMPTY : num(decimalToNumber(raw as string));
    case 'select':
    case 'status': {
      const option = c.options.find((o) => o.id === raw);
      return option ? txt(option.name) : EMPTY;
    }
    case 'multi_select': {
      const ids = (raw as Id[] | null) ?? [];
      const names = ids.flatMap((id) =>
        c.options.filter((o) => o.id === id).map((o) => txt(o.name)),
      );
      return listOrEmpty(names);
    }
    case 'date':
    case 'created_time':
    case 'edited_time':
      return raw === null ? EMPTY : { kind: 'date', value: dateOnly(raw as DateValue) };
    case 'checkbox':
      return bool(raw === true);
    case 'person':
      return listOrEmpty(((raw as Id[] | null) ?? []).map((id) => ({ kind: 'person', value: id })));
    case 'created_by':
    case 'edited_by': {
      const [id] = (raw as Id[] | null) ?? [];
      return id ? { kind: 'person', value: id } : EMPTY;
    }
    case 'files':
      return listOrEmpty(((raw as FileRef[] | null) ?? []).map((f) => txt(f.name)));
    case 'relation': {
      const ids = ((raw as Id[] | null) ?? []).filter((id) => ctx.page(id) !== null);
      return listOrEmpty(ids.map((id) => ({ kind: 'page', value: id })));
    }
    case 'checklist': {
      const items = (raw as ChecklistItem[] | null) ?? [];
      return items.length ? num(items.filter((i) => i.done).length / items.length) : EMPTY;
    }
    case 'unique_id':
      if (raw === null) return EMPTY;
      return c.prefix ? txt(`${c.prefix}-${String(raw)}`) : num(Number(raw));
    case 'formula':
    case 'rollup': {
      const v = raw as ComputedValue;
      return v.kind === 'error' ? fail(v.message) : v;
    }
    case 'button':
      return EMPTY;
  }
}

function compile(e: Expr): Run {
  const run = build(e);
  return (f) => {
    tick(f, 1);
    try {
      return run(f);
    } catch (err) {
      if (err instanceof FormulaFailure && !err.at) err.at = { start: e.start, end: e.end };
      throw err;
    }
  };
}

function build(e: Expr): Run {
  switch (e.op) {
    case 'value': {
      const v = e.value;
      return () => v;
    }
    case 'list': {
      const items = e.items.map(compile);
      return (f) => listOf(items.map((r) => r(f)));
    }
    case 'var': {
      const slot = e.slot;
      return (f) => f.slots[slot] ?? EMPTY;
    }
    case 'let': {
      const value = compile(e.value);
      const body = compile(e.body);
      const slot = e.slot;
      return (f) => {
        f.slots[slot] = value(f);
        return body(f);
      };
    }
    case 'neg': {
      const operand = compile(e.operand);
      return (f) => {
        const v = operand(f);
        return v.kind === 'number' ? num(-v.value) : EMPTY;
      };
    }
    case 'add': {
      const left = compile(e.left);
      const right = compile(e.right);
      if (e.text) return (f) => joinTexts([left(f), right(f)]);
      return (f) => {
        const a = left(f);
        const b = right(f);
        return a.kind === 'number' && b.kind === 'number' ? num(a.value + b.value) : EMPTY;
      };
    }
    case 'compare': {
      const left = compile(e.left);
      const right = compile(e.right);
      const cmp = e.cmp;
      return (f) => {
        const a = left(f);
        const b = right(f);
        if (isEmpty(a) || isEmpty(b)) return bool(false);
        const c = compareValues(a, b, f.ctx) ?? 0;
        return bool(cmp === '>' ? c > 0 : cmp === '>=' ? c >= 0 : cmp === '<' ? c < 0 : c <= 0);
      };
    }
    case 'prop': {
      const saved = e.property;
      const page = e.page ? compile(e.page) : null;
      return (f) => {
        if (!page) return read(f, f.row, f.ctx, saved);
        const p = page(f);
        const found = p.kind === 'page' ? f.ctx.page(p.value) : null;
        if (!found) return EMPTY;
        return read(f, found.row, found.ctx, saved);
      };
    }
    case 'call': {
      const args = e.args.map(compile);
      const def = e.def;
      return (f) => def.evaluate(new CallImpl(f, e, args));
    }
  }
}

/** A property's value for a row, read once per evaluation. */
function read(f: Frame, row: Row, ctx: FormulaContext, saved: Property): ComputedValue {
  let values = f.reads.get(row);
  if (!values) f.reads.set(row, (values = new Map()));
  let v = values.get(saved.id);
  if (!v) {
    v = readProperty(row, ctx, currentProperty(ctx.properties, saved));
    values.set(saved.id, v);
  }
  return v;
}

/** Parses, checks and prepares a stored formula (property references by id). */
export function compileFormula(expression: string, schema: FormulaSchema): CompileResult {
  if (expression.length > LIMITS.formulaLength) {
    const error = { message: LENGTH_MESSAGE, start: LIMITS.formulaLength, end: expression.length };
    return { ok: false, error };
  }
  const parsed = parseFormula(expression);
  if (!parsed.ok) return parsed;
  const checked = checkFormula(parsed.ast, schema, 'id');
  if (!checked.ok) return checked;
  const run: Run = checked.expr ? compile(checked.expr) : () => EMPTY;
  const slotCount = checked.slots;
  const tooSlow = {
    value: { kind: 'error', message: TOO_SLOW } as ComputedValue,
    error: { message: TOO_SLOW, start: 0, end: expression.length },
  };
  const preview = (row: Row, ctx: FormulaContext) => {
    const budget = ctx.budget ?? null;
    if (budget?.spent) return tooSlow;
    let deadline: number | null = null;
    if (ctx.clock || budget) {
      const now = timeOf(ctx);
      if (budget && now > budget.deadline) {
        budget.spent = true;
        return tooSlow;
      }
      deadline = Math.min(now + LIMITS.formulaTimeMs, budget ? budget.deadline : Infinity);
    }
    const slots = new Array<ComputedValue>(slotCount).fill(EMPTY);
    const frame: Frame = {
      row,
      ctx,
      slots,
      steps: 0,
      deadline,
      nextClock: 64,
      budget,
      reads: new Map(),
    };
    const meter = { text: ROW_TEXT_LIMIT, step: (n: number) => tick(frame, n) };
    try {
      return { value: withMeter(meter, () => run(frame)), error: null };
    } catch (err) {
      const failure = err instanceof FormulaFailure;
      const message = failure ? err.message : FORMULA_BROKE;
      const at = (failure && err.at) || { start: 0, end: expression.length };
      return { value: { kind: 'error', message } as ComputedValue, error: { message, ...at } };
    }
  };
  return {
    ok: true,
    kind: resultKindOf(checked.type),
    type: checked.type,
    run: (row, ctx) => preview(row, ctx).value,
    preview,
  };
}
