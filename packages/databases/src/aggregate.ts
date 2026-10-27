/**
 * Column totals (view calculations) and the calculations rollups share (spec 3.10–3.11, additions
 * 3–4): what each property offers, working one out over any list of rows (the whole view, or one
 * group, board column or timeline table), and the footer text ("Sum 12,340", "Percent empty 33.3%",
 * "Date range Oct 1 → Oct 26, 2026"). Number maths is exact; formula errors count as empty.
 */
import {
  EMPTY,
  dateMaths,
  decimal,
  itemReader,
  numberMaths,
  uniqueItems,
  type Exact,
  type Item,
} from './aggregate-maths';
import { computedKind } from './computed';
import { formatDateValue } from './dates';
import {
  decimalToNumber,
  divideDecimal,
  formatDecimal,
  numberToDecimal,
  roundDecimal,
  type DecimalFormat,
} from './decimal';
import { readValue, type ReadValue } from './row';
import {
  AGGREGATES,
  type Aggregate,
  type ComputedValue,
  type EvalContext,
  type Id,
  type Property,
  type Row,
  type View,
} from './types';

/** What a calculation gives: nothing, a list, a count, a share from 0 to 1, a number or a date. */
export type AggregateFamily = 'none' | 'list' | 'count' | 'percent' | 'number' | 'date';

type Extra = 'number' | 'date' | 'checkbox';

/** Label, family, and the kind of value it's only offered for. */
const INFO: Record<Aggregate, readonly [string, AggregateFamily, Extra?]> = {
  none: ['None', 'none'],
  show_original: ['Show original', 'list'],
  show_unique: ['Show unique values', 'list'],
  count_all: ['Count all', 'count'],
  count_values: ['Count values', 'count'],
  count_unique: ['Count unique values', 'count'],
  count_empty: ['Count empty', 'count'],
  count_not_empty: ['Count not empty', 'count'],
  percent_empty: ['Percent empty', 'percent'],
  percent_not_empty: ['Percent not empty', 'percent'],
  sum: ['Sum', 'number', 'number'],
  average: ['Average', 'number', 'number'],
  median: ['Median', 'number', 'number'],
  min: ['Min', 'number', 'number'],
  max: ['Max', 'number', 'number'],
  range: ['Range', 'number', 'number'],
  earliest: ['Earliest', 'date', 'date'],
  latest: ['Latest', 'date', 'date'],
  date_range: ['Date range', 'date', 'date'],
  checked: ['Checked', 'count', 'checkbox'],
  unchecked: ['Unchecked', 'count', 'checkbox'],
  percent_checked: ['Percent checked', 'percent', 'checkbox'],
  percent_unchecked: ['Percent unchecked', 'percent', 'checkbox'],
};

/** The kind of result a calculation gives, for choosing how to show it. */
export function aggregateFamily(agg: Aggregate): AggregateFamily {
  return INFO[agg]?.[1] ?? 'none';
}

/**
 * The calculation's name in menus and in the footer ("Count all", "Percent empty", "Earliest").
 * Rollups (opts.rollup) say "Earliest date" and "Latest date".
 */
export function aggregateLabel(agg: Aggregate, opts: { rollup?: boolean } = {}): string {
  const label = INFO[agg]?.[0] ?? '';
  return opts.rollup && (agg === 'earliest' || agg === 'latest') ? `${label} date` : label;
}

function valueKind(prop: Property): Extra | 'title' | 'button' | 'other' {
  const t = prop.config.type;
  if (t === 'title' || t === 'button' || t === 'number' || t === 'date' || t === 'checkbox')
    return t;
  if (t === 'created_time' || t === 'edited_time') return 'date';
  const k = computedKind(prop);
  return k === 'number' || k === 'date' ? k : k === 'boolean' ? 'checkbox' : 'other';
}

/**
 * The calculations a property offers, in menu order. Column totals start with None; rollups
 * (opts.rollup, given the related property) start with Show original and Show unique values. All
 * offer the counts and percents; numbers, dates and checkboxes (and formulas and rollups that give
 * them) add their own. In totals, Name offers the counts only; a Button only ever Count all.
 */
