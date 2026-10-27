/**
 * Grouping rows (spec 3.2–3.3; additions 11): which groups a row is in, a view's groups in order,
 * and what dragging a card to another group, or "+ New" in a group, writes.
 *
 * A row with several values (multi-select, people, relations, lists) is in each of their groups.
 * "No value" comes first unless it was placed by hand. Links to rows the viewer can't open all go
 * in one "Rows you can't open" group, so their titles and ids stay hidden.
 */
import { computedKind } from './computed';
import {
  addDays,
  dateValueStartDay,
  daysBetween,
  formatCalendarDate,
  parseCalendarDate,
  startOfWeek,
  todayIn,
} from './dates';
import {
  formatDecimal,
  fromScaled,
  isCanonicalDecimal,
  numberToDecimal,
  toScaled,
} from './decimal';
import { fromPlainText, plainText } from './richtext';
import { findProperty, readValue, type ReadValue } from './row';
import { isStoredType } from './schema';
import { compareSortKeys, type SortKey } from './sort';
import { foldText } from './text';
import {
  EMPTY_GROUP,
  LIMITS,
  STATUS_GROUPS,
  type CalendarDate,
  type ComputedValue,
  type ConfigOf,
  type DateValue,
  type EvalContext,
  type Grouping,
  type Id,
  type NumberDisplay,
  type OptionColor,
  type Property,
  type RichText,
  type Row,
  type SelectOption,
  type StatusGroup,
} from './types';

/** One group of a view: a board column, or a group of table, list or gallery rows. */
export interface RowGroup {
  /**
   * Saved in Grouping.order and Grouping.hidden: an option id, a status group, EMPTY_GROUP,
   * NO_ACCESS_GROUP, "true" or "false", a user or row id, a date bucket ("2026-10-26", "2026-10",
   * "2026", "today", "past_7_days"), a text, its first letter, or a number range's lower bound
   * ("below" and "above" outside it).
   */
  key: string;
  /** The header: "No value", "Checked", "Week of Oct 25, 2026", "October 2026", "0–10"... */
  label: string;
  /** The option's color; status groups are To-do gray, In progress blue and Complete green. */
  color?: OptionColor;
  /** The group's rows, in the order they were given. */
  rows: Row[];
  /** Hidden in this view (Grouping.hidden). */
  hidden: boolean;
  /** Remembers, per person, that the group is collapsed: the property, the grouping mode and the key. */
  collapsedKey: string;
}

/** What a move or "+ New" writes: one property's new stored value (null clears it). */
export interface GroupValue {
  propertyId: Id;
  value: unknown;
}

/** Key of the group holding links to rows the viewer can't open: "Rows you can't open". */
export const NO_ACCESS_GROUP = '__no_access__';

/** Status groups as their headers say (spec 3.4). */
export const STATUS_GROUP_LABELS: Record<StatusGroup, string> = {
  todo: 'To-do',
  in_progress: 'In progress',
  complete: 'Complete',
};
const STATUS_GROUP_COLORS: Record<StatusGroup, OptionColor> = {
  todo: 'gray',
  in_progress: 'blue',
  complete: 'green',
};

const MONTH = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/**
 * Relative date groups, oldest to newest (spec 3.2). Today, Tomorrow and Yesterday have their own
 * groups, so "Next 7 days" holds 2 to 6 days ahead and "Next 30 days" 7 to 29 (spec 3.4).
 */
const RELATIVE = [
  ['older', 'Older'],
  ['past_30_days', 'Past 30 days'],
  ['past_7_days', 'Past 7 days'],
  ['yesterday', 'Yesterday'],
  ['today', 'Today'],
  ['tomorrow', 'Tomorrow'],
  ['next_7_days', 'Next 7 days'],
  ['next_30_days', 'Next 30 days'],
  ['later', 'Later'],
] as const;

/** Name, Files, Checklist, ID and Button can't be grouped by. */
const UNGROUPABLE = new Set('title files checklist unique_id button'.split(' '));
const TEXT_TYPES = new Set('title text url email phone'.split(' '));
/** Types with a value in every row (anonymous responses aside), so boards don't list "No value". */
const NEVER_EMPTY = new Set('checkbox created_time edited_time created_by edited_by'.split(' '));
/** Empty number ranges are listed (boards) only up to this many. */
const MAX_LISTED_RANGES = 100n;

