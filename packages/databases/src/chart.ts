/**
 * Chart layout data (Databases spec, Chart layout; DB-13, DB-44, DB-45). Turns a view's rows into
 * categories, series and values for bar, horizontal bar, line, pie and donut charts, plus the rows of
 * "View as table". The UI only draws what this returns, so a chart and its table always agree.
 *
 * - Categories: every option (or Unchecked and Checked) even without rows; up to
 *   LIMITS.chartCategories, the rest together as "Other"; "No value" last.
 * - Dates: by day, week, month, quarter or year in the viewer's time zone. Buckets without rows
 *   between the first and the last date show as 0. Past the limit the latest buckets show and the
 *   earlier ones go into "Other".
 * - Split (bar and line): up to LIMITS.chartSplits series, the rest together as "Other".
 * - Values: count, or the sum, average, median, min or max of a number, worked out exactly.
 * - A row with several values (multi-select, people) counts once in each of them.
 */
import {
  CHART_PALETTES,
  EMPTY_COLOR,
  OTHER_COLOR,
  paletteColor,
  type ChartColor,
  type ChartPalette,
} from './chart-palette';
import { computedKind } from './computed';
import {
  DEFAULT_TIME_ZONE,
  addDays,
  addMonths,
  dateValueStartDay,
  epochDays,
  formatCalendarDate,
  isValidDateValue,
  isValidTimeZone,
  parseCalendarDate,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  startOfYear,
} from './dates';
import {
  compareDecimal,
  decimalToNumber,
  divideDecimal,
  formatDecimal,
  fromScaled,
  isCanonicalDecimal,
  numberToDecimal,
  toScaled,
  type DecimalFormat,
} from './decimal';
import { plainText } from './richtext';
import { findProperty, readValue } from './row';
import { compareText } from './text';
import {
  EMPTY_GROUP,
  LIMITS,
  type CalendarDate,
  type ChartOptions,
  type ComputedValue,
  type EvalContext,
  type Id,
  type OptionColor,
  type Property,
  type PropertyType,
  type RichText,
  type Row,
  type View,
  type WeekDay,
} from './types';

/** Key of the "Other" category or series (everything past the limits). */
export const OTHER_KEY = '__other__';
/** Key of the only series when the chart isn't split. */
export const VALUE_SERIES_KEY = '__value__';

/** A value as an exact decimal (table, export), a number (drawing) and display text. */
export interface ChartNumber {
  /** null when there is nothing to work out, such as the average of no numbers. */
  exact: string | null;
  value: number | null;
  /** "1,234", "$1,234.50", "45%"; "" when exact is null. */
  text: string;
}

export interface ChartPoint extends ChartNumber {
  /** The rows behind it, in view order, for the list shown on click. Never cumulative. */
  rowIds: Id[];
}

export interface ChartCategory {
  /** Option, person, date… keys; EMPTY_GROUP for "No value", OTHER_KEY for "Other". */
  key: string;
  label: string;
  /** A design-kit colour (chart-palette.ts), used when display.colorBy is "category". */
  color: ChartColor;
  /** Every series together (cumulative when the chart is). */
  total: ChartPoint;
}

export interface ChartSeries {
  /** VALUE_SERIES_KEY when not split; EMPTY_GROUP for "No value", OTHER_KEY for "Other". */
  key: string;
  label: string;
  /** A design-kit colour (chart-palette.ts), used when display.colorBy is "series". */
  color: ChartColor;
  /** One point for each category, in category order. */
  values: ChartPoint[];
}

/** One line of "View as table": the same numbers as the chart. */
export interface ChartTableRow {
  categoryKey: string;
  category: string;
  seriesKey: string;
  series: string;
  exact: string | null;
  text: string;
}

/**
 * choose_category: no category property yet. property_unavailable: a property the chart uses was
 * deleted or is hidden from the viewer. invalid_settings: a property can't be used that way.
 */
export type ChartProblem = 'choose_category' | 'property_unavailable' | 'invalid_settings';

/** The display settings, checked and resolved for the chart kind. */
export interface ChartDisplay {
  kind: ChartOptions['kind'];
  height: ChartOptions['height'];
  showLegend: boolean;
  showValues: boolean;
  dataLabels: boolean;
  /** Bars only, when split: stacked (true) or side by side (false). */
  stacked: boolean;
  /** Line charts only. */
  smooth: boolean;
  /** Bars and lines only: each category adds to the ones before it. */
  cumulative: boolean;
  /** Bars and lines only; null ends are automatic. null: automatic. */
  axisRange: { min: number | null; max: number | null } | null;
  /** Bars and lines only. */
  referenceLine: { value: number; label: string } | null;
  palette: ChartPalette;
  /** Donut only: the total in the middle. */
  centerValue: boolean;
  /** "category": each bar or slice has its own color; "series": each series has one color. */
  colorBy: 'category' | 'series';
}

