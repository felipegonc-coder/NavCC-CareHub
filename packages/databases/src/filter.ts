/**
 * Filters (Databases spec v2, 3.2 and 3.4; additions 2, 10 and 11): the conditions each property
 * offers and their labels, matching rows, the filter bar, and checking, cleaning and counting
 * saved filters.
 *
 * Condition values are in stored form: option, user and row ids; exact decimals (a Percent
 * property's 45% is "0.45"); DateRef, { start, end } and DateWindow for dates. ME in a person
 * condition means whoever is looking.
 */
import { computedKind } from './computed';
import {
  dateValueDays,
  formatDateValue,
  isCalendarDate,
  isValidDateValue,
  resolveDateRef,
  resolveDateWindow,
  todayIn,
} from './dates';
import { compareDecimal, fitsNumberLimits, normalizeDecimal } from './decimal';
import { fromPlainText, plainText } from './richtext';
import { findProperty, isEmptyValue, readValue, type ReadValue } from './row';
import { foldText } from './text';
import {
  FILTER_OPS,
  LIMITS,
  ME,
  STATUS_GROUPS,
  type CalendarDate,
  type ChecklistItem,
  type ComputedKind,
  type ComputedValue,
  type DateRef,
  type DateWindow,
  type EvalContext,
  type FilterCondition,
  type FilterGroup,
  type FilterNode,
  type FilterOp,
  type Id,
  type Property,
  type RelativeDay,
  type RichText,
  type Row,
  type SelectOption,
  type StatusGroup,
  type Viewer,
  type WeekDay,
} from './types';

// ---------------------------------------------------------------- operators and labels

const EMPTY_OPS = ['is_empty', 'is_not_empty'] as const;
const COMPARE_OPS = ['eq', 'neq', 'gt', 'lt', 'gte', 'lte'] as const;
type TextOp = 'is' | 'is_not' | 'contains' | 'does_not_contain' | 'starts_with' | 'ends_with';
type CompareOp = (typeof COMPARE_OPS)[number];

/** The conditions each kind of property offers, in menu order. */
const OPS = {
  text: ['is', 'is_not', 'contains', 'does_not_contain', 'starts_with', 'ends_with', ...EMPTY_OPS],
  number: [...COMPARE_OPS, ...EMPTY_OPS],
  // Spec 3.4: an ID always has a number, so it offers the comparisons only.
  unique_id: COMPARE_OPS,
  select: ['is', 'is_not', ...EMPTY_OPS],
  status: ['is', 'is_not', 'group_is', ...EMPTY_OPS],
  multi: ['contains_any', 'contains_all', 'does_not_contain', ...EMPTY_OPS],
  person: ['contains_any', 'does_not_contain', ...EMPTY_OPS],
  relation: ['contains_any', 'does_not_contain', ...EMPTY_OPS],
  date: ['is', 'before', 'after', 'on_or_before', 'on_or_after', 'between', 'within', ...EMPTY_OPS],
  checkbox: ['is_checked', 'is_not_checked'],
  checklist: ['all_done', 'not_all_done', ...EMPTY_OPS],
  files: EMPTY_OPS,
  // Additions 2: lists match any item's text.
  list: ['contains', 'does_not_contain', ...EMPTY_OPS],
  none: [],
} satisfies Record<string, readonly FilterOp[]>;
/** How a property filters. Formulas and rollups filter like their result kind. */
type Family = keyof typeof OPS;
const opsOf = (family: Family): readonly FilterOp[] => OPS[family];

const KIND_FAMILY: Record<ComputedKind, Family> = {
  text: 'text',
  number: 'number',
  boolean: 'checkbox',
  date: 'date',
  person: 'person',
  page: 'relation',
  list: 'list',
};