/**
 * True for the types a view can group by (spec 3.2): everything except Name, Files, Checklist,
 * ID and Button. A formula needs a result kind (one without an error).
 */
export function canGroupBy(prop: Property): boolean {
  if (prop.config.type === 'formula') return prop.config.resultKind !== null;
  return !UNGROUPABLE.has(prop.config.type);
}

// ---------------------------------------------------------------- buckets

interface Bucket {
  key: string;
  label: string;
  color?: OptionColor;
  /** Position A→Z: names and text A→Z, numbers and dates in order, Unchecked first. */
  rank: SortKey;
  /** Position in option order (options and status groups). */
  index?: number;
}
type Entry = Bucket & { rows: Row[] };

interface Range {
  start: bigint;
  end: bigint;
  step: bigint;
  count: bigint;
}
type NumberShape = Pick<NumberDisplay, 'format' | 'decimals' | 'currency'>;
type OptionAtom = { kind: 'option'; option: SelectOption; index: number; group?: StatusGroup };
type Atom =
  | OptionAtom
  | { kind: 'boolean'; value: boolean }
  | { kind: 'person'; id: Id }
  | { kind: 'page'; id: Id }
  | { kind: 'text'; value: string }
  | { kind: 'number'; value: string }
  | { kind: 'date'; value: DateValue };

interface Setup {
  prop: Property;
  grouping: Grouping;
  ctx: EvalContext;
  today: CalendarDate | null;
  range: Range | null;
  number: NumberShape | null;
  options: Map<Id, OptionAtom>;
}

const num = (value: number | bigint): SortKey => ({ rank: 1, value });
const txt = (value: string): SortKey => ({ rank: 3, value });
/** "2026-10-26" → 20261026, "2026-10" → 202610: grows with the date. */
const dateNumber = (key: string): number => Number(key.split('-').join(''));

const UNCHECKED: Bucket = { key: 'false', label: 'Unchecked', rank: num(0) };
const CHECKED: Bucket = { key: 'true', label: 'Checked', rank: num(1) };
const NO_ACCESS: Bucket = { key: NO_ACCESS_GROUP, label: "Rows you can't open", rank: num(0) };

const isDateValue = (v: unknown): v is DateValue =>
  typeof v === 'object' && v !== null && 'start' in v && 'hasTime' in v;
const isComputed = (v: unknown): v is ComputedValue =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v;
const strings = (v: ReadValue): Id[] =>
  Array.isArray(v) ? (v as readonly unknown[]).filter((x): x is Id => typeof x === 'string') : [];

function rangeOf(r: Grouping['numberRange']): Range | null {
  if (!r) return null;
  const [a, b, c] = [r.start, r.end, r.step].map(numberToDecimal);
  if (a == null || b == null || c == null) return null;
  const start = toScaled(a);
  const end = toScaled(b);
  const step = toScaled(c);
  if (step <= 0n || end <= start) return null;
  return { start, end, step, count: (end - start + step - 1n) / step };
}

/** Today in the viewer's time zone, from the injected `now`; null for an unknown time zone. */
function todayOf(ctx: EvalContext): CalendarDate | null {
  try {
    return todayIn(ctx.viewer);
  } catch {
    return null;
  }
}

function setupFor(grouping: Grouping, ctx: EvalContext): Setup | null {
  const prop = findProperty(ctx.properties, grouping.propertyId);
  if (!prop) return null;
  const c = prop.config;
  const options = new Map<Id, OptionAtom>();
  if (c.type === 'status') {
    for (const [index, o] of c.options.entries())
      if (!options.has(o.id))
        options.set(o.id, { kind: 'option', option: o, index, group: o.group });
  } else if (c.type === 'select' || c.type === 'multi_select') {
    for (const [index, o] of c.options.entries())
      if (!options.has(o.id)) options.set(o.id, { kind: 'option', option: o, index });
  }
  const number =
    c.type === 'number' ? c : c.type === 'formula' || c.type === 'rollup' ? c.number : null;
  return {
    prop,
    grouping,
    ctx,
    today: todayOf(ctx),
    range: rangeOf(grouping.numberRange),
    number,
    options,
  };
}