export interface ChartData {
  problem: ChartProblem | null;
  /** In display order. */
  categories: ChartCategory[];
  series: ChartSeries[];
  /** Everything shown, worked out over all of it (the donut's middle). */
  total: ChartNumber;
  /** "Count", "Sum of Hours"… */
  valueLabel: string;
  table: ChartTableRow[];
  display: ChartDisplay;
}

/** Messages for the chart settings (validateChartOptions). */
export const CHART_MESSAGES = {
  category: "Charts can't show categories from this property.",
  split: "Charts can't split by this property.",
  value: 'Choose a number property for this value.',
  axisRange: 'The minimum must be less than the maximum.',
  number: 'Enter a number.',
} as const;

type Kind = ChartOptions['kind'];
type Aggregate = ChartOptions['value']['aggregate'];
type DateBucket = ChartOptions['xDateBucket'];

const KINDS = ['bar', 'horizontal_bar', 'line', 'pie', 'donut'] as const satisfies readonly Kind[];
const HEIGHTS = ['s', 'm', 'l', 'xl'] as const satisfies readonly ChartOptions['height'][];
const DATE_BUCKETS = [
  'day',
  'week',
  'month',
  'quarter',
  'year',
] as const satisfies readonly DateBucket[];
const AGGREGATE_LABELS: Readonly<Record<Aggregate, string>> = {
  count: 'Count',
  sum: 'Sum',
  average: 'Average',
  median: 'Median',
  min: 'Min',
  max: 'Max',
};

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

const COUNT_FORMAT: DecimalFormat = { format: 'number_commas', decimals: 0 };
const PLAIN_FORMAT: DecimalFormat = { format: 'number', decimals: 'auto' };

/** A chart with nothing chosen yet, used when a view has no chart settings. */
const BLANK_CHART: ChartOptions = {
  kind: 'bar',
  xPropertyId: null,
  xDateBucket: 'month',
  value: { aggregate: 'count', propertyId: null },
  splitBy: null,
  order: 'option',
  showValues: false,
  showLegend: true,
  hideEmpty: false,
  stacked: true,
  cumulative: false,
  height: 'm',
};

function oneOf<T extends string>(list: readonly T[], v: unknown): v is T {
  return typeof v === 'string' && (list as readonly string[]).includes(v);
}

const isRound = (kind: Kind): boolean => kind === 'pie' || kind === 'donut';
const isBars = (kind: Kind): boolean => kind === 'bar' || kind === 'horizontal_bar';
const finite = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

// ------------------------------------------------------------------ which properties

const CATEGORY_TYPES: ReadonlySet<PropertyType> = new Set<PropertyType>([
  'title',
  'text',
  'select',
  'multi_select',
  'status',
  'date',
  'checkbox',
  'url',
  'email',
  'phone',
  'person',
  'created_time',
  'edited_time',
  'created_by',
  'edited_by',
]);
const CATEGORY_KINDS: ReadonlySet<string> = new Set(['text', 'boolean', 'date', 'person', 'list']);

/** Properties a chart can use for its categories or to split: options, people, checkboxes, dates, text. */
export function canChartBy(prop: Property): boolean {
  const t = prop.config.type;
  if (t === 'formula' || t === 'rollup') {
    const kind = computedKind(prop);
    return kind !== null && CATEGORY_KINDS.has(kind);
  }
  return CATEGORY_TYPES.has(t);
}

/** Properties a chart can add up, average… : numbers and number formulas or rollups. */
export function canChartValue(prop: Property): boolean {
  return prop.config.type === 'number' || computedKind(prop) === 'number';
}

/** The properties a chart reads (to load them, and to warn before one is deleted). */
export function chartPropertyIds(chart: ChartOptions): Id[] {
  const ids = [
    chart.xPropertyId,
    isRound(chart.kind) ? null : chart.splitBy,
    chart.value.aggregate === 'count' ? null : chart.value.propertyId,
  ];
  const out: Id[] = [];
  for (const id of ids) if (id !== null && !out.includes(id)) out.push(id);
  return out;
}

/** "Count", "Sum of Hours", "Average of Hours"…; just "Sum" when the property is missing. */
export function chartValueLabel(
  value: ChartOptions['value'],
  properties: readonly Property[],
): string {
  const label = AGGREGATE_LABELS[value.aggregate] ?? AGGREGATE_LABELS.count;
  if (value.aggregate === 'count' || value.propertyId === null) return label;
  const prop = findProperty(properties, value.propertyId);
  return prop ? `${label} of ${prop.name}` : label;
}

