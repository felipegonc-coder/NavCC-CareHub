/**
 * The timeline's maths, without React: where each row's bar sits on the time line, the stretch of
 * time on screen, the header's labels, and the values a bar gets when it moves or changes length.
 *
 * Positions are in wall-clock minutes (minutes since Jan 1, 1970 on the clock in the viewer's
 * zone, or the value's own zone), so every day is the same width, daylight saving or not.
 */
import {
  addDays,
  dayOfWeek,
  epochDays,
  fromEpochDays,
  isValidDateValue,
  startOfMonth,
  startOfWeek,
  toCalendarDate,
  zonedParts,
  zonedToInstant,
  type CalendarDate,
  type DateValue,
  type Id,
  type TimelineOptions,
  type WeekDay,
} from '@carehub/databases';
import type { QueryGroup, QueryRow } from '@carehub/databases/engine';

export type TimelineScale = TimelineOptions['scale'];

export const TIMELINE_SCALES: readonly TimelineScale[] = [
  'hours',
  'day',
  'week',
  'bi_week',
  'month',
  'quarter',
  'year',
];

export const DAY_MINUTES = 1440;

interface ScaleSpec {
  /** Width of one day, px. */
  dayWidth: number;
  /** Days shown before the first bar (or today) and after the last. */
  padDays: number;
  /** The most days drawn at once; longer stretches are centred on today. */
  maxDays: number;
  /** One step of a drag or an arrow key, minutes (dates without a time move by whole days). */
  stepMinutes: number;
}

export const SCALE_SPECS: Readonly<Record<TimelineScale, ScaleSpec>> = {
  hours: { dayWidth: 960, padDays: 1, maxDays: 14, stepMinutes: 15 },
  day: { dayWidth: 120, padDays: 7, maxDays: 120, stepMinutes: DAY_MINUTES },
  week: { dayWidth: 60, padDays: 14, maxDays: 365, stepMinutes: DAY_MINUTES },
  bi_week: { dayWidth: 30, padDays: 28, maxDays: 730, stepMinutes: DAY_MINUTES },
  month: { dayWidth: 12, padDays: 62, maxDays: 1460, stepMinutes: DAY_MINUTES },
  quarter: { dayWidth: 5, padDays: 124, maxDays: 2920, stepMinutes: DAY_MINUTES },
  year: { dayWidth: 2, padDays: 366, maxDays: 5840, stepMinutes: DAY_MINUTES },
};

export const asDateValue = (value: unknown): DateValue | null =>
  isValidDateValue(value) ? value : null;

const zoneOf = (value: DateValue, viewerZone: string): string =>
  value.hasTime ? (value.timeZone ?? viewerZone) : viewerZone;

/** Wall-clock minutes of a day's start. */
export const dayMinutes = (date: CalendarDate): number => epochDays(date) * DAY_MINUTES;

/** Wall-clock minutes of an exact moment in a time zone. */
export function instantMinutes(instant: string | Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  return dayMinutes(toCalendarDate(p)) + p.hour * 60 + p.minute;
}

/** The calendar day and clock time of wall-clock minutes. */
export function minutesToParts(minutes: number): {
  date: CalendarDate;
  hour: number;
  minute: number;
} {
  const days = Math.floor(minutes / DAY_MINUTES);
  const rest = minutes - days * DAY_MINUTES;
  return { date: fromEpochDays(days), hour: Math.floor(rest / 60), minute: rest % 60 };
}

/** A bar: where it starts and ends (end exclusive), in wall-clock minutes. */
export interface Bar {
  id: Id;
  start: number;
  end: number;
}

/**
 * Where a row's bar goes, or null without a start ("No date"). From one date property (its start
 * to its end) or, with `end`, from the start property to the end property. A start with no end
 * is a one-day bar; a time with no end, one hour.
 */