function computedAtoms(v: ComputedValue): Atom[] {
  switch (v.kind) {
    case 'text':
      return v.value ? [{ kind: 'text', value: v.value }] : [];
    case 'number': {
      const d = numberToDecimal(v.value);
      return d === null ? [] : [{ kind: 'number', value: d }];
    }
    case 'boolean':
      return [{ kind: 'boolean', value: v.value }];
    case 'date':
      return isDateValue(v.value) ? [{ kind: 'date', value: v.value }] : [];
    case 'person':
      return [{ kind: 'person', id: v.value }];
    case 'page':
      return [{ kind: 'page', id: v.value }];
    case 'list':
      return v.value.flatMap(computedAtoms);
    case 'empty':
    case 'error':
      return [];
  }
}

/** The separate values a row has for the grouping property. */
function atomsOf(s: Setup, v: ReadValue): Atom[] {
  const t = s.prop.config.type;
  switch (t) {
    case 'select':
    case 'multi_select':
    case 'status':
      return (Array.isArray(v) ? strings(v) : typeof v === 'string' ? [v] : []).flatMap((id) => {
        const atom = s.options.get(id);
        return atom ? [atom] : [];
      });
    case 'checkbox':
      return [{ kind: 'boolean', value: v === true }];
    case 'person':
    case 'created_by':
    case 'edited_by':
      return strings(v).map((id): Atom => ({ kind: 'person', id }));
    case 'relation':
      return strings(v).map((id): Atom => ({ kind: 'page', id }));
    case 'title':
    case 'url':
    case 'email':
    case 'phone':
    case 'text': {
      const value = t === 'text' ? (Array.isArray(v) ? plainText(v as RichText) : '') : v;
      return typeof value === 'string' && value ? [{ kind: 'text', value }] : [];
    }
    case 'number':
    case 'unique_id':
      return isCanonicalDecimal(v) ? [{ kind: 'number', value: v }] : [];
    case 'date':
    case 'created_time':
    case 'edited_time':
      return isDateValue(v) ? [{ kind: 'date', value: v }] : [];
    case 'formula':
    case 'rollup':
      return isComputed(v) ? computedAtoms(v) : [];
    case 'files':
    case 'checklist':
    case 'button':
      return [];
  }
}

function emptyBucket(prop: Property | undefined): Bucket {
  const t = prop?.config.type;
  // No Created by or Edited by means an anonymous form response (additions 8).
  const label = t === 'created_by' || t === 'edited_by' ? 'Anonymous' : 'No value';
  return { key: EMPTY_GROUP, label, rank: num(-1) };
}

function statusGroupBucket(g: StatusGroup): Bucket | null {
  const index = STATUS_GROUPS.indexOf(g);
  if (index < 0) return null;
  const label = STATUS_GROUP_LABELS[g];
  return { key: g, label, color: STATUS_GROUP_COLORS[g], rank: txt(label), index };
}

function formatNumber(d: string, f: NumberShape | null, decimals?: 'auto'): string {
  if (f) {
    try {
      return formatDecimal(d, {
        format: f.format,
        decimals: decimals ?? f.decimals,
        currency: f.currency,
      });
    } catch {
      // An unknown currency code: fall back to the plain number.
    }
  }
  return formatDecimal(d, { format: 'number', decimals: 'auto' });
}

function rangeBucket(i: bigint, r: Range, f: NumberShape | null): Bucket {
  const lo = r.start + i * r.step;
  const hi = lo + r.step < r.end ? lo + r.step : r.end;
  const key = fromScaled(lo);
  return {
    key,
    label: `${formatNumber(key, f, 'auto')}–${formatNumber(fromScaled(hi), f, 'auto')}`,
    rank: num(i),
  };
}