/** The first problem with chart settings as a message for the settings panel, or null. */
export function validateChartOptions(
  chart: ChartOptions,
  properties: readonly Property[],
): string | null {
  const x = chart.xPropertyId === null ? undefined : findProperty(properties, chart.xPropertyId);
  if (x && !canChartBy(x)) return CHART_MESSAGES.category;
  const round = isRound(chart.kind);
  const split =
    chart.splitBy === null || round ? undefined : findProperty(properties, chart.splitBy);
  if (split && !canChartBy(split)) return CHART_MESSAGES.split;
  if (chart.value.aggregate !== 'count') {
    const id = chart.value.propertyId;
    const prop = id === null ? undefined : findProperty(properties, id);
    if (!prop || !canChartValue(prop)) return CHART_MESSAGES.value;
  }
  if (round) return null;
  const range = chart.axisRange;
  if (range) {
    const bad = (v: unknown): boolean => v !== null && finite(v) === null;
    if (bad(range.min) || bad(range.max)) return CHART_MESSAGES.number;
    if (range.min !== null && range.max !== null && range.min >= range.max) {
      return CHART_MESSAGES.axisRange;
    }
  }
  if (chart.referenceLine && finite(chart.referenceLine.value) === null) {
    return CHART_MESSAGES.number;
  }
  return null;
}

// ------------------------------------------------------------------ display settings

function rangeOf(r: ChartOptions['axisRange']): ChartDisplay['axisRange'] {
  if (!r) return null;
  const min = finite(r.min);
  const max = finite(r.max);
  if (min === null && max === null) return null;
  if (min !== null && max !== null && min >= max) return null;
  return { min, max };
}

function referenceLineOf(l: ChartOptions['referenceLine']): ChartDisplay['referenceLine'] {
  const value = finite(l?.value);
  if (!l || value === null) return null;
  return { value, label: typeof l.label === 'string' ? l.label.trim() : '' };
}

function displayOf(chart: ChartOptions, split: boolean, optionCategories: boolean): ChartDisplay {
  const kind = oneOf(KINDS, chart.kind) ? chart.kind : 'bar';
  const round = isRound(kind);
  const bars = isBars(kind);
  return {
    kind,
    height: oneOf(HEIGHTS, chart.height) ? chart.height : 'm',
    showLegend: chart.showLegend === true,
    showValues: chart.showValues === true,
    dataLabels: chart.dataLabels === true,
    stacked: bars && split && chart.stacked === true && chart.grouped !== true,
    smooth: kind === 'line' && chart.smooth === true,
    cumulative: !round && chart.cumulative === true,
    axisRange: round ? null : rangeOf(chart.axisRange),
    referenceLine: round ? null : referenceLineOf(chart.referenceLine),
    palette: oneOf(CHART_PALETTES, chart.palette) ? chart.palette : 'default',
    centerValue: kind === 'donut' && chart.centerValue !== false,
    colorBy: round || (bars && !split && optionCategories) ? 'category' : 'series',
  };
}

// ------------------------------------------------------------------ buckets

interface Bucket {
  key: string;
  label: string;
  /** Natural order sorts by this first: options and checkboxes, numbers, dates, then names and text. */
  group: number;
  /** Position in the group (option index, Unchecked 0 and Checked 1, number, day); null: by label. */
  rank: number | null;
  color: OptionColor | null;
  /** First day of a date bucket. */
  day: CalendarDate | null;
}

interface Axis {
  prop: Property;
  ctx: EvalContext;
  timeZone: string;
  weekStart: WeekDay;
  size: DateBucket;
  options: Map<Id, Bucket>;
  /** Shown even without rows: every option, or Unchecked and Checked. */
  fixed: Bucket[];
  /** Date properties and date results: gaps show as 0 and the latest buckets are kept. */
  dates: boolean;
  empty: Bucket;
}

const UNCHECKED: Bucket = {
  key: 'b:false',
  label: 'Unchecked',
  group: 0,
  rank: 0,
  color: null,
  day: null,
};
const CHECKED: Bucket = {
  key: 'b:true',
  label: 'Checked',
  group: 0,
  rank: 1,
  color: null,
  day: null,
};