export function rowBar(
  id: Id,
  startValue: unknown,
  endValue: unknown,
  separateEnd: boolean,
  viewerZone: string,
): Bar | null {
  const first = asDateValue(startValue);
  if (!first) return null;
  const start = first.hasTime
    ? instantMinutes(first.start, zoneOf(first, viewerZone))
    : dayMinutes(first.start);
  const last = separateEnd ? asDateValue(endValue) : first;
  const endPoint = separateEnd ? (last ? (last.end ?? last.start) : null) : first.end;
  let end: number;
  if (!last || endPoint === null) end = first.hasTime ? start + 60 : start + DAY_MINUTES;
  else if (last.hasTime) end = instantMinutes(endPoint, zoneOf(last, viewerZone));
  else end = dayMinutes(endPoint) + DAY_MINUTES;
  return { id, start, end: Math.max(end, start + (first.hasTime ? 15 : DAY_MINUTES)) };
}

/** The stretch of days on screen. */
export interface TimeWindow {
  start: CalendarDate;
  days: number;
  scale: TimelineScale;
}

/**
 * The days drawn: from before the first bar (or today) to after the last, starting on a week
 * start (week and two weeks) or a month's 1st (month, quarter and year).
 */
export function timeWindow(
  bars: readonly Bar[],
  today: CalendarDate,
  scale: TimelineScale,
  weekStart: WeekDay,
): TimeWindow {
  const spec = SCALE_SPECS[scale];
  let first = epochDays(today);
  let last = first;
  for (const bar of bars) {
    first = Math.min(first, Math.floor(bar.start / DAY_MINUTES));
    last = Math.max(last, Math.floor((bar.end - 1) / DAY_MINUTES));
  }
  first -= spec.padDays;
  last += spec.padDays;
  if (last - first + 1 > spec.maxDays) {
    first = epochDays(today) - Math.floor(spec.maxDays / 2);
    last = first + spec.maxDays - 1;
  }
  const start = alignStart(fromEpochDays(first), scale, weekStart);
  return { start, days: last - epochDays(start) + 1, scale };
}

function alignStart(date: CalendarDate, scale: TimelineScale, weekStart: WeekDay): CalendarDate {
  if (scale === 'week' || scale === 'bi_week') return startOfWeek(date, weekStart);
  if (scale === 'month' || scale === 'quarter' || scale === 'year') return startOfMonth(date);
  return date;
}

/** The window with `before` more days at the start and `after` more at the end ("Earlier", "Later"). */
export function extendWindow(
  window: TimeWindow,
  before: number,
  after: number,
  weekStart: WeekDay,
): TimeWindow {
  if (before === 0 && after === 0) return window;
  const last = epochDays(window.start) + window.days - 1 + after;
  const start = alignStart(addDays(window.start, -before), window.scale, weekStart);
  return { start, days: last - epochDays(start) + 1, scale: window.scale };
}

/** px from the window's left edge. */
export const minutesToX = (window: TimeWindow, minutes: number): number =>
  ((minutes - dayMinutes(window.start)) / DAY_MINUTES) * SCALE_SPECS[window.scale].dayWidth;

export const windowWidth = (window: TimeWindow): number =>
  window.days * SCALE_SPECS[window.scale].dayWidth;

/** The day under a point `x` px from the window's left edge. */
export const dayAtX = (window: TimeWindow, x: number): CalendarDate =>
  addDays(window.start, Math.floor(x / SCALE_SPECS[window.scale].dayWidth));

// ---------------------------------------------------------------- the header

export interface Tick {
  key: string;
  x: number;
  width: number;
  /** The first day (or hour) the tick covers. */
  date: CalendarDate;
  hour: number | null;
}

/** The header's two rows: the larger unit above (months, days), the smaller below. */
export interface HeaderTicks {
  top: Tick[];
  bottom: Tick[];
  topUnit: 'day' | 'month' | 'quarter' | 'year';
  bottomUnit: 'hour' | 'day' | 'week' | 'month';
}

const UNITS: Readonly<Record<TimelineScale, [HeaderTicks['topUnit'], HeaderTicks['bottomUnit']]>> =
  {
    hours: ['day', 'hour'],
    day: ['month', 'day'],
    week: ['month', 'day'],
    bi_week: ['month', 'week'],
    month: ['month', 'week'],
    quarter: ['quarter', 'month'],
    year: ['year', 'month'],
  };