/** Exact values, or ranges of `step` from `start`; the last range includes `end`. */
function numberBucket(d: string, s: Setup): Bucket {
  const r = s.range;
  if (!r) return { key: d, label: formatNumber(d, s.number), rank: num(toScaled(d)) };
  const v = toScaled(d);
  if (v < r.start)
    return {
      key: 'below',
      label: `< ${formatNumber(fromScaled(r.start), s.number, 'auto')}`,
      rank: num(-1),
    };
  if (v > r.end)
    return {
      key: 'above',
      label: `> ${formatNumber(fromScaled(r.end), s.number, 'auto')}`,
      rank: num(r.count),
    };
  const i = (v - r.start) / r.step;
  return rangeBucket(i < r.count ? i : r.count - 1n, r, s.number);
}

function textBucket(value: string, by: Grouping['textBy']): Bucket {
  if (by !== 'alphabetical') return { key: value, label: value, rank: txt(value) };
  const first = [...foldText(value.trim())][0] ?? '';
  const letter = /\p{L}/u.test(first) ? first.toUpperCase() : '#';
  return { key: letter, label: letter, rank: txt(letter) };
}

function relativeBucket(day: CalendarDate, today: CalendarDate): Bucket {
  const d = daysBetween(today, day);
  const i =
    d <= -30 ? 0 : d <= -7 ? 1 : d <= -2 ? 2 : d <= 1 ? d + 4 : d <= 6 ? 6 : d <= 29 ? 7 : 8;
  const [key, label] = RELATIVE[i] ?? RELATIVE[4];
  return { key, label, rank: num(i) };
}

function dateBucket(v: DateValue, s: Setup): Bucket | null {
  let day: CalendarDate;
  try {
    day = dateValueStartDay(v, s.ctx.viewer.timeZone);
  } catch {
    return null;
  }
  if (!parseCalendarDate(day)) return null;
  switch (s.grouping.dateBucket ?? 'relative') {
    case 'day':
      return { key: day, label: formatCalendarDate(day, 'full'), rank: num(dateNumber(day)) };
    case 'week': {
      const w = startOfWeek(day, s.ctx.viewer.weekStart);
      return {
        key: w,
        label: `Week of ${formatCalendarDate(w, 'full')}`,
        rank: num(dateNumber(w)),
      };
    }
    case 'month': {
      const key = day.slice(0, 7);
      const label = MONTH.format(Date.parse(`${key}-01T00:00:00Z`));
      return { key, label, rank: num(dateNumber(key)) };
    }
    case 'year':
      return {
        key: day.slice(0, 4),
        label: day.slice(0, 4),
        rank: num(dateNumber(day.slice(0, 4))),
      };
    case 'relative':
      return s.today ? relativeBucket(day, s.today) : null;
  }
}

function bucketOf(a: Atom, s: Setup): Bucket | null {
  switch (a.kind) {
    case 'option':
      if (a.group && s.grouping.statusBy === 'group') return statusGroupBucket(a.group);
      return {
        key: a.option.id,
        label: a.option.name,
        color: a.option.color,
        rank: txt(a.option.name),
        index: a.index,
      };
    case 'boolean':
      return a.value ? CHECKED : UNCHECKED;
    case 'person': {
      const name = s.ctx.userName(a.id);
      if (name === undefined) return null;
      const label = s.ctx.isRemovedUser?.(a.id) ? `${name} (removed)` : name;
      return { key: a.id, label, rank: txt(name) };
    }
    case 'page': {
      const title = s.ctx.rowTitle?.(a.id);
      if (title === undefined) return NO_ACCESS;
      const label = title || 'Untitled';
      return { key: a.id, label, rank: txt(label) };
    }
    case 'text':
      return textBucket(a.value, s.grouping.textBy);
    case 'number':
      return numberBucket(a.value, s);
    case 'date':
      return dateBucket(a.value, s);
  }
}

function bucketsOf(row: Row, s: Setup | null): Bucket[] {
  if (!s) return [emptyBucket(undefined)];
  const out = new Map<string, Bucket>();
  for (const atom of atomsOf(s, readValue(row, s.prop, s.ctx))) {
    const b = bucketOf(atom, s);
    if (b && !out.has(b.key)) out.set(b.key, b);
  }
  return out.size ? [...out.values()] : [emptyBucket(s.prop)];
}