function axisOf(prop: Property, ctx: EvalContext, size: DateBucket): Axis {
  const c = prop.config;
  const options = new Map<Id, Bucket>();
  if (c.type === 'select' || c.type === 'multi_select' || c.type === 'status') {
    c.options.forEach((o, index) => {
      if (options.has(o.id)) return;
      options.set(o.id, {
        key: `o:${o.id}`,
        label: o.name,
        group: 0,
        rank: index,
        color: o.color,
        day: null,
      });
    });
  }
  const kind = computedKind(prop);
  const tz = ctx.viewer.timeZone;
  const weekStart = ctx.viewer.weekStart;
  return {
    prop,
    ctx,
    timeZone: typeof tz === 'string' && isValidTimeZone(tz) ? tz : DEFAULT_TIME_ZONE,
    weekStart: Number.isInteger(weekStart) && weekStart >= 0 && weekStart <= 6 ? weekStart : 0,
    size: oneOf(DATE_BUCKETS, size) ? size : 'month',
    options,
    fixed:
      c.type === 'checkbox' || kind === 'boolean' ? [UNCHECKED, CHECKED] : [...options.values()],
    dates:
      c.type === 'date' || c.type === 'created_time' || c.type === 'edited_time' || kind === 'date',
    empty: {
      key: EMPTY_GROUP,
      // No Created by or Edited by means an anonymous form response.
      label: c.type === 'created_by' || c.type === 'edited_by' ? 'Anonymous' : 'No value',
      group: 9,
      rank: null,
      color: null,
      day: null,
    },
  };
}

const textBucket = (value: string): Bucket | null =>
  value === ''
    ? null
    : { key: `t:${value}`, label: value, group: 3, rank: null, color: null, day: null };

function personBucket(id: Id, axis: Axis): Bucket | null {
  const name = axis.ctx.userName(id);
  if (name === undefined) return null;
  const label = axis.ctx.isRemovedUser?.(id) ? `${name} (removed)` : name;
  return { key: `u:${id}`, label, group: 3, rank: null, color: null, day: null };
}

function pageBucket(id: Id, axis: Axis): Bucket | null {
  const title = axis.ctx.rowTitle?.(id);
  if (title === undefined) return null;
  return {
    key: `p:${id}`,
    label: title || 'Untitled',
    group: 3,
    rank: null,
    color: null,
    day: null,
  };
}

function numberBucket(n: number): Bucket | null {
  const d = numberToDecimal(n);
  if (d === null) return null;
  const label = formatDecimal(d, PLAIN_FORMAT);
  return { key: `n:${d}`, label, group: 1, rank: n, color: null, day: null };
}

function bucketStart(day: CalendarDate, axis: Axis): CalendarDate {
  switch (axis.size) {
    case 'day':
      return day;
    case 'week':
      return startOfWeek(day, axis.weekStart);
    case 'month':
      return startOfMonth(day);
    case 'quarter':
      return startOfQuarter(day);
    case 'year':
      return startOfYear(day);
  }
}

/** The bucket `n` steps after (or before, when negative) the one starting on `start`. */
function stepBucket(start: CalendarDate, size: DateBucket, n: number): CalendarDate {
  switch (size) {
    case 'day':
      return addDays(start, n);
    case 'week':
      return addDays(start, 7 * n);
    case 'month':
      return addMonths(start, n);
    case 'quarter':
      return addMonths(start, 3 * n);
    case 'year':
      return addMonths(start, 12 * n);
  }
}

/** [key, label]: day "Oct 26, 2026", week "Week of Oct 25, 2026", "October 2026", "Q4 2026", "2026". */
function dateKeyLabel(start: CalendarDate, size: DateBucket): [string, string] {
  const year = start.slice(0, 4);
  const month = parseCalendarDate(start)?.m ?? 1;
  const quarter = Math.floor((month - 1) / 3) + 1;
  switch (size) {
    case 'day':
      return [start, formatCalendarDate(start, 'full')];
    case 'week':
      return [start, `Week of ${formatCalendarDate(start, 'full')}`];
    case 'month':
      return [start.slice(0, 7), `${MONTHS[month - 1] ?? ''} ${year}`];
    case 'quarter':
      return [`${year}-Q${quarter}`, `Q${quarter} ${year}`];
    case 'year':
      return [year, year];
  }
}

function dateBucket(start: CalendarDate, size: DateBucket): Bucket {
  const [key, label] = dateKeyLabel(start, size);
  return { key: `d:${key}`, label, group: 2, rank: epochDays(start), color: null, day: start };
}

function dateBucketOf(v: unknown, axis: Axis): Bucket | null {
  if (!isValidDateValue(v)) return null;
  return dateBucket(bucketStart(dateValueStartDay(v, axis.timeZone), axis), axis.size);
}

function computedBuckets(
  v: ComputedValue,
  axis: Axis,
  add: (b: Bucket | null | undefined) => void,
  depth: number,
): void {
  if (typeof v !== 'object' || v === null) return;
  switch (v.kind) {
    case 'text':
      add(textBucket(v.value));
      return;
    case 'boolean':
      add(v.value ? CHECKED : UNCHECKED);
      return;
    case 'date':
      add(dateBucketOf(v.value, axis));
      return;
    case 'person':
      add(personBucket(v.value, axis));
      return;
    case 'page':
      add(pageBucket(v.value, axis));
      return;
    case 'number':
      add(numberBucket(v.value));
      return;
    case 'list':
      if (depth < 4) for (const item of v.value) computedBuckets(item, axis, add, depth + 1);
      return;
    case 'empty':
    case 'error':
      return;
  }
}