/** null: a formula whose result kind isn't known (it has an error), so its conditions can't be judged. */
function familyOf(prop: Property): Family | null {
  switch (prop.config.type) {
    case 'title':
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
      return 'text';
    case 'multi_select':
      return 'multi';
    case 'person':
    case 'created_by':
    case 'edited_by':
      return 'person';
    case 'date':
    case 'created_time':
    case 'edited_time':
      return 'date';
    case 'formula':
    case 'rollup': {
      const kind = computedKind(prop);
      return kind ? KIND_FAMILY[kind] : null;
    }
    case 'button':
      return 'none';
    default:
      return prop.config.type;
  }
}

const LABELS: Record<FilterOp, string> = {
  is: 'Is',
  is_not: 'Is not',
  contains: 'Contains',
  does_not_contain: 'Does not contain',
  starts_with: 'Starts with',
  ends_with: 'Ends with',
  eq: 'Equals',
  neq: 'Not equal',
  gt: 'Greater than',
  lt: 'Less than',
  gte: 'At least',
  lte: 'At most',
  group_is: 'Group is',
  contains_any: 'Contains any of',
  contains_all: 'Contains all of',
  before: 'Is before',
  after: 'Is after',
  on_or_before: 'Is on or before',
  on_or_after: 'Is on or after',
  between: 'Is between',
  within: 'Is within',
  is_checked: 'Is ticked',
  is_not_checked: 'Is not ticked',
  all_done: 'All done',
  not_all_done: 'Not all done',
  is_empty: 'Is empty',
  is_not_empty: 'Is not empty',
};

/**
 * The conditions a property offers, in menu order (spec 3.4). Formulas and rollups follow their
 * result kind, and ID filters as a number. Empty for buttons and for formulas with an error.
 */
export function filterOpsFor(prop: Property): FilterOp[] {
  const family = familyOf(prop);
  return family ? [...opsOf(family)] : [];
}

/**
 * The menu text for a condition, in the spec's words (3.4): "Contains", "At least", "Is within",
 * "Is ticked"... Select and Status say "Is" and "Is not" and take a list of options (any of).
 */
export function filterOpLabel(op: FilterOp): string {
  return LABELS[op];
}

// ---------------------------------------------------------------- condition values

/** The input a condition's value needs: what the filter menu shows and what validateFilter expects. */
export type FilterValueKind =
  | 'none'
  | 'text'
  | 'number'
  | 'options'
  | 'status_groups'
  | 'people'
  | 'rows'
  | 'date'
  | 'date_range'
  | 'date_window';

const NO_VALUE_OPS = new Set<FilterOp>([
  'is_checked',
  'is_not_checked',
  'all_done',
  'not_all_done',
  ...EMPTY_OPS,
]);

/** The kind of value a condition takes: "none" for is ticked, all done, is empty and the like. */
export function filterValueKind(prop: Property, op: FilterOp): FilterValueKind {
  if (NO_VALUE_OPS.has(op)) return 'none';
  switch (familyOf(prop)) {
    case 'text':
    case 'list':
      return 'text';
    case 'number':
    case 'unique_id':
      return 'number';
    case 'select':
    case 'multi':
      return 'options';
    case 'status':
      return op === 'group_is' ? 'status_groups' : 'options';
    case 'person':
      return 'people';
    case 'relation':
      return 'rows';
    case 'date':
      return op === 'between' ? 'date_range' : op === 'within' ? 'date_window' : 'date';
    default:
      return 'none';
  }
}

const RELATIVE_DAYS: Record<RelativeDay, true> = {
  today: true,
  tomorrow: true,
  yesterday: true,
  one_week_ago: true,
  one_week_from_now: true,
  one_month_ago: true,
  one_month_from_now: true,
};
const WINDOWS: Record<Extract<DateWindow, string>, true> = {
  this_week: true,
  last_week: true,
  next_week: true,
  this_month: true,
  last_month: true,
  next_month: true,
  this_year: true,
  last_year: true,
  next_year: true,
  past_7_days: true,
  next_7_days: true,
  past_30_days: true,
  next_30_days: true,
};
const WINDOW_UNITS = new Set<unknown>(['day', 'week', 'month', 'year']);
const STATUS_GROUP_SET = new Set<unknown>(STATUS_GROUPS);
const OP_SET = new Set<unknown>(FILTER_OPS);
/** Longest "past or next N days, weeks, months or years" a condition can ask for. */
const MAX_WINDOW_COUNT = 1000;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isKey = (o: object, key: unknown): boolean =>
  typeof key === 'string' && Object.hasOwn(o, key);