export function aggregatesFor(prop: Property, opts: { rollup?: boolean } = {}): Aggregate[] {
  const kind = valueKind(prop);
  const rollup = opts.rollup === true;
  return AGGREGATES.filter((a) => {
    const [, family, only] = INFO[a];
    if (a === 'none') return !rollup;
    if (kind === 'button') return a === 'count_all';
    if (only) return only === kind;
    if (family === 'list') return rollup;
    return family === 'count' || rollup || kind !== 'title';
  });
}

/** How many rows (or values) a count or percent counts. */
function tally(agg: Aggregate, cells: readonly Item[][]): number {
  const filled = () => cells.filter((c) => c.length > 0).length;
  const ticked = () =>
    cells.filter((c) => c.length > 0 && c.every((i) => i.kind === 'boolean' && i.value)).length;
  switch (agg) {
    case 'count_all':
      return cells.length;
    case 'count_values':
      return cells.reduce((n, c) => n + c.length, 0);
    case 'count_unique':
      return uniqueItems(cells.flat()).length;
    case 'count_not_empty':
    case 'percent_not_empty':
      return filled();
    case 'count_empty':
    case 'percent_empty':
      return cells.length - filled();
    case 'checked':
    case 'percent_checked':
      return ticked();
    default:
      return cells.length - ticked();
  }
}

const asList = (items: readonly Item[]): ComputedValue =>
  items.length
    ? {
        kind: 'list',
        value: items.map((i) =>
          i.kind === 'number' ? { kind: 'number', value: decimalToNumber(i.value) } : i,
        ),
      }
    : EMPTY;

function compute(
  values: readonly ReadValue[],
  agg: Aggregate,
  prop: Property,
  ctx: EvalContext,
): Exact {
  const cells = values.map(itemReader(prop, ctx));
  const family = aggregateFamily(agg);
  if (family === 'none') return EMPTY;
  if (family === 'list')
    return asList(agg === 'show_unique' ? uniqueItems(cells.flat()) : cells.flat());
  if (family === 'number') return numberMaths(cells.flat(), agg);
  if (family === 'date') return dateMaths(cells.flat(), agg, ctx.viewer.timeZone);
  const n = tally(agg, cells);
  if (family === 'count') return decimal(String(n));
  // Percents are shares from 0 to 1, kept to a tenth of a percent (1 of 3 → 0.333, "33.3%").
  const all = cells.length;
  return decimal(all ? roundDecimal(divideDecimal(String(n), String(all)) ?? '0', 3) : '0');
}

const toValue = (r: Exact): ComputedValue =>
  r.kind === 'decimal' ? { kind: 'number', value: decimalToNumber(r.value) } : r;

/**
 * Works out one calculation over a column of values of `prop`, one per row: the rows of a view,
 * of one group, or the related rows of a rollup. Counts count rows (Count values and Count unique
 * values count values); percents are 0 to 1; number maths is exact, and an even count's median is
 * the mean of the middle two; earliest, latest and date range give dates; show original and show
 * unique give lists. With no values, maths gives empty and counts 0. None gives empty.
 */
export function aggregateValues(
  values: readonly ReadValue[],
  agg: Aggregate,
  prop: Property,
  ctx: EvalContext,
): ComputedValue {
  return toValue(compute(values, agg, prop, ctx));
}

const COUNT_FORMAT: DecimalFormat = { format: 'number_commas', decimals: 0 };
const PERCENT_FORMAT: DecimalFormat = { format: 'percent', decimals: 'auto' };

function numberFormatOf(prop: Property): DecimalFormat {
  const c = prop.config;
  const d = c.type === 'number' ? c : c.type === 'formula' || c.type === 'rollup' ? c.number : null;
  return d
    ? { format: d.format, decimals: d.decimals, currency: d.currency }
    : { format: 'number', decimals: 'auto' };
}