/** The buckets a row is in (each once), or just "No value". */
function bucketsOf(row: Row, axis: Axis): Bucket[] {
  const out = new Map<string, Bucket>();
  const add = (b: Bucket | null | undefined): void => {
    if (b && !out.has(b.key)) out.set(b.key, b);
  };
  const v: unknown = readValue(row, axis.prop, axis.ctx);
  switch (axis.prop.config.type) {
    case 'select':
    case 'status':
    case 'multi_select':
      for (const id of Array.isArray(v) ? v : [v]) {
        if (typeof id === 'string') add(axis.options.get(id));
      }
      break;
    case 'checkbox':
      add(v === true ? CHECKED : UNCHECKED);
      break;
    case 'person':
    case 'created_by':
    case 'edited_by':
      if (Array.isArray(v)) {
        for (const id of v) if (typeof id === 'string') add(personBucket(id, axis));
      }
      break;
    case 'text':
      if (Array.isArray(v)) add(textBucket(plainText(v as RichText)));
      break;
    case 'title':
    case 'url':
    case 'email':
    case 'phone':
      if (typeof v === 'string') add(textBucket(v));
      break;
    case 'date':
    case 'created_time':
    case 'edited_time':
      add(dateBucketOf(v, axis));
      break;
    case 'formula':
    case 'rollup':
      computedBuckets(v as ComputedValue, axis, add, 0);
      break;
    default:
      break;
  }
  return out.size ? [...out.values()] : [axis.empty];
}

/** Options in option order, Unchecked before Checked, numbers and dates in order, then A→Z. */
function natural(a: Bucket, b: Bucket): number {
  if (a.group !== b.group) return a.group - b.group;
  if (a.rank !== null && b.rank !== null && a.rank !== b.rank) return a.rank - b.rank;
  return compareText(a.label, b.label) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

// ------------------------------------------------------------------ values

/** Entries in one place: a category, a series, or one category of one series. */
interface Cell {
  count: number;
  /** Numbers of the entries that have one (scaled, see decimal.ts). */
  values: bigint[];
  /** Indexes into the rows, ascending, each once. */
  rows: number[];
}

const newCell = (): Cell => ({ count: 0, values: [], rows: [] });
const NO_ENTRIES: Cell = newCell();

function addEntry(cell: Cell, row: number, value: bigint | null): void {
  cell.count += 1;
  if (value !== null) cell.values.push(value);
  if (cell.rows[cell.rows.length - 1] !== row) cell.rows.push(row);
}

function mergeRows(a: readonly number[], b: readonly number[]): number[] {
  const out: number[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    const x = a[i];
    const y = b[j];
    if (y === undefined || (x !== undefined && x < y)) {
      out.push(x as number);
      i += 1;
    } else if (x === undefined || y < x) {
      out.push(y);
      j += 1;
    } else {
      out.push(x);
      i += 1;
      j += 1;
    }
  }
  return out;
}

/** Adds `from` into `into`; rows only when `withRows` (cumulative totals keep their own rows). */
function mergeCell(into: Cell, from: Cell, withRows: boolean): void {
  into.count += from.count;
  for (const v of from.values) into.values.push(v);
  if (withRows) into.rows = mergeRows(into.rows, from.rows);
}

const compareBig = (a: bigint, b: bigint): number => (a < b ? -1 : a > b ? 1 : 0);

function sumOf(values: readonly bigint[]): bigint {
  let total = 0n;
  for (const v of values) total += v;
  return total;
}

/** The exact result; sum of nothing is 0, average, median, min and max of nothing are null. */
function aggregateCell(cell: Cell, aggregate: Aggregate): string | null {
  const values = cell.values;
  switch (aggregate) {
    case 'count':
      return String(cell.count);
    case 'sum':
      return fromScaled(sumOf(values));
    case 'average':
      return values.length ? divideDecimal(fromScaled(sumOf(values)), String(values.length)) : null;
    case 'median': {
      if (!values.length) return null;
      const sorted = [...values].sort(compareBig);
      const mid = Math.floor(sorted.length / 2);
      const hi = sorted[mid] ?? 0n;
      if (sorted.length % 2) return fromScaled(hi);
      return divideDecimal(fromScaled((sorted[mid - 1] ?? 0n) + hi), '2');
    }
    case 'min':
    case 'max': {
      let best: bigint | null = null;
      for (const v of values) {
        if (best === null || (aggregate === 'min' ? v < best : v > best)) best = v;
      }
      return best === null ? null : fromScaled(best);
    }
  }
}

function numberFormatOf(prop: Property | null): DecimalFormat {
  const c = prop?.config;
  const d =
    c?.type === 'number' ? c : c?.type === 'formula' || c?.type === 'rollup' ? c.number : null;
  return d ? { format: d.format, decimals: d.decimals, currency: d.currency } : PLAIN_FORMAT;
}

function formatNumber(exact: string, format: DecimalFormat): string {
  try {
    return formatDecimal(exact, format);
  } catch {
    // An unknown currency code: show the plain number instead.
    return formatDecimal(exact, PLAIN_FORMAT);
  }
}

function chartNumber(exact: string | null, format: DecimalFormat): ChartNumber {
  if (exact === null) return { exact: null, value: null, text: '' };
  return { exact, value: decimalToNumber(exact), text: formatNumber(exact, format) };
}

/** Higher or lower values first (dir 1: ascending), always with nothing to show last. */
function byExact(a: string | null, b: string | null, dir: 1 | -1): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  return compareDecimal(a, b) * dir;
}