/** Every group a board lists even without rows: options, status groups, both checkbox groups, number ranges. */
function allBuckets(s: Setup): Bucket[] {
  const t = s.prop.config.type;
  const kind = computedKind(s.prop);
  const out: Bucket[] = NEVER_EMPTY.has(t) ? [] : [emptyBucket(s.prop)];
  if (t === 'status' && s.grouping.statusBy === 'group') {
    for (const g of STATUS_GROUPS) out.push(statusGroupBucket(g) ?? NO_ACCESS);
  } else {
    for (const atom of s.options.values()) out.push(bucketOf(atom, s) ?? emptyBucket(s.prop));
  }
  if (t === 'checkbox' || kind === 'boolean') out.push(UNCHECKED, CHECKED);
  const numeric = t === 'number' || t === 'unique_id' || kind === 'number';
  if (numeric && s.range && s.range.count <= MAX_LISTED_RANGES) {
    for (let i = 0n; i < s.range.count; i++) out.push(rangeBucket(i, s.range, s.number));
  }
  return out;
}

/** The setting that decides what the keys mean, so collapsed groups don't carry over when it changes. */
function modeOf(g: Grouping, prop: Property | undefined): string {
  if (!prop) return 'value';
  const t = prop.config.type;
  const kind = computedKind(prop);
  if (t === 'status') return g.statusBy ?? 'option';
  if (t === 'date' || t === 'created_time' || t === 'edited_time' || kind === 'date')
    return g.dateBucket ?? 'relative';
  if (TEXT_TYPES.has(t) || kind === 'text') return g.textBy ?? 'exact';
  if (t === 'number' || t === 'unique_id' || kind === 'number')
    return g.numberRange ? 'range' : 'value';
  return 'value';
}

type ValueOrder = 'option' | 'asc' | 'desc';

/** Option order for Select, Multi-select and Status; relative dates newest first; else A→Z. */
function defaultOrder(prop: Property | undefined, mode: string): ValueOrder {
  const t = prop?.config.type;
  if (t === 'select' || t === 'multi_select' || t === 'status') return 'option';
  return mode === 'relative' ? 'desc' : 'asc';
}

/** "No value" first and "Rows you can't open" last, then option order, A→Z or Z→A. */
function byValue(order: ValueOrder): (a: Entry, b: Entry) => number {
  const edge = (e: Entry): number =>
    e.key === EMPTY_GROUP ? -1 : e.key === NO_ACCESS_GROUP ? 1 : 0;
  return (a, b) => {
    const e = edge(a) - edge(b);
    if (e) return e;
    if (order === 'option' && a.index !== undefined && b.index !== undefined)
      return a.index - b.index;
    const c = compareSortKeys(a.rank, b.rank) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
    return order === 'desc' ? -c : c;
  };
}

function ordered(entries: Entry[], g: Grouping, prop: Property | undefined, mode: string): Entry[] {
  const fallback = defaultOrder(prop, mode);
  const sort = g.sort === 'asc' || g.sort === 'desc' || g.sort === 'manual' ? g.sort : fallback;
  if (sort !== 'manual') return entries.sort(byValue(sort));
  const place = new Map<string, number>();
  for (const [i, key] of (g.order ?? []).entries()) if (!place.has(key)) place.set(key, i);
  const at = (e: Entry): number => place.get(e.key) ?? 0;
  const placed = entries.filter((e) => place.has(e.key)).sort((a, b) => at(a) - at(b));
  const rest = entries.filter((e) => !place.has(e.key)).sort(byValue(fallback));
  // "No value" stays first unless placed; new groups go at the end.
  return [
    ...rest.filter((e) => e.key === EMPTY_GROUP),
    ...placed,
    ...rest.filter((e) => e.key !== EMPTY_GROUP),
  ];
}

// ---------------------------------------------------------------- public

/**
 * The keys of the groups a row is in: one per value (a multi-select with two options is in two
 * groups), or [EMPTY_GROUP] when it has none. Links to rows the viewer can't open give
 * NO_ACCESS_GROUP, once. A deleted grouping property puts every row in "No value".
 */
