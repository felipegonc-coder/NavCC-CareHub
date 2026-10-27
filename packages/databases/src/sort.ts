/**
 * Sorting rows (spec 3.4 "Sorts by"; additions 2 and 10).
 *
 * Text sorts A→Z ignoring case and accents, with numbers in natural order; numbers exactly; Select
 * and Status by option order; Multi-select by its first value's option order; dates by their start
 * (a date without a time counts from the viewer's midnight); checkboxes unticked first; people by
 * the first person's name; checklists by the share done; IDs by number; formulas and rollups by
 * their result (lists by their first item). Empty values always sort last, in both directions.
 * Ties fall back to the view's manual order, then the oldest row, then the row id.
 */
import { startOfDayInstant } from './dates';
import { toScaled } from './decimal';
import { plainText } from './richtext';
import { findProperty, readValue, type ReadValue } from './row';
import { compareText } from './text';
import {
  LIMITS,
  type ChecklistItem,
  type ComputedValue,
  type DateValue,
  type EvalContext,
  type Id,
  type Property,
  type PropertyType,
  type RichText,
  type Row,
  type Sort,
} from './types';

/** A value made comparable: a lower rank comes first, then the number, exact decimal or text. */
export interface SortKey {
  rank: number;
  value: number | bigint | string;
}

const BOOLEAN = 0;
const NUMBER = 1;
const DATE = 2;
const TEXT = 3;

/** Files, Relation and Button have no sort order (spec 3.4). */
const UNSORTABLE: ReadonlySet<PropertyType> = new Set<PropertyType>([
  'files',
  'relation',
  'button',
]);

/** True for every type a view can sort by: all but Files, Relation and Button. */
export function canSortBy(prop: Property): boolean {
  return !UNSORTABLE.has(prop.config.type);
}

/**
 * Compares two keys in ascending order; null (empty) comes after everything.
 * Text compares with compareText; numbers and exact decimals compare exactly.
 */
export function compareSortKeys(a: SortKey | null, b: SortKey | null): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  if (a.rank !== b.rank) return a.rank - b.rank;
  const x = a.value;
  const y = b.value;
  if (typeof x === 'string' || typeof y === 'string') return compareText(String(x), String(y));
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Lookups reused while sorting many rows. */
interface Memo {
  /** Option id → position, per options list. */
  positions: Map<readonly { id: Id }[], Map<Id, number>>;
  /** Calendar date → the viewer's midnight in milliseconds (null if it can't be read). */
  midnights: Map<string, number | null>;
}

const newMemo = (): Memo => ({ positions: new Map(), midnights: new Map() });

const text = (s: string | null | undefined): SortKey | null =>
  s ? { rank: TEXT, value: s } : null;
const num = (n: number): SortKey | null => (Number.isNaN(n) ? null : { rank: NUMBER, value: n });

const isDateValue = (v: unknown): v is DateValue =>
  typeof v === 'object' && v !== null && 'start' in v && 'hasTime' in v;
const isComputed = (v: unknown): v is ComputedValue =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v;

function position(memo: Memo, options: readonly { id: Id }[], id: unknown): SortKey | null {
  if (typeof id !== 'string') return null;
  let map = memo.positions.get(options);
  if (!map) {
    map = new Map();
    for (const [i, o] of options.entries()) if (!map.has(o.id)) map.set(o.id, i);
    memo.positions.set(options, map);
  }
  const i = map.get(id);
  return i === undefined ? null : { rank: NUMBER, value: i };
}

/** By the start; a date without a time counts from the viewer's midnight in their time zone. */
function dateKey(v: DateValue, timeZone: string, memo: Memo): SortKey | null {
  let ms = v.hasTime ? Date.parse(v.start) : memo.midnights.get(v.start);
  if (ms === undefined) {
    try {
      ms = Date.parse(startOfDayInstant(v.start, timeZone));
    } catch {
      ms = null;
    }
    memo.midnights.set(v.start, ms);
  }
  return ms === null || Number.isNaN(ms) ? null : { rank: DATE, value: ms };
}

/** The first person whose name is known. */
function personKey(ids: readonly unknown[], ctx: EvalContext): SortKey | null {
  for (const id of ids) {
    const name = typeof id === 'string' ? ctx.userName(id) : undefined;
    if (name) return text(name);
  }
  return null;
}

function computedKey(v: ComputedValue, ctx: EvalContext, memo: Memo): SortKey | null {
  switch (v.kind) {
    case 'text':
      return text(v.value);
    case 'number':
      return num(v.value);
    case 'boolean':
      return { rank: BOOLEAN, value: v.value ? 1 : 0 };
    case 'date':
      return isDateValue(v.value) ? dateKey(v.value, ctx.viewer.timeZone, memo) : null;
    case 'person':
      return text(ctx.userName(v.value));
    case 'page':
      // A row the viewer can't open has no title for them, so it sorts as empty and reveals nothing.
      return text(ctx.rowTitle?.(v.value));
    case 'list': {
      const first = v.value[0];
      return first ? computedKey(first, ctx, memo) : null;
    }
    case 'empty':
    case 'error':
      return null;
  }
}