const unitStart = (
  date: CalendarDate,
  unit: Exclude<HeaderTicks['topUnit'] | HeaderTicks['bottomUnit'], 'hour'>,
  weekStart: WeekDay,
): CalendarDate => {
  switch (unit) {
    case 'day':
      return date;
    case 'week':
      return startOfWeek(date, weekStart);
    case 'month':
      return startOfMonth(date);
    case 'quarter': {
      const month = Number(date.slice(5, 7));
      return `${date.slice(0, 4)}-${String(month - ((month - 1) % 3)).padStart(2, '0')}-01`;
    }
    case 'year':
      return `${date.slice(0, 4)}-01-01`;
  }
};

function dayTicks(
  window: TimeWindow,
  unit: Exclude<HeaderTicks['topUnit'] | HeaderTicks['bottomUnit'], 'hour'>,
  weekStart: WeekDay,
): Tick[] {
  const width = SCALE_SPECS[window.scale].dayWidth;
  const ticks: Tick[] = [];
  for (let i = 0; i < window.days; i += 1) {
    const date = addDays(window.start, i);
    const begins = unitStart(date, unit, weekStart);
    const last = ticks[ticks.length - 1];
    if (last && last.key === begins) last.width += width;
    else ticks.push({ key: begins, x: i * width, width, date: begins, hour: null });
  }
  return ticks;
}

export function headerTicks(window: TimeWindow, weekStart: WeekDay): HeaderTicks {
  const [topUnit, bottomUnit] = UNITS[window.scale];
  const top = dayTicks(window, topUnit, weekStart);
  let bottom: Tick[];
  if (bottomUnit === 'hour') {
    const width = SCALE_SPECS[window.scale].dayWidth / 24;
    bottom = [];
    for (let i = 0; i < window.days * 24; i += 1) {
      const date = addDays(window.start, Math.floor(i / 24));
      bottom.push({ key: `${date}-${i % 24}`, x: i * width, width, date, hour: i % 24 });
    }
  } else {
    bottom = dayTicks(window, bottomUnit, weekStart);
  }
  return { top, bottom, topUnit, bottomUnit };
}

/** Saturdays and Sundays on screen, for shading (day and week scales). */
export function weekendDays(window: TimeWindow): CalendarDate[] {
  if (SCALE_SPECS[window.scale].dayWidth < 30) return [];
  const days: CalendarDate[] = [];
  for (let i = 0; i < window.days; i += 1) {
    const date = addDays(window.start, i);
    const day = dayOfWeek(date);
    if (day === 0 || day === 6) days.push(date);
  }
  return days;
}

// ---------------------------------------------------------------- changing dates

/** What a press on a bar changes. */
export type BarEdit = 'move' | 'start' | 'end';

/** One step for a value: 15 minutes on the Hours scale for times, otherwise a day. */
export const stepMinutes = (scale: TimelineScale, hasTime: boolean): number =>
  hasTime ? SCALE_SPECS[scale].stepMinutes : DAY_MINUTES;

/** The minutes a drag of `dx` px stands for, in whole steps (whole days for dates). */
export function dragMinutes(dx: number, scale: TimelineScale, hasTime = true): number {
  const { dayWidth } = SCALE_SPECS[scale];
  const step = stepMinutes(scale, hasTime);
  const minutes = (dx / dayWidth) * DAY_MINUTES;
  // `|| 0`: no -0 for a short drag to the left.
  return Math.round(minutes / step) * step || 0;
}

/** Moves one point of a value: whole days for dates, minutes on the clock for times. */
function shiftPoint(point: string, value: DateValue, minutes: number, viewerZone: string): string {
  if (!value.hasTime) return addDays(point, Math.round(minutes / DAY_MINUTES));
  const zone = zoneOf(value, viewerZone);
  const moved = minutesToParts(instantMinutes(point, zone) + minutes);
  return zonedToInstant(moved.date, moved.hour, moved.minute, zone);
}

const later = (a: string, b: string, hasTime: boolean): boolean =>
  hasTime ? Date.parse(a) > Date.parse(b) : a > b;

/** The value moved by `minutes`, keeping its length (whole days for dates without a time). */
export function shiftValue(value: DateValue, minutes: number, viewerZone: string): DateValue {
  return {
    ...value,
    start: shiftPoint(value.start, value, minutes, viewerZone),
    end: value.end === null ? null : shiftPoint(value.end, value, minutes, viewerZone),
  };
}