function itemText(v: ComputedValue, prop: Property, ctx: EvalContext): string {
  const c = prop.config;
  switch (v.kind) {
    case 'empty':
      return '';
    case 'error':
      return v.message;
    case 'text':
      return v.value;
    case 'boolean':
      return v.value ? 'Yes' : 'No';
    case 'person':
      return ctx.userName(v.value) ?? '';
    case 'page':
      return ctx.rowTitle?.(v.value) ?? '';
    case 'list':
      return v.value
        .map((x) => itemText(x, prop, ctx))
        .filter((s) => s !== '')
        .join(', ');
    case 'number': {
      const d = numberToDecimal(v.value);
      return d === null ? '' : formatDecimal(d, numberFormatOf(prop));
    }
    case 'date': {
      const f =
        c.type === 'date' || c.type === 'created_time' || c.type === 'edited_time' ? c : null;
      const text = formatDateValue(v.value, {
        format: f?.format ?? 'full',
        timeFormat: f?.timeFormat ?? 'viewer',
        viewer: ctx.viewer,
      });
      // Days in one year: the start leaves the year out ("Oct 1 → Oct 26, 2026").
      const m = /^([A-Z][a-z]+ \d{1,2}), (\d{4}) → ([A-Z][a-z]+ \d{1,2}, \2)$/.exec(text);
      return m ? `${m[1]} → ${m[3]}` : text;
    }
  }
}

function formatExact(r: Exact, agg: Aggregate, prop: Property, ctx: EvalContext): string {
  const family = aggregateFamily(agg);
  if (family === 'none') return '';
  const text =
    r.kind !== 'decimal'
      ? itemText(r, prop, ctx)
      : family === 'percent'
        ? formatDecimal(roundDecimal(r.value, 3), PERCENT_FORMAT)
        : formatDecimal(r.value, family === 'number' ? numberFormatOf(prop) : COUNT_FORMAT);
  return text ? `${aggregateLabel(agg)} ${text}` : aggregateLabel(agg);
}

/**
 * The footer text for a result of aggregateValues: the label, then the value. Counts as whole
 * numbers ("Count all 1,234"), percents with up to one decimal ("Percent empty 33.3%"), number
 * maths in the property's number format ("Sum 12,340", "Sum $1,234.50"), dates in the property's
 * date format, a range of days in one year without the first year ("Date range Oct 1 → Oct 26,
 * 2026"). Just the label when there's nothing to show; "" for None.
 */
export function formatAggregate(
  result: ComputedValue,
  agg: Aggregate,
  prop: Property,
  ctx: EvalContext,
): string {
  const d = result.kind === 'number' ? numberToDecimal(result.value) : null;
  const numeric = ['count', 'percent', 'number'].includes(aggregateFamily(agg));
  return formatExact(numeric && d !== null ? decimal(d) : result, agg, prop, ctx);
}

/** One column total: the value, and the footer text. */
export interface ViewTotal {
  value: ComputedValue;
  text: string;
}

/**
 * The column totals over `rows`: the rows that match the view's filters and search and that the
 * viewer can open. Call it once per group for group footers, board column headers and the
 * timeline's table. Keyed by property id; leaves out None, deleted properties, and calculations a
 * property no longer offers (after a type change). Numbers in the text are exact, however large.
 */
export function viewTotals(
  rows: readonly Row[],
  calculations: View['calculations'],
  ctx: EvalContext,
): Partial<Record<Id, ViewTotal>> {
  const out: Partial<Record<Id, ViewTotal>> = {};
  for (const [id, agg] of Object.entries(calculations)) {
    const prop = ctx.properties.find((p) => p.id === id);
    if (!agg || agg === 'none' || !prop || !aggregatesFor(prop).includes(agg)) continue;
    const exact = compute(
      rows.map((r) => readValue(r, prop, ctx)),
      agg,
      prop,
      ctx,
    );
    out[id] = { value: toValue(exact), text: formatExact(exact, agg, prop, ctx) };
  }
  return out;
}
