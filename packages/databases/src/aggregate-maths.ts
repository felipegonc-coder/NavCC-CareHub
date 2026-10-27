/**
 * The values inside cells, and the number and date maths over them, for column totals and rollups
 * (aggregate.ts). Every value in a cell counts: a Multi-select, Person, Relation or Files cell, or
 * a formula list, gives each of its values. Numbers stay exact decimals until the result.
 */
import { instantToCalendarDate, isValidDateValue, startOfDayInstant } from './dates';
import {
  divideDecimal,
  fromScaled,
  isCanonicalDecimal,
  numberToDecimal,
  toScaled,
} from './decimal';
import { plainText } from './richtext';
import type { ReadValue } from './row';
import type { Aggregate, ComputedValue, EvalContext, Id, Property, RichText } from './types';
import { VERIFICATION_LABELS, verificationState } from './verification';

/** One value inside a cell. Numbers stay exact decimals. */
export type Item =
  | { kind: 'number'; value: string }
  | Extract<ComputedValue, { kind: 'text' | 'boolean' | 'date' | 'person' | 'page' }>;

/** A result, with numbers still exact decimals. */
export type Exact = ComputedValue | { kind: 'decimal'; value: string };

export const EMPTY: ComputedValue = { kind: 'empty' };

/** An exact decimal result. */
export const decimal = (value: string): Exact => ({ kind: 'decimal', value });

const listOf = (v: unknown): readonly unknown[] => (Array.isArray(v) ? v : []);
const textItem = (value: string): Item[] => (value === '' ? [] : [{ kind: 'text', value }]);
const field = (v: unknown, key: string): unknown =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>)[key] : undefined;

function idsOf(v: unknown): Id[] {
  const all: readonly unknown[] = typeof v === 'string' ? [v] : listOf(v);
  return all.filter((x): x is Id => typeof x === 'string' && x !== '');
}

function richItems(v: unknown): Item[] {
  const rt = listOf(v).filter((s): s is RichText[number] => typeof field(s, 'text') === 'string');
  const value = plainText(rt);
  if (value === '') return [];
  const styled = rt.some((s) => s.marks?.length || s.color || s.link || s.mention);
  return [styled ? { kind: 'text', value, rich: rt } : { kind: 'text', value }];
}

function computedItems(v: ComputedValue, out: Item[]): void {
  if (v.kind === 'list') {
    for (const x of v.value) computedItems(x, out);
  } else if (v.kind === 'number') {
    const d = numberToDecimal(v.value);
    if (d !== null) out.push({ kind: 'number', value: d });
  } else if (v.kind !== 'empty' && v.kind !== 'error' && !(v.kind === 'text' && v.value === '')) {
    out.push(v);
  }
}

/**
 * Reads the values inside one cell of `prop`; an empty cell gives none, a checkbox always one.
 * Options give their names, a checklist the share done, an ID with a prefix its text ("QA-12"),
 * a verification its state ("Verified", "Expired" or "Not verified", always one).
 * Formula and rollup errors give none; relation links the viewer can't open don't count.
 */
export function itemReader(prop: Property, ctx: EvalContext): (v: ReadValue) => Item[] {
  const c = prop.config;
  switch (c.type) {
    case 'title':
    case 'url':
    case 'email':
    case 'phone':
      return (v) => (typeof v === 'string' ? textItem(v) : []);
    case 'text':
      return richItems;
    case 'number':
      return (v) => (isCanonicalDecimal(v) ? [{ kind: 'number', value: v }] : []);
    case 'select':
    case 'status':
    case 'multi_select': {
      const names = new Map<Id, string>(c.options.map((o) => [o.id, o.name]));
      return (v) => idsOf(v).flatMap((id) => textItem(names.get(id) ?? ''));
    }
    case 'date':
    case 'created_time':
    case 'edited_time':
      return (v) => (isValidDateValue(v) ? [{ kind: 'date', value: v }] : []);
    case 'checkbox':
      return (v) => [{ kind: 'boolean', value: v === true }];
    case 'person':
    case 'created_by':
    case 'edited_by':
      return (v) => idsOf(v).map((id): Item => ({ kind: 'person', value: id }));
    case 'relation': {
      const canOpen = (id: Id) => !ctx.rowTitle || ctx.rowTitle(id) !== undefined;
      return (v) =>
        idsOf(v)
          .filter(canOpen)
          .map((id): Item => ({ kind: 'page', value: id }));
    }
    case 'files':
      return (v) => listOf(v).flatMap((f) => textItem(String(field(f, 'name') ?? '')));
    case 'checklist':
      return (v) => {
        const all = listOf(v);
        const done = all.filter((i) => field(i, 'done') === true).length;
        const share = all.length ? divideDecimal(String(done), String(all.length)) : null;
        return share === null ? [] : [{ kind: 'number', value: share }];
      };
    case 'unique_id':
      return (v) =>
        isCanonicalDecimal(v)
          ? [c.prefix ? { kind: 'text', value: `${c.prefix}-${v}` } : { kind: 'number', value: v }]
          : [];
    case 'formula':
    case 'rollup':
      return (v) => {
        const out: Item[] = [];
        if (typeof field(v, 'kind') === 'string') computedItems(v as ComputedValue, out);
        return out;
      };
    case 'button':
      return () => [];
    case 'verification':
      return (v) => textItem(VERIFICATION_LABELS[verificationState(v, ctx.viewer)]);
  }
}