/**
 * The values to save when a bar is dragged or moved with the keys: the whole bar, its start or
 * its end, by `minutes`. A start never passes the end, nor an end the start. `endPropertyId` is
 * the separate end property, if the view has one.
 */
export function editedValues(
  edit: BarEdit,
  minutes: number,
  start: DateValue,
  end: DateValue | null,
  startPropertyId: Id,
  endPropertyId: Id | null,
  viewerZone: string,
): Record<Id, DateValue> {
  if (minutes === 0) return {};
  if (edit === 'move') {
    const values: Record<Id, DateValue> = {
      [startPropertyId]: shiftValue(start, minutes, viewerZone),
    };
    if (endPropertyId && end) values[endPropertyId] = shiftValue(end, minutes, viewerZone);
    return values;
  }
  if (!endPropertyId) {
    // One property holds the whole range.
    const last = start.end ?? start.start;
    if (edit === 'start') {
      const moved = shiftPoint(start.start, start, minutes, viewerZone);
      return {
        [startPropertyId]: {
          ...start,
          start: later(moved, last, start.hasTime) ? last : moved,
          end: last,
        },
      };
    }
    const moved = shiftPoint(last, start, minutes, viewerZone);
    return {
      [startPropertyId]: {
        ...start,
        end: later(start.start, moved, start.hasTime) ? start.start : moved,
      },
    };
  }
  const endValue = end ?? { start: start.end ?? start.start, end: null, hasTime: start.hasTime };
  const endPoint = endValue.end ?? endValue.start;
  if (edit === 'start') {
    const moved = shiftPoint(start.start, start, minutes, viewerZone);
    const limit = start.hasTime === endValue.hasTime ? endPoint : null;
    return {
      [startPropertyId]: {
        ...start,
        start: limit && later(moved, limit, start.hasTime) ? limit : moved,
      },
    };
  }
  const moved = shiftPoint(endPoint, endValue, minutes, viewerZone);
  const limit = start.hasTime === endValue.hasTime ? start.start : null;
  const point = limit && later(limit, moved, endValue.hasTime) ? limit : moved;
  return {
    [endPropertyId]:
      endValue.end === null ? { ...endValue, start: point } : { ...endValue, end: point },
  };
}

/** A whole day, for a row placed by clicking its empty line. */
export const dayValue = (date: CalendarDate): DateValue => ({
  start: date,
  end: null,
  hasTime: false,
});

/** Where a bar shows while it's dragged `minutes` (its start never passes its end). */
export function previewBar(bar: Bar, edit: BarEdit, minutes: number, minLength: number): Bar {
  if (edit === 'move') return { ...bar, start: bar.start + minutes, end: bar.end + minutes };
  if (edit === 'start')
    return { ...bar, start: Math.min(bar.start + minutes, bar.end - minLength) };
  return { ...bar, end: Math.max(bar.end + minutes, bar.start + minLength) };
}

/** The shortest a bar can be: a day for dates, 15 minutes for times. */
export const minBarMinutes = (hasTime: boolean): number => (hasTime ? 15 : DAY_MINUTES);

/** A bar's change while it's dragged or picked up with the keys, in minutes for each edit. */
export interface BarChange {
  move: number;
  start: number;
  end: number;
}

export const NO_CHANGE: BarChange = { move: 0, start: 0, end: 0 };

export const isNoChange = (change: BarChange): boolean =>
  change.move === 0 && change.start === 0 && change.end === 0;

/** Where a changed bar shows: moved, then its start, then its end. */
export function changedBar(bar: Bar, change: BarChange, minLength: number): Bar {
  const moved = previewBar(bar, 'move', change.move, minLength);
  return previewBar(
    previewBar(moved, 'start', change.start, minLength),
    'end',
    change.end,
    minLength,
  );
}