/** The key a value sorts by for its property; null when it is empty (or can't be sorted). */
function keyOf(prop: Property, v: ReadValue, ctx: EvalContext, memo: Memo): SortKey | null {
  const c = prop.config;
  switch (c.type) {
    case 'title':
    case 'url':
    case 'email':
    case 'phone':
      return typeof v === 'string' ? text(v) : null;
    case 'text':
      return Array.isArray(v) ? text(plainText(v as RichText)) : null;
    case 'number':
      return typeof v === 'string' ? { rank: NUMBER, value: toScaled(v) } : null;
    case 'unique_id':
      return typeof v === 'string' ? num(Number(v)) : null;
    case 'select':
    case 'status':
      return position(memo, c.options, v);
    case 'multi_select': {
      if (!Array.isArray(v)) return null;
      for (const id of v) {
        const key = position(memo, c.options, id);
        if (key) return key;
      }
      return null;
    }
    case 'date':
    case 'created_time':
    case 'edited_time':
      return isDateValue(v) ? dateKey(v, ctx.viewer.timeZone, memo) : null;
    case 'checkbox':
      return { rank: BOOLEAN, value: v === true ? 1 : 0 };
    case 'person':
    case 'created_by':
    case 'edited_by':
      return Array.isArray(v) ? personKey(v, ctx) : null;
    case 'checklist': {
      if (!Array.isArray(v) || !v.length) return null;
      const items = v as ChecklistItem[];
      return num(items.filter((item) => item.done).length / items.length);
    }
    case 'formula':
    case 'rollup':
      return isComputed(v) ? computedKey(v, ctx, memo) : null;
    case 'files':
    case 'relation':
    case 'button':
      return null;
  }
}

/** Empty keys stay last in both directions; everything else follows the direction. */
function directed(a: SortKey | null, b: SortKey | null, direction: Sort['direction']): number {
  if (a === null || b === null || direction === 'asc') return compareSortKeys(a, b);
  return compareSortKeys(b, a);
}

/**
 * Compares two values of one property for sorting: negative if `a` comes first. Empty values
 * (null, an empty computed value or an error) come last whatever the direction.
 */
export function compareForSort(
  prop: Property,
  a: ReadValue,
  b: ReadValue,
  ctx: EvalContext,
  direction: Sort['direction'] = 'asc',
): number {
  const memo = newMemo();
  return directed(keyOf(prop, a, ctx, memo), keyOf(prop, b, ctx, memo), direction);
}

/** The sorts that apply: the first 10, on properties that exist and can be sorted, each property once. */
function activeSorts(
  sorts: readonly Sort[],
  properties: readonly Property[],
): { prop: Property; direction: Sort['direction'] }[] {
  const out: { prop: Property; direction: Sort['direction'] }[] = [];
  const seen = new Set<Id>();
  for (const s of sorts.slice(0, LIMITS.sorts)) {
    const prop = findProperty(properties, s.propertyId);
    if (!prop || !canSortBy(prop) || seen.has(prop.id)) continue;
    seen.add(prop.id);
    out.push({ prop, direction: s.direction === 'desc' ? 'desc' : 'asc' });
  }
  return out;
}

/**
 * A view's sorts without the ones that can't apply: beyond the first 10, on deleted properties,
 * on Files, Relation or Button, or repeating a property already sorted by.
 */
export function pruneSorts(sorts: readonly Sort[], properties: readonly Property[]): Sort[] {
  return activeSorts(sorts, properties).map((s) => ({
    propertyId: s.prop.id,
    direction: s.direction,
  }));
}

const createdMs = (row: Row): number => {
  const ms = Date.parse(row.createdAt);
  return Number.isNaN(ms) ? Infinity : ms;
};

/**
 * Rows in view order (a new array; the input is left alone). Sorts apply in turn; ties, and every
 * row when there are no sorts, follow `manualOrder` (the view's), then rows missing from it,
 * oldest first, then the row id. Values are read once per row and sort.
 */
export function sortRows(
  rows: readonly Row[],
  sorts: readonly Sort[],
  ctx: EvalContext,
  manualOrder: readonly Id[] = [],
): Row[] {
  const active = activeSorts(sorts, ctx.properties);
  const memo = newMemo();
  const place = new Map<Id, number>();
  for (const [i, id] of manualOrder.entries()) if (!place.has(id)) place.set(id, i);
  const items = rows.map((row) => ({
    row,
    keys: active.map((s) => keyOf(s.prop, readValue(row, s.prop, ctx), ctx, memo)),
    place: place.get(row.id) ?? Infinity,
    created: createdMs(row),
  }));
  items.sort((a, b) => {
    for (const [i, s] of active.entries()) {
      const c = directed(a.keys[i] ?? null, b.keys[i] ?? null, s.direction);
      if (c) return c;
    }
    return (
      a.place - b.place ||
      a.created - b.created ||
      (a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0)
    );
  });
  return items.map((item) => item.row);
}