function valueOf(row: Row, prop: Property | null, ctx: EvalContext): bigint | null {
  if (!prop) return null;
  const v: unknown = readValue(row, prop, ctx);
  if (prop.config.type === 'number') return isCanonicalDecimal(v) ? toScaled(v) : null;
  if (typeof v === 'object' && v !== null && 'kind' in v && v.kind === 'number' && 'value' in v) {
    const d = typeof v.value === 'number' ? numberToDecimal(v.value) : null;
    return d === null ? null : toScaled(d);
  }
  return null;
}

// ------------------------------------------------------------------ chart data

interface Resolved {
  x: Property;
  split: Property | null;
  /** null for counts. */
  value: Property | null;
  aggregate: Aggregate;
}

function resolve(chart: ChartOptions, properties: readonly Property[]): Resolved | ChartProblem {
  if (chart.xPropertyId === null) return 'choose_category';
  const x = findProperty(properties, chart.xPropertyId);
  if (!x) return 'property_unavailable';
  if (!canChartBy(x)) return 'invalid_settings';
  let split: Property | null = null;
  if (chart.splitBy !== null && !isRound(chart.kind)) {
    split = findProperty(properties, chart.splitBy) ?? null;
    if (!split) return 'property_unavailable';
    if (!canChartBy(split)) return 'invalid_settings';
  }
  const aggregate = chart.value.aggregate;
  if (!oneOf(Object.keys(AGGREGATE_LABELS) as Aggregate[], aggregate)) return 'invalid_settings';
  if (aggregate === 'count') return { x, split, value: null, aggregate };
  if (chart.value.propertyId === null) return 'invalid_settings';
  const value = findProperty(properties, chart.value.propertyId);
  if (!value) return 'property_unavailable';
  if (!canChartValue(value)) return 'invalid_settings';
  return { x, split, value, aggregate };
}

const NOTHING: ChartNumber = { exact: null, value: null, text: '' };

interface Slot {
  bucket: Bucket;
  all: Cell;
}
interface CategorySlot extends Slot {
  /** By series key (before the split limit). */
  cells: Map<string, Cell>;
}

function getOr<V>(map: Map<string, V>, key: string, make: () => V): V {
  let v = map.get(key);
  if (v === undefined) {
    v = make();
    map.set(key, v);
  }
  return v;
}

/** Every bucket from the first date to the last; only the latest `limit` when there are more. */
function filledDates(buckets: readonly Bucket[], axis: Axis, limit: number): Bucket[] {
  let first: CalendarDate | null = null;
  let last: CalendarDate | null = null;
  for (const b of buckets) {
    if (b.day === null) continue;
    if (first === null || b.day < first) first = b.day;
    if (last === null || b.day > last) last = b.day;
  }
  if (first === null || last === null) return [...buckets];
  let start = last;
  for (let i = 1; i < limit && start > first; i += 1) start = stepBucket(start, axis.size, -1);
  const out: Bucket[] = [];
  for (let d = start; d <= last; d = stepBucket(d, axis.size, 1))
    out.push(dateBucket(d, axis.size));
  return out;
}

/** Colour of a regular category or series: its option colour with Auto, else the palette's nth. */
function colorFor(bucket: Bucket, index: number, palette: ChartPalette): ChartColor {
  if (palette === 'default' && bucket.color) return { color: bucket.color };
  return paletteColor(palette, index);
}

interface Placed {
  key: string;
  label: string;
  color: ChartColor;
}

/** Keeps the regular buckets in natural order, then "Other" and "No value" when they have entries. */
function placeColors(
  regular: readonly Bucket[],
  palette: ChartPalette,
  other: boolean,
  empty: Bucket | null,
): Map<string, Placed> {
  const out = new Map<string, Placed>();
  [...regular].sort(natural).forEach((b, i) => {
    out.set(b.key, { key: b.key, label: b.label, color: colorFor(b, i, palette) });
  });
  if (other) out.set(OTHER_KEY, { key: OTHER_KEY, label: 'Other', color: { ...OTHER_COLOR } });
  if (empty) {
    out.set(EMPTY_GROUP, { key: EMPTY_GROUP, label: empty.label, color: { ...EMPTY_COLOR } });
  }
  return out;
}