/** The values to save for a change: the move first, then the start, then the end. */
export function changedValues(
  change: BarChange,
  start: DateValue,
  end: DateValue | null,
  startPropertyId: Id,
  endPropertyId: Id | null,
  viewerZone: string,
): Record<Id, DateValue> {
  let values: Record<Id, DateValue> = {};
  let first = start;
  let last = end;
  for (const edit of ['move', 'start', 'end'] as const) {
    if (change[edit] === 0) continue;
    const next = editedValues(
      edit,
      change[edit],
      first,
      last,
      startPropertyId,
      endPropertyId,
      viewerZone,
    );
    values = { ...values, ...next };
    first = next[startPropertyId] ?? first;
    if (endPropertyId) last = next[endPropertyId] ?? last;
  }
  return values;
}

// ---------------------------------------------------------------- lines

/** One line of the timeline, the same height on the left (the table) and the right (the bars). */
export type TimelineLine =
  | { kind: 'group'; key: string; group: QueryGroup; collapsed: boolean }
  | { kind: 'row'; key: string; row: QueryRow; bar: Bar | null }
  | { kind: 'no-date'; key: string; count: number }
  | { kind: 'more'; key: string; groupKey: string | undefined };

/**
 * The lines from top to bottom. Grouped: each shown group's header, then its rows (none while
 * collapsed) and its "Load more". Not grouped: the rows with dates, then "No date" and the rows
 * without, then "Load more".
 */
export function timelineLines(
  rows: readonly QueryRow[],
  groups: readonly QueryGroup[] | null,
  bars: ReadonlyMap<Id, Bar>,
  collapsed: ReadonlySet<string>,
  hasMore: boolean,
): TimelineLine[] {
  const rowLine = (row: QueryRow): TimelineLine => ({
    kind: 'row',
    key: `row:${row.id}`,
    row,
    bar: bars.get(row.id) ?? null,
  });
  const lines: TimelineLine[] = [];
  if (groups) {
    for (const group of groups) {
      if (group.hidden) continue;
      const isCollapsed = collapsed.has(group.collapsedKey);
      lines.push({ kind: 'group', key: `group:${group.key}`, group, collapsed: isCollapsed });
      if (isCollapsed) continue;
      lines.push(...group.rows.map(rowLine));
      if (group.nextCursor)
        lines.push({ kind: 'more', key: `more:${group.key}`, groupKey: group.key });
    }
    return lines;
  }
  lines.push(...rows.filter((row) => bars.has(row.id)).map(rowLine));
  const undated = rows.filter((row) => !bars.has(row.id));
  if (undated.length > 0) {
    lines.push({ kind: 'no-date', key: 'no-date', count: undated.length });
    lines.push(...undated.map(rowLine));
  }
  if (hasMore) lines.push({ kind: 'more', key: 'more', groupKey: undefined });
  return lines;
}

// ---------------------------------------------------------------- dependency arrows

/** Where a bar sits on screen: its left and right edges and the middle of its line, px. */
export interface BarBox {
  left: number;
  right: number;
  y: number;
}

/** How far an arrow leaves a bar before it turns, and the size of its head, px. */
const ARROW_OUT = 8;
const ARROW_HEAD = 4;

const px = (n: number): number => Math.round(n * 10) / 10;

/**
 * An arrow from the end of a blocking bar to the start of the bar it blocks: the line and its
 * head, as SVG paths. When the blocked bar starts too soon to turn in front of it, the line goes
 * round, between the lines (`turn` px under or over the blocking bar's middle).
 */
export function arrowPath(from: BarBox, to: BarBox, turn: number): { line: string; head: string } {
  const x1 = px(from.right);
  const x2 = px(to.left);
  const out = x1 + ARROW_OUT;
  const line =
    x2 - x1 >= 2 * ARROW_OUT
      ? `M ${x1} ${from.y} H ${out} V ${to.y} H ${x2}`
      : `M ${x1} ${from.y} H ${out} V ${from.y + (to.y < from.y ? -turn : turn)} H ${px(x2 - ARROW_OUT)} V ${to.y} H ${x2}`;
  const head = `M ${x2} ${to.y} L ${x2 - ARROW_HEAD} ${to.y - ARROW_HEAD} L ${x2 - ARROW_HEAD} ${to.y + ARROW_HEAD} Z`;
  return { line, head };
}