export function groupKeysOf(row: Row, grouping: Grouping, ctx: EvalContext): string[] {
  return bucketsOf(row, setupFor(grouping, ctx)).map((b) => b.key);
}

/**
 * A view's groups in order, each with its rows in the order given (sort the rows first).
 *
 * `sort`: "option" (option order), "asc" (A→Z: names and text A→Z, numbers and dates in order,
 * Unchecked first), "desc" (Z→A) or "manual" (`order` first, new groups at the end in the default
 * order). Unset: option order for Select, Multi-select and Status, newest first for relative dates,
 * A→Z for everything else. "No value" comes first and "Rows you can't open" last unless placed by
 * hand. `includeEmptyGroups` (boards) also lists every option, status group, checkbox group and
 * number range without rows; `hideEmpty` drops groups without rows. Sub-groups: call it again on
 * each group's rows with the sub-grouping.
 */
export function groupRows(
  rows: readonly Row[],
  grouping: Grouping,
  ctx: EvalContext,
  opts: { includeEmptyGroups?: boolean } = {},
): RowGroup[] {
  const s = setupFor(grouping, ctx);
  const entries = new Map<string, Entry>();
  const entry = (b: Bucket): Entry => {
    let e = entries.get(b.key);
    if (!e) {
      e = { ...b, rows: [] };
      entries.set(b.key, e);
    }
    return e;
  };
  if (opts.includeEmptyGroups && s) for (const b of allBuckets(s)) entry(b);
  for (const row of rows) for (const b of bucketsOf(row, s)) entry(b).rows.push(row);
  const hidden = new Set(grouping.hidden ?? []);
  const mode = modeOf(grouping, s?.prop);
  const prefix = `${grouping.propertyId}:${mode}:`;
  return ordered([...entries.values()], grouping, s?.prop, mode)
    .filter((e) => !grouping.hideEmpty || e.rows.length > 0)
    .map((e) => {
      const group: RowGroup = {
        key: e.key,
        label: e.label,
        rows: e.rows,
        hidden: hidden.has(e.key),
        collapsedKey: prefix + e.key,
      };
      if (e.color) group.color = e.color;
      return group;
    });
}

/** The option a status group stands for: the default option if it's in that group, else the group's first. */
function statusOptionFor(c: ConfigOf<'status'>, group: string): SelectOption | undefined {
  const fallback = c.options.find((o) => o.id === c.defaultOptionId);
  return fallback?.group === group ? fallback : c.options.find((o) => o.group === group);
}

/** Replaces the value dragged from with the target (or adds it), keeping the other values. */
function replaced(
  row: Row,
  prop: Property,
  ctx: EvalContext,
  from: string,
  to: string,
  max: number,
): GroupValue | null {
  const c = prop.config;
  let current = strings(readValue(row, prop, ctx));
  if (c.type === 'multi_select')
    current = current.filter((id) => c.options.some((o) => o.id === id));
  const next = [
    ...new Set(
      current.includes(from) ? current.map((id) => (id === from ? to : id)) : [...current, to],
    ),
  ];
  return next.length > max ? null : { propertyId: prop.id, value: next };
}

/**
 * What dragging a row from one group to another writes, or null if that can't change its value.
 * Select, Status (an option, or a status group's default or first option), Checkbox, one-person
 * Person and one-row Relation are set; Multi-select, Person and Relation replace the value dragged
 * from and keep the others; exact text and number groups set that value; dropping on "No value"
 * clears it. Date, letter, number-range, automatic, formula and rollup groups can't be moved, nor
 * can rows into or out of "Rows you can't open" (links the viewer can't see stay as they are).
 */
