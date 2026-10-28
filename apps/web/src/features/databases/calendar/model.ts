/**
 * The calendar's date maths, without React: the days on screen, which rows sit on which day, and
 * the value a row gets when it moves. Dates without a time never shift; times are read in the
 * value's own time zone when it has one, else the viewer's.
 */
import {
  addDays,
  addMonths,
  dateValueDays,
  dayOfWeek,
  daysBetween,
  endOfMonth,
  endOfWeek,
  epochDays,
  isValidDateValue,
  startOfMonth,
  startOfWeek,
  toCalendarDate,
  zonedParts,
  zonedToInstant,
  type CalendarDate,
  type DateValue,
  type WeekDay,
} from '@carehub/databases';

export type CalendarMode = 'month' | 'week';

/** Items a month day shows before "+N more" (spec: more than 3 items shows "+N more"). */
export const DAY_ITEM_LIMIT = 3;

export interface CalendarDay {
  date: CalendarDate;
  /** In the month on show (always true in week mode). */
  inMonth: boolean;
  today: boolean;
  weekend: boolean;
}

export const isWeekend = (date: CalendarDate): boolean => {
  const day = dayOfWeek(date);
  return day === 0 || day === 6;
};

/**
 * The weeks on screen, each from the viewer's week start: in month mode the weeks holding the
 * month's first to last day, in week mode the week holding `anchor`. Without weekends, Saturday
 * and Sunday are left out.
 */
export function calendarWeeks(
  anchor: CalendarDate,
  mode: CalendarMode,
  weekStart: WeekDay,
  today: CalendarDate,
  showWeekends: boolean,
): CalendarDay[][] {
  const first = startOfWeek(mode === 'month' ? startOfMonth(anchor) : anchor, weekStart);
  const last = endOfWeek(mode === 'month' ? endOfMonth(anchor) : anchor, weekStart);
  const month = anchor.slice(0, 7);
  const weeks: CalendarDay[][] = [];
  for (let start = first; start <= last; start = addDays(start, 7)) {
    const week: CalendarDay[] = [];
    for (let i = 0; i < 7; i += 1) {
      const date = addDays(start, i);
      const weekend = isWeekend(date);
      if (weekend && !showWeekends) continue;
      week.push({
        date,
        inMonth: mode === 'week' || date.slice(0, 7) === month,
        today: date === today,
        weekend,
      });
    }
    weeks.push(week);
  }
  return weeks;
}

/** The weekdays in column order (0 = Sunday), from the week start, without weekends if hidden. */
export function weekdayOrder(weekStart: WeekDay, showWeekends: boolean): WeekDay[] {
  const days: WeekDay[] = [];
  for (let i = 0; i < 7; i += 1) {
    const day = ((weekStart + i) % 7) as WeekDay;
    if (showWeekends || (day !== 0 && day !== 6)) days.push(day);
  }
  return days;
}

/** Previous (-1) or next (1) month or week. A month step lands on the 1st. */
export function stepAnchor(anchor: CalendarDate, mode: CalendarMode, step: 1 | -1): CalendarDate {
  return mode === 'month' ? addMonths(startOfMonth(anchor), step) : addDays(anchor, 7 * step);
}

/** One step with the arrow keys: a day sideways, a week up or down, over hidden weekends. */
export function stepDay(
  date: CalendarDate,
  key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown',
  showWeekends: boolean,
): CalendarDate {
  const step = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : key === 'ArrowUp' ? -7 : 7;
  let next = addDays(date, step);
  const direction = step > 0 ? 1 : -1;
  while (!showWeekends && isWeekend(next)) next = addDays(next, direction);
  return next;
}

// ---------------------------------------------------------------- rows on days

/** A row's place on the calendar: the days it covers and the time it starts at. */
export interface DatedRow {
  id: string;
  start: CalendarDate;
  end: CalendarDate;
  /** Wall-clock start for values with a time; null for whole days. */
  time: { hour: number; minute: number } | null;
}

/** The time zone a value is read in: its own (fixed) zone if it has one, else the viewer's. */
export const valueZone = (value: DateValue, viewerZone: string): string =>
  value.hasTime ? (value.timeZone ?? viewerZone) : viewerZone;

/** Where a row sits, or null when its value isn't a date (the "No date" list). */
export function datedRow(id: string, value: unknown, viewerZone: string): DatedRow | null {
  if (!isValidDateValue(value)) return null;
  const zone = valueZone(value, viewerZone);
  const days = dateValueDays(value, zone);
  const time = value.hasTime ? zonedParts(value.start, zone) : null;
  return {
    id,
    start: days.start,
    end: days.end < days.start ? days.start : days.end,
    time: time ? { hour: time.hour, minute: time.minute } : null,
  };
}