const isIdList = (v: unknown): v is Id[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string' && x !== '');
const isDateRef = (v: unknown): v is DateRef =>
  isObj(v) && ('exact' in v ? isCalendarDate(v.exact) : isKey(RELATIVE_DAYS, v.relative));

function isDateWindow(v: unknown): v is DateWindow {
  if (typeof v === 'string') return isKey(WINDOWS, v);
  if (!isObj(v) || (v.direction !== 'past' && v.direction !== 'next')) return false;
  const n = v.count;
  return (
    WINDOW_UNITS.has(v.unit) &&
    Number.isInteger(n) &&
    (n as number) >= 1 &&
    (n as number) <= MAX_WINDOW_COUNT
  );
}

/** No value yet: the condition is being set up, so it doesn't filter anything. */
const isUnset = (v: unknown): boolean =>
  v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

function valueFits(kind: FilterValueKind, v: unknown): boolean {
  switch (kind) {
    case 'none':
      return true;
    case 'text':
      return typeof v === 'string' && v.length <= LIMITS.text;
    case 'number':
      return typeof v === 'string' && normalizeDecimal(v) !== null;
    case 'options':
    case 'people':
    case 'rows':
      return isIdList(v) && v.length <= LIMITS.relationLinks;
    case 'status_groups':
      return Array.isArray(v) && v.every((g) => STATUS_GROUP_SET.has(g));
    case 'date':
      return isDateRef(v);
    case 'date_range':
      return isObj(v) && isDateRef(v.start) && isDateRef(v.end);
    case 'date_window':
      return isDateWindow(v);
  }
}

/** Why a condition doesn't fit its property: the operator, the value, or nothing (null). */
function problemOf(c: FilterCondition, prop: Property): 'op' | 'value' | null {
  const family = familyOf(prop);
  if (family === null) return null; // a formula with an error: its conditions wait until it's fixed
  if (!opsOf(family).includes(c.op)) return 'op';
  const kind = filterValueKind(prop, c.op);
  return kind === 'none' || isUnset(c.value) || valueFits(kind, c.value) ? null : 'value';
}

// ---------------------------------------------------------------- matching rows

type Test = (row: Row) => boolean;
/** The calendar days a value covers for the viewer (its start day alone for most conditions). */
type Days = { start: CalendarDate; end: CalendarDate };
/** -1, 0 or 1 against the condition's number; "empty" for no value; null when it isn't a number. */
type Comparison = -1 | 0 | 1 | 'empty' | null;

const TEXT_TESTS: Record<TextOp, (value: string, query: string) => boolean> = {
  is: (v, q) => v === q,
  is_not: (v, q) => v !== q,
  contains: (v, q) => v.includes(q),
  does_not_contain: (v, q) => !v.includes(q),
  starts_with: (v, q) => v.startsWith(q),
  ends_with: (v, q) => v.endsWith(q),
};
// Empty values match the negative conditions ("is not", "≠", "does not contain"), as in Notion.
const COMPARE_TESTS: Record<CompareOp, (c: Comparison) => boolean> = {
  eq: (c) => c === 0,
  neq: (c) => c !== 0 && c !== null,
  gt: (c) => c === 1,
  lt: (c) => c === -1,
  gte: (c) => c === 0 || c === 1,
  lte: (c) => c === 0 || c === -1,
};

const computedOf = (v: ReadValue): ComputedValue | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v ? v : null;

/** The text of a text-like value ("" when empty); null for a formula error. */
function textOf(v: ReadValue): string | null {
  if (v === null) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return plainText(v as RichText);
  const c = computedOf(v);
  return c?.kind === 'text' ? c.value : c?.kind === 'empty' ? '' : null;
}

/** The text of each item of a list result (people by name, rows by title); null for an error. */
function itemTexts(v: ComputedValue, ctx: EvalContext, out: string[] = []): string[] | null {
  switch (v.kind) {
    case 'error':
      return null;
    case 'text':
      out.push(v.value);
      break;
    case 'number':
    case 'boolean':
      out.push(String(v.value));
      break;
    case 'date':
      if (isValidDateValue(v.value))
        out.push(formatDateValue(v.value, { format: 'full', viewer: ctx.viewer }));
      break;
    case 'person':
      out.push(ctx.userName(v.value) ?? '');
      break;
    case 'page':
      out.push(ctx.rowTitle?.(v.value) ?? '');
      break;
    case 'list':
      for (const item of v.value) if (item.kind !== 'error') itemTexts(item, ctx, out);
      break;
    case 'empty':
      break;
  }
  return out;
}

function compareNumber(v: ReadValue, d: string, n: number): Comparison {
  if (v === null) return 'empty';
  if (typeof v === 'string') return compareDecimal(v, d);
  const c = computedOf(v);
  if (c?.kind === 'empty') return 'empty';
  if (c?.kind !== 'number' || Number.isNaN(c.value)) return null;
  return c.value < n ? -1 : c.value > n ? 1 : 0;
}

/** Ids in a multi-select, person or relation value ([] when empty); null for a formula error. */
function idsOf(v: ReadValue): Id[] | null {
  if (v === null) return [];
  if (Array.isArray(v)) return v as Id[];
  const c = computedOf(v);
  if (c?.kind === 'person' || c?.kind === 'page') return [c.value];
  return c?.kind === 'empty' ? [] : null;
}

function daysOf(v: ReadValue, timeZone: string): Days | null {
  const c = computedOf(v);
  const date = c ? (c.kind === 'date' ? c.value : null) : v;
  return isValidDateValue(date) ? dateValueDays(date, timeZone) : null;
}

function checkedOf(v: ReadValue): boolean | null {
  if (typeof v === 'boolean') return v;
  const c = computedOf(v);
  return c?.kind === 'boolean' ? c.value : c?.kind === 'empty' ? false : null;
}

/** Text with no characters is empty too; everything else as isEmptyValue (an error isn't empty). */
const isEmpty = (prop: Property, v: ReadValue): boolean =>
  prop.config.type === 'text' ? textOf(v) === '' : isEmptyValue(v);

const DAY_TESTS: Partial<Record<FilterOp, (day: CalendarDate, ref: CalendarDate) => boolean>> = {
  is: (d, r) => d === r,
  before: (d, r) => d < r,
  after: (d, r) => d > r,
  on_or_before: (d, r) => d <= r,
  on_or_after: (d, r) => d >= r,
};

function dateTest(
  op: FilterOp,
  value: unknown,
  today: CalendarDate,
  weekStart: WeekDay,
): (d: Days) => boolean {
  const test = DAY_TESTS[op];
  if (test) {
    const ref = resolveDateRef(value as DateRef, today);
    return (d) => test(d.start, ref);
  }
  let range: Days;
  if (op === 'within') {
    range = resolveDateWindow(value as DateWindow, today, weekStart);
  } else {
    const v = value as { start: DateRef; end: DateRef };
    const [a, b] = [resolveDateRef(v.start, today), resolveDateRef(v.end, today)];
    range = a <= b ? { start: a, end: b } : { start: b, end: a };
  }
  // A date with an end matches if any of its days is inside.
  return (d) => d.start <= range.end && d.end >= range.start;
}

/** A test for one condition, or null when it doesn't filter (deleted property, unusable operator, no value yet). */
function compileCondition(c: FilterCondition, ctx: EvalContext, today: CalendarDate): Test | null {
  const prop = findProperty(ctx.properties, c.propertyId);
  const family = prop ? familyOf(prop) : null;
  if (!prop || !family || !opsOf(family).includes(c.op)) return null;
  const read = (row: Row): ReadValue => readValue(row, prop, ctx);
  if (c.op === 'is_empty' || c.op === 'is_not_empty') {
    const want = c.op === 'is_empty';
    return (row) => isEmpty(prop, read(row)) === want;
  }
  const kind = filterValueKind(prop, c.op);
  if (kind !== 'none' && (isUnset(c.value) || !valueFits(kind, c.value))) return null;
  switch (family) {
    case 'text': {
      const query = foldText(c.value as string);
      const test = TEXT_TESTS[c.op as TextOp];
      return (row) => {
        const text = textOf(read(row));
        return text !== null && test(foldText(text), query);
      };
    }
    case 'list': {
      const query = foldText(c.value as string);
      const want = c.op === 'contains';
      return (row) => {
        const value = computedOf(read(row));
        const items = value ? itemTexts(value, ctx) : null;
        return items !== null && items.some((t) => foldText(t).includes(query)) === want;
      };
    }
    case 'number':
    case 'unique_id': {
      const d = normalizeDecimal(c.value as string) ?? '0';
      const test = COMPARE_TESTS[c.op as CompareOp];
      return (row) => test(compareNumber(read(row), d, Number(d)));
    }
    case 'select':
    case 'status': {
      if (c.op === 'group_is') {
        const groups = new Set(c.value as StatusGroup[]);
        const options = prop.config.type === 'status' ? prop.config.options : [];
        const groupOf = new Map(options.map((o) => [o.id, o.group]));
        return (row) => {
          const g = groupOf.get(read(row) as Id);
          return g !== undefined && groups.has(g);
        };
      }
      const ids = new Set(c.value as Id[]);
      const want = c.op === 'is';
      return (row) => {
        const id = read(row);
        return (typeof id === 'string' && ids.has(id)) === want;
      };
    }
    case 'multi':
    case 'person':
    case 'relation': {
      const me = ctx.viewer.userId;
      const want = new Set(
        (c.value as Id[]).map((id) => (family === 'person' && id === ME ? me : id)),
      );
      // Related rows the viewer can't open never count (spec 3.4), so filters can't reveal them.
      const openOnly = family === 'relation' && ctx.rowTitle !== undefined;
      return (row) => {
        const all = idsOf(read(row));
        if (all === null) return false;
        const ids = openOnly ? all.filter((id) => ctx.rowTitle?.(id) !== undefined) : all;
        if (c.op === 'contains_all') return [...want].every((id) => ids.includes(id));
        return ids.some((id) => want.has(id)) === (c.op === 'contains_any');
      };
    }
    case 'date': {
      const test = dateTest(c.op, c.value, today, ctx.viewer.weekStart);
      return (row) => {
        const days = daysOf(read(row), ctx.viewer.timeZone);
        return days !== null && test(days);
      };
    }
    case 'checkbox': {
      const want = c.op === 'is_checked';
      return (row) => checkedOf(read(row)) === want;
    }
    case 'checklist': {
      const want = c.op === 'all_done';
      return (row) => {
        const items = read(row) as ChecklistItem[] | null;
        return !!items?.length && items.every((i) => i.done === true) === want;
      };
    }
    default:
      return null;
  }
}

function compileNode(node: FilterNode, ctx: EvalContext, today: CalendarDate): Test | null {
  if (node.kind === 'condition') return compileCondition(node, ctx, today);
  const tests = node.children
    .map((child) => compileNode(child, ctx, today))
    .filter((t): t is Test => t !== null);
  if (tests.length <= 1) return tests[0] ?? null;
  return node.combinator === 'or'
    ? (row) => tests.some((t) => t(row))
    : (row) => tests.every((t) => t(row));
}

/**
 * A row test for a filter, prepared once for many rows (the server's query, the web's instant
 * feedback). Conditions that don't filter yet (no value, a deleted property, an operator the
 * property no longer offers) are skipped, and so are groups with nothing left: they never hide
 * rows, even inside "Any of". Dates use the viewer's time zone and week start.
 */
export function filterPredicate(
  filter: FilterGroup | null,
  ctx: EvalContext,
): (row: Row) => boolean {
  const test = filter ? compileNode(filter, ctx, todayIn(ctx.viewer)) : null;
  return test ?? (() => true);
}

/** True if the row matches the view's filter (null: no filter). For many rows, use filterPredicate. */
export function matchesFilter(row: Row, filter: FilterGroup | null, ctx: EvalContext): boolean {
  return filterPredicate(filter, ctx)(row);
}

// ---------------------------------------------------------------- checking and cleaning

const INVALID = "This filter isn't valid.";

/**
 * Checks a filter from a request: its shape, up to 3 layers and 50 conditions, each condition's
 * property, operator and value. Conditions with no value yet are fine. Returns the problem or null.
 */
export function validateFilter(
  filter: FilterGroup | null,
  properties: readonly Property[],
): string | null {
  let conditions = 0;
  const walk = (node: unknown, depth: number): string | null => {
    if (!isObj(node) || typeof node.id !== 'string') return INVALID;
    if (node.kind === 'group') {
      if (depth > LIMITS.filterDepth) return `Filters can have up to ${LIMITS.filterDepth} layers.`;
      if (
        (node.combinator !== 'and' && node.combinator !== 'or') ||
        !Array.isArray(node.children)
      ) {
        return INVALID;
      }
      for (const child of node.children as unknown[]) {
        const problem = walk(child, depth + 1);
        if (problem) return problem;
      }
      return null;
    }
    if (node.kind !== 'condition' || depth === 1) return INVALID;
    if (typeof node.propertyId !== 'string' || !OP_SET.has(node.op)) return INVALID;
    if (++conditions > LIMITS.filterConditions) {
      return `Filters can have up to ${LIMITS.filterConditions} conditions.`;
    }
    const c = node as unknown as FilterCondition;
    const prop = findProperty(properties, c.propertyId);
    if (!prop) return 'A filter uses a property that was deleted.';
    const problem = problemOf(c, prop);
    if (problem === 'op') return `"${prop.name}" can't be filtered with "${filterOpLabel(c.op)}".`;
    if (problem === 'value') return `The filter on "${prop.name}" has a value that doesn't fit.`;
    return null;
  };
  return filter === null ? null : walk(filter, 1);
}

/**
 * Drops conditions on deleted properties and conditions whose operator or value no longer fits
 * the property (after a type change), then groups left empty by that; null if nothing is left.
 * Conditions on a formula with an error are kept until it's fixed. Returns the same object when
 * nothing changes.
 */
export function pruneFilter(
  filter: FilterGroup | null,
  properties: readonly Property[],
): FilterGroup | null {
  const fits = (c: FilterCondition): boolean => {
    const prop = findProperty(properties, c.propertyId);
    return prop !== undefined && problemOf(c, prop) === null;
  };
  const prune = (group: FilterGroup): FilterGroup | null => {
    const children: FilterNode[] = [];
    let changed = false;
    for (const child of group.children) {
      const kept = child.kind === 'group' ? prune(child) : fits(child) ? child : null;
      if (kept !== child) changed = true;
      if (kept) children.push(kept);
    }
    if (!changed) return group;
    return children.length ? { ...group, children } : null;
  };
  return filter && prune(filter);
}

/** Conditions in a filter, nested groups included (the limit is 50). */
export function countConditions(filter: FilterNode | null): number {
  if (!filter) return 0;
  if (filter.kind === 'condition') return 1;
  return filter.children.reduce((n, child) => n + countConditions(child), 0);
}

/**
 * How the filter bar shows a view's filter (spec 3.2): "chips" (one chip per condition) for an
 * "All of" filter of plain conditions; otherwise ("Any of", nested groups) "advanced", the single
 * "Advanced filter" chip; "none" with no conditions or groups.
 */
export type FilterBarMode = 'none' | 'chips' | 'advanced';

export function filterBarMode(filter: FilterGroup | null): FilterBarMode {
  if (!filter?.children.length) return 'none';
  const plain = filter.children.every((child) => child.kind === 'condition');
  return plain && filter.combinator === 'and' ? 'chips' : 'advanced';
}

// ---------------------------------------------------------------- new rows

/** The stored value that makes a new row match one simple condition, or undefined. */
function prefillValue(
  prop: Property,
  c: FilterCondition,
  userId: Id,
  today: CalendarDate,
): unknown {
  if (familyOf(prop) === null || problemOf(c, prop) !== null) return undefined;
  const config = prop.config;
  const v = c.value;
  switch (config.type) {
    case 'title':
    case 'text':
    case 'url':
    case 'email':
    case 'phone': {
      // "Contains" gives a whole value only for free text.
      const free = config.type === 'title' || config.type === 'text';
      if (typeof v !== 'string' || v === '' || !(c.op === 'is' || (c.op === 'contains' && free))) {
        return undefined;
      }
      return config.type === 'text' ? fromPlainText(v) : v;
    }
    case 'number': {
      const d = c.op === 'eq' && typeof v === 'string' ? normalizeDecimal(v) : null;
      return d !== null && fitsNumberLimits(d) ? d : undefined;
    }
    case 'select':
    case 'status':
    case 'multi_select': {
      const options: readonly SelectOption[] = config.options;
      const known = isIdList(v) ? v.filter((id) => options.some((o) => o.id === id)) : [];
      if (!known.length) return undefined;
      if (config.type === 'multi_select') {
        return c.op === 'contains_all'
          ? known
          : c.op === 'contains_any'
            ? known.slice(0, 1)
            : undefined;
      }
      return c.op === 'is' ? known[0] : undefined;
    }
    case 'date':
      return c.op === 'is' && isDateRef(v)
        ? { start: resolveDateRef(v, today), end: null, hasTime: false }
        : undefined;
    case 'checkbox':
      return c.op === 'is_checked' ? true : undefined;
    case 'person':
      return c.op === 'contains_any' && isIdList(v) && v.some((id) => id === ME || id === userId)
        ? [userId]
        : undefined;
    default:
      return undefined;
  }
}

/**
 * Values for a new row so it matches the view's simple filters (spec 3.2): the top-level
 * conditions of an "All of" filter (or a filter with one condition) that say "is" (Name, Text,
 * Link, Email, Phone, Select, Status, Date), "equals" (Number), "contains" (Name and Text; Multi-select
 * any of or all of), "is ticked", or "Person contains Me". Keys are property ids; the Name
 * property's value is the title text. Values are in stored form and still go through
 * validateValue before they're saved.
 */
export function prefillFromFilter(
  filter: FilterGroup | null,
  properties: readonly Property[],
  viewer: Pick<Viewer, 'userId' | 'now' | 'timeZone'>,
): Record<Id, unknown> {
  const values: Record<Id, unknown> = {};
  if (!filter || (filter.combinator !== 'and' && filter.children.length > 1)) return values;
  const today = todayIn(viewer);
  for (const node of filter.children) {
    if (node.kind !== 'condition') continue;
    const prop = findProperty(properties, node.propertyId);
    const value = prop ? prefillValue(prop, node, viewer.userId, today) : undefined;
    if (!prop || value === undefined) continue;
    const before = values[prop.id];
    if (Array.isArray(before) && Array.isArray(value) && prop.config.type === 'multi_select') {
      values[prop.id] = [...new Set([...before, ...value])];
    } else if (!Object.hasOwn(values, prop.id)) {
      values[prop.id] = value;
    }
  }
  return values;
}