function itemKey(i: Item): string {
  if (i.kind !== 'date') return `${i.kind}:${String(i.value)}`;
  const { start, end, hasTime } = i.value;
  return hasTime
    ? `t:${Date.parse(start)}:${end ? Date.parse(end) : ''}`
    : `d:${start}:${end ?? ''}`;
}

/** The items without repeats (the same text, number, date, person or page counts once). */
export function uniqueItems(items: readonly Item[]): Item[] {
  const seen = new Set<string>();
  return items.filter((i) => {
    const key = itemKey(i);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Sum (the default), average, median, min, max or range of the number items, exactly. */
export function numberMaths(items: readonly Item[], agg: Aggregate): Exact {
  const xs = items.flatMap((i) => (i.kind === 'number' ? [toScaled(i.value)] : []));
  if (!xs.length) return EMPTY;
  const sorted = xs.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const lo = sorted[0] ?? 0n;
  const hi = sorted[sorted.length - 1] ?? 0n;
  const mid = sorted.length >> 1;
  const sum = fromScaled(xs.reduce((a, b) => a + b, 0n));
  switch (agg) {
    case 'average':
      return decimal(divideDecimal(sum, String(xs.length)) ?? '0');
    case 'min':
      return decimal(fromScaled(lo));
    case 'max':
      return decimal(fromScaled(hi));
    case 'range':
      return decimal(fromScaled(hi - lo));
    case 'median': {
      const upper = sorted[mid] ?? 0n;
      if (sorted.length % 2) return decimal(fromScaled(upper));
      // An even count: the mean of the middle two.
      return decimal(divideDecimal(fromScaled((sorted[mid - 1] ?? 0n) + upper), '2') ?? '0');
    }
    default:
      return decimal(sum);
  }
}

interface DatePoint {
  date: string;
  hasTime: boolean;
  at: number;
}

/**
 * Earliest: the earliest start. Latest: the latest end (or start). Date range (the default): the
 * earliest start → the latest end, with no end when they're the same. Dates without a time count
 * from the viewer's midnight; a range mixing the two gives days in the viewer's time zone.
 */
export function dateMaths(items: readonly Item[], agg: Aggregate, timeZone: string): Exact {
  const midnights = new Map<string, number>();
  const at = (s: string, hasTime: boolean): number => {
    if (hasTime) return Date.parse(s);
    const t = midnights.get(s) ?? Date.parse(startOfDayInstant(s, timeZone));
    midnights.set(s, t);
    return t;
  };
  let first: DatePoint | null = null;
  let last: DatePoint | null = null;
  for (const i of items) {
    if (i.kind !== 'date') continue;
    const { start, end, hasTime } = i.value;
    const s = at(start, hasTime);
    const e = end ? at(end, hasTime) : s;
    if (Number.isNaN(s) || Number.isNaN(e)) continue;
    if (!first || s < first.at) first = { date: start, hasTime, at: s };
    if (!last || e > last.at) last = { date: end ?? start, hasTime, at: e };
  }
  if (!first || !last) return EMPTY;
  if (agg === 'earliest' || agg === 'latest') {
    const p = agg === 'earliest' ? first : last;
    return { kind: 'date', value: { start: p.date, end: null, hasTime: p.hasTime } };
  }
  const mixed = first.hasTime !== last.hasTime;
  const day = (p: DatePoint) => (p.hasTime ? instantToCalendarDate(p.date, timeZone) : p.date);
  const a = mixed ? day(first) : first.date;
  const b = mixed ? day(last) : last.date;
  const same = mixed ? a === b : first.at === last.at;
  return {
    kind: 'date',
    value: { start: a, end: same ? null : b, hasTime: !mixed && first.hasTime },
  };
}