/** Which part of a row a day shows: all of it, or the start, middle or end of a range. */
export type DayPart = 'single' | 'start' | 'middle' | 'end';

export interface DayItem {
  id: string;
  part: DayPart;
  /** On the day it starts only. */
  time: DatedRow['time'];
}

/**
 * The rows on each day on screen, in order: whole days and ranges first, then rows with a time
 * by their time, otherwise in the view's order. A range shows on every day it covers.
 */
export function itemsByDay(
  rows: readonly DatedRow[],
  days: readonly CalendarDate[],
): Map<CalendarDate, DayItem[]> {
  const byDay = new Map<CalendarDate, DayItem[]>(days.map((day) => [day, []]));
  if (days.length === 0) return byDay;
  const sorted = [...days].sort();
  const first = sorted[0] as CalendarDate;
  const last = sorted[sorted.length - 1] as CalendarDate;
  const order = [...rows].sort((a, b) => sortKey(a) - sortKey(b));
  for (const row of order) {
    const from = row.start > first ? row.start : first;
    const to = row.end < last ? row.end : last;
    for (let day = from; day <= to; day = addDays(day, 1)) {
      const items = byDay.get(day);
      if (!items) continue;
      const part: DayPart =
        row.start === row.end
          ? 'single'
          : day === row.start
            ? 'start'
            : day === row.end
              ? 'end'
              : 'middle';
      items.push({ id: row.id, part, time: day === row.start ? row.time : null });
    }
  }
  return byDay;
}

/** Whole days (and ranges) before times; Array.sort is stable, so ties keep the view's order. */
const sortKey = (row: DatedRow): number => (row.time ? row.time.hour * 60 + row.time.minute : -1);

/** The items a month day shows, and how many are left for "+N more". */
export function visibleItems<T>(
  items: readonly T[],
  limit: number | null,
): { shown: T[]; more: number } {
  if (limit === null || items.length <= limit) return { shown: [...items], more: 0 };
  return { shown: items.slice(0, limit), more: items.length - limit };
}

// ---------------------------------------------------------------- moving

/** A whole day, for a row made on a day or given one from "No date". */
export const dayValue = (date: CalendarDate): DateValue => ({
  start: date,
  end: null,
  hasTime: false,
});

/**
 * The value moved by a number of days: a range keeps its length and times keep their time on
 * the clock (in the value's zone), so a 3:30 PM visit is still at 3:30 PM on its new day.
 */
export function shiftDateValue(value: DateValue, days: number, viewerZone: string): DateValue {
  if (!value.hasTime) {
    return {
      ...value,
      start: addDays(value.start, days),
      end: value.end === null ? null : addDays(value.end, days),
    };
  }
  const zone = valueZone(value, viewerZone);
  const move = (instant: string) => {
    const p = zonedParts(instant, zone);
    return zonedToInstant(addDays(toCalendarDate(p), days), p.hour, p.minute, zone);
  };
  return { ...value, start: move(value.start), end: value.end === null ? null : move(value.end) };
}

/** The value dragged from one day to another (a range can be grabbed on any of its days). */
export const moveDateValue = (
  value: DateValue,
  from: CalendarDate,
  to: CalendarDate,
  viewerZone: string,
): DateValue => shiftDateValue(value, daysBetween(from, to), viewerZone);

/** The value with its start on `date`, keeping its length and time ("Move to date"). */
export function moveStartTo(value: DateValue, date: CalendarDate, viewerZone: string): DateValue {
  const start = dateValueDays(value, valueZone(value, viewerZone)).start;
  return shiftDateValue(value, daysBetween(start, date), viewerZone);
}

/**
 * The value with its end on `date` (dragging the end of a card), keeping the end's time. An end
 * before the start stops at the start.
 */
export function withEndDay(value: DateValue, date: CalendarDate, viewerZone: string): DateValue {
  const zone = valueZone(value, viewerZone);
  const { start } = dateValueDays(value, zone);
  const day = date < start ? start : date;
  if (!value.hasTime) {
    return { ...value, end: day === value.start && value.end === null ? null : day };
  }
  const p = zonedParts(value.end ?? value.start, zone);
  const end = zonedToInstant(day, p.hour, p.minute, zone);
  return { ...value, end: Date.parse(end) < Date.parse(value.start) ? value.start : end };
}

export const sameDateValue = (a: DateValue, b: DateValue): boolean =>
  a.start === b.start && a.end === b.end && a.hasTime === b.hasTime;

/** How many days a range covers (1 for a single day). */
export const spanDays = (row: Pick<DatedRow, 'start' | 'end'>): number =>
  epochDays(row.end) - epochDays(row.start) + 1;