export function groupMovePatch(
  row: Row,
  grouping: Grouping,
  fromKey: string,
  toKey: string,
  ctx: EvalContext,
): GroupValue | null {
  const prop = findProperty(ctx.properties, grouping.propertyId);
  if (!prop || fromKey === toKey || fromKey === NO_ACCESS_GROUP || toKey === NO_ACCESS_GROUP)
    return null;
  const c = prop.config;
  const set = (value: unknown): GroupValue => ({ propertyId: prop.id, value });
  const clear = toKey === EMPTY_GROUP;
  switch (c.type) {
    case 'select':
      return clear ? set(null) : c.options.some((o) => o.id === toKey) ? set(toKey) : null;
    case 'status': {
      if (clear) return set(null);
      if (grouping.statusBy !== 'group')
        return c.options.some((o) => o.id === toKey) ? set(toKey) : null;
      const current = c.options.find((o) => o.id === readValue(row, prop, ctx));
      const option = statusOptionFor(c, toKey);
      return option && current?.group !== toKey ? set(option.id) : null;
    }
    case 'checkbox':
      return toKey === 'true' || toKey === 'false' ? set(toKey === 'true') : null;
    case 'multi_select':
      if (clear) return set(null);
      return c.options.some((o) => o.id === toKey)
        ? replaced(row, prop, ctx, fromKey, toKey, LIMITS.multiSelectValues)
        : null;
    case 'person':
    case 'relation':
      if (clear) return set(null);
      if (c.single) return set([toKey]);
      return replaced(
        row,
        prop,
        ctx,
        fromKey,
        toKey,
        c.type === 'relation' ? LIMITS.relationLinks : Infinity,
      );
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
      if (grouping.textBy === 'alphabetical') return null;
      return set(clear ? null : c.type === 'text' ? fromPlainText(toKey) : toKey);
    case 'number':
      if (rangeOf(grouping.numberRange)) return null;
      return clear ? set(null) : isCanonicalDecimal(toKey) ? set(toKey) : null;
    default:
      return null;
  }
}

function dayForGroup(key: string, g: Grouping, ctx: EvalContext): CalendarDate | null {
  const mode = g.dateBucket ?? 'relative';
  const today = mode === 'relative' ? todayOf(ctx) : '';
  if (today === null) return null;
  const day =
    mode === 'month'
      ? `${key}-01`
      : mode === 'year'
        ? `${key}-01-01`
        : mode !== 'relative'
          ? key
          : key === 'today'
            ? today
            : key === 'tomorrow'
              ? addDays(today, 1)
              : key === 'yesterday'
                ? addDays(today, -1)
                : null;
  return day !== null && parseCalendarDate(day) ? day : null;
}

/**
 * What "+ New" in a group fills in, or null when the group doesn't stand for one value.
 * Options, people, rows, checkbox, exact text and numbers give that value; date groups give their
 * day (a week its first day, a month or year its first; Today, Tomorrow and Yesterday);
 * "No value" gives null for properties that can be cleared.
 */
export function valueForGroup(
  grouping: Grouping,
  key: string,
  ctx: EvalContext,
): GroupValue | null {
  const prop = findProperty(ctx.properties, grouping.propertyId);
  if (!prop || key === NO_ACCESS_GROUP) return null;
  const c = prop.config;
  const set = (value: unknown): GroupValue => ({ propertyId: prop.id, value });
  if (key === EMPTY_GROUP)
    return isStoredType(c.type) && !['title', 'checkbox', 'files', 'checklist'].includes(c.type)
      ? set(null)
      : null;
  switch (c.type) {
    case 'select':
      return c.options.some((o) => o.id === key) ? set(key) : null;
    case 'status': {
      const option =
        grouping.statusBy === 'group'
          ? statusOptionFor(c, key)
          : c.options.find((o) => o.id === key);
      return option ? set(option.id) : null;
    }
    case 'multi_select':
      return c.options.some((o) => o.id === key) ? set([key]) : null;
    case 'person':
    case 'relation':
      return set([key]);
    case 'checkbox':
      return key === 'true' || key === 'false' ? set(key === 'true') : null;
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
      return grouping.textBy === 'alphabetical'
        ? null
        : set(c.type === 'text' ? fromPlainText(key) : key);
    case 'number':
      return rangeOf(grouping.numberRange) || !isCanonicalDecimal(key) ? null : set(key);
    case 'date': {
      const day = dayForGroup(key, grouping, ctx);
      return day ? set({ start: day, end: null, hasTime: false }) : null;
    }
    default:
      return null;
  }
}