/** Top `limit` buckets by value (ties in natural order); the rest go into "Other". */
function topByValue(
  buckets: readonly Bucket[],
  limit: number,
  valueOfKey: (key: string) => string | null,
): Set<string> {
  const ranked = [...buckets].sort(
    (a, b) => byExact(valueOfKey(a.key), valueOfKey(b.key), -1) || natural(a, b),
  );
  return new Set(ranked.slice(0, limit).map((b) => b.key));
}

/**
 * Chart data for a Chart view. `rows` are the view's rows after its filter, in view order (the
 * rows its table shows), so counts match the table, the filter and "View as table".
 */
export function chartData(
  rows: readonly Row[],
  view: Pick<View, 'chart'>,
  ctx: EvalContext,
): ChartData {
  const chart = view.chart ?? BLANK_CHART;
  const valueLabel = chartValueLabel(chart.value, ctx.properties);
  const resolved = resolve(chart, ctx.properties);
  if (typeof resolved === 'string') {
    const split = chart.splitBy !== null && !isRound(chart.kind);
    return {
      problem: resolved,
      categories: [],
      series: [],
      total: NOTHING,
      valueLabel,
      table: [],
      display: displayOf(chart, split, false),
    };
  }

  const { aggregate } = resolved;
  const xAxis = axisOf(resolved.x, ctx, chart.xDateBucket);
  const splitAxis = resolved.split ? axisOf(resolved.split, ctx, chart.xDateBucket) : null;
  const display = displayOf(chart, splitAxis !== null, xAxis.options.size > 0);
  const hideEmpty = chart.hideEmpty === true;
  const format = aggregate === 'count' ? COUNT_FORMAT : numberFormatOf(resolved.value);
  const unsplit: Bucket = {
    key: VALUE_SERIES_KEY,
    label: valueLabel,
    group: 0,
    rank: 0,
    color: null,
    day: null,
  };

  // 1. Entries: each row once in each of its categories and each of its split values.
  const cats = new Map<string, CategorySlot>();
  const seriesSlots = new Map<string, Slot>();
  const grand = newCell();
  rows.forEach((row, index) => {
    const xs = bucketsOf(row, xAxis);
    const ss = splitAxis ? bucketsOf(row, splitAxis) : [unsplit];
    const value = aggregate === 'count' ? null : valueOf(row, resolved.value, ctx);
    for (const x of xs) {
      if (hideEmpty && x.key === EMPTY_GROUP) continue;
      for (const s of ss) {
        if (hideEmpty && s.key === EMPTY_GROUP) continue;
        const cat = getOr(cats, x.key, () => ({ bucket: x, all: newCell(), cells: new Map() }));
        addEntry(cat.all, index, value);
        addEntry(getOr(cat.cells, s.key, newCell), index, value);
        addEntry(
          getOr(seriesSlots, s.key, () => ({ bucket: s, all: newCell() })).all,
          index,
          value,
        );
        addEntry(grand, index, value);
      }
    }
  });
  const catValue = (key: string): string | null =>
    aggregateCell(cats.get(key)?.all ?? NO_ENTRIES, aggregate);

  // 2. Categories: the limit, with the rest as "Other".
  const limit = LIMITS.chartCategories;
  const regularMap = new Map<string, Bucket>();
  for (const b of xAxis.fixed) regularMap.set(b.key, b);
  for (const [key, cat] of cats) if (key !== EMPTY_GROUP) regularMap.set(key, cat.bucket);
  let regular = [...regularMap.values()];
  if (xAxis.dates) {
    regular = filledDates(regular, xAxis, limit);
  } else if (regular.length > limit) {
    const keep = topByValue(regular, limit, catValue);
    regular = regular.filter((b) => keep.has(b.key));
  }
  const kept = new Set(regular.map((b) => b.key));
  const catKeyOf = (key: string): string =>
    key === EMPTY_GROUP || kept.has(key) ? key : OTHER_KEY;
  let hasOther = false;
  for (const key of cats.keys()) if (catKeyOf(key) === OTHER_KEY) hasOther = true;
  const emptyCat = cats.get(EMPTY_GROUP)?.bucket ?? null;
  const catPlaces = placeColors(regular, display.palette, hasOther, emptyCat);

  // 3. Series: the split limit, with the rest as "Other"; or one series when not split.
  let seriesRegular = [...seriesSlots.values()]
    .map((s) => s.bucket)
    .filter((b) => b.key !== EMPTY_GROUP);
  if (splitAxis && seriesRegular.length > LIMITS.chartSplits) {
    const seriesValue = (key: string): string | null =>
      aggregateCell(seriesSlots.get(key)?.all ?? NO_ENTRIES, aggregate);
    const keep = topByValue(seriesRegular, LIMITS.chartSplits, seriesValue);
    seriesRegular = seriesRegular.filter((b) => keep.has(b.key));
  }
  if (!splitAxis) seriesRegular = [unsplit];
  const keptSeries = new Set(seriesRegular.map((b) => b.key));
  const seriesKeyOf = (key: string): string =>
    key === EMPTY_GROUP || keptSeries.has(key) ? key : OTHER_KEY;
  let seriesOther = false;
  for (const key of seriesSlots.keys()) if (seriesKeyOf(key) === OTHER_KEY) seriesOther = true;
  const emptySeries = seriesSlots.get(EMPTY_GROUP)?.bucket ?? null;
  const seriesPlaces = placeColors(seriesRegular, display.palette, seriesOther, emptySeries);

  // 4. Cells after the limits.
  const grid = new Map<string, Map<string, Cell>>();
  const catAll = new Map<string, Cell>();
  for (const [key, cat] of cats) {
    const ck = catKeyOf(key);
    mergeCell(getOr(catAll, ck, newCell), cat.all, true);
    const line = getOr(grid, ck, () => new Map<string, Cell>());
    for (const [sk, cell] of cat.cells)
      mergeCell(getOr(line, seriesKeyOf(sk), newCell), cell, true);
  }

  // 5. Category order.
  const placedValue = (key: string): string | null =>
    aggregateCell(catAll.get(key) ?? NO_ENTRIES, aggregate);
  const byValueOrder = chart.order === 'value_asc' || chart.order === 'value_desc';
  const compare = (a: Bucket, b: Bucket): number => {
    if (byValueOrder) {
      const dir = chart.order === 'value_asc' ? 1 : -1;
      return byExact(placedValue(a.key), placedValue(b.key), dir) || natural(a, b);
    }
    if (chart.order === 'alphabetical' && !xAxis.dates) {
      return compareText(a.label, b.label) || natural(a, b);
    }
    return natural(a, b);
  };
  const orderedKeys: string[] = [];
  // Earlier dates come before the shown ones, unless sorted by value.
  const otherFirst = xAxis.dates && !byValueOrder;
  if (hasOther && otherFirst) orderedKeys.push(OTHER_KEY);
  for (const b of [...regular].sort(compare)) orderedKeys.push(b.key);
  if (hasOther && !otherFirst) orderedKeys.push(OTHER_KEY);
  if (emptyCat) orderedKeys.push(EMPTY_GROUP);

  const seriesKeys: string[] = [...seriesRegular].sort(natural).map((b) => b.key);
  if (seriesOther) seriesKeys.push(OTHER_KEY);
  if (emptySeries) seriesKeys.push(EMPTY_GROUP);

  // 6. Points, running totals when cumulative.
  const idsOf = (cell: Cell): Id[] => cell.rows.map((i) => rows[i]?.id ?? '');
  const pointsFor = (cellAt: (catKey: string) => Cell): ChartPoint[] => {
    const running = newCell();
    return orderedKeys.map((ck) => {
      const cell = cellAt(ck);
      let source = cell;
      if (display.cumulative) {
        mergeCell(running, cell, false);
        source = running;
      }
      return { ...chartNumber(aggregateCell(source, aggregate), format), rowIds: idsOf(cell) };
    });
  };

  const totals = pointsFor((ck) => catAll.get(ck) ?? NO_ENTRIES);
  const categories: ChartCategory[] = orderedKeys.map((key, i) => {
    const place = catPlaces.get(key);
    return {
      key,
      label: place?.label ?? key,
      color: place?.color ?? { ...OTHER_COLOR },
      total: totals[i] ?? { ...NOTHING, rowIds: [] },
    };
  });
  const series: ChartSeries[] = seriesKeys.map((key) => {
    const place = seriesPlaces.get(key);
    return {
      key,
      label: place?.label ?? key,
      color: place?.color ?? { ...OTHER_COLOR },
      values: pointsFor((ck) => grid.get(ck)?.get(key) ?? NO_ENTRIES),
    };
  });

  const table: ChartTableRow[] = [];
  categories.forEach((cat, i) => {
    for (const s of series) {
      const point = s.values[i];
      table.push({
        categoryKey: cat.key,
        category: cat.label,
        seriesKey: s.key,
        series: s.label,
        exact: point?.exact ?? null,
        text: point?.text ?? '',
      });
    }
  });

  return {
    problem: null,
    categories,
    series,
    total: chartNumber(aggregateCell(grand, aggregate), format),
    valueLabel,
    table,
    display,
  };
}
