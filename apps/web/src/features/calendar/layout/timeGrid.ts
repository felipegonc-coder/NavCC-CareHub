import { addDays, datePart } from '@carehub/team-time';
import type { CivilDate, CivilDateTime } from '@carehub/team-time';
import { minuteOfDay, startOfDay } from './civil';
import { compareItems, dateSpan, timedBounds } from './items';
import { MINUTES_PER_DAY, NOW_LEAD_MINUTES, OPEN_AT_MINUTES, STEP_MINUTES } from './types';
import type { CalendarItem } from './types';

/** One drawn block: a timed item's part on one day column. */
export interface TimedPlacement<T extends CalendarItem = CalendarItem> {
  /** Unique per block: `<id>@<date>`. */
  key: string;
  item: T;
  dayIndex: number;
  date: CivilDate;
  /** This day's part of the item; an item crossing midnight has one block per day. */
  start: CivilDateTime;
  end: CivilDateTime;
  /** Minutes from 00:00; the height includes the minimum for short items. */
  top: number;
  height: number;
  /** Fractions (0 to 1) of the day column's width. */
  left: number;
  width: number;
  /** Column among the overlapping items it's drawn with, and how many columns they use. */
  column: number;
  columns: number;
  /** Started on an earlier day / carries on past midnight. */
  continuesBefore: boolean;
  continuesAfter: boolean;
}

export interface TimeGridOptions {
  /** Shortest drawn height in minutes (default 15). For pixels: px × 60 / hourHeight. */
  minHeight?: number;
}

export interface HourMark {
  hour: number;
  /** Minutes from 00:00. */
  minute: number;
  /** 'HH:mm'. */
  time: string;
  label: string;
}

const bottom = (placement: TimedPlacement): number => placement.top + placement.height;

/**
 * Lays out the timed items on the day columns (all-day items are left to the all-day row).
 * Overlapping items sit side by side in columns and widen into free columns to their right.
 * Returns one list per day, in reading order (top, then left).
 */
export function layoutTimeGrid<T extends CalendarItem>(
  items: readonly T[],
  days: readonly CivilDate[],
  options: TimeGridOptions = {},
): TimedPlacement<T>[][] {
  const minHeight = Math.min(Math.max(options.minHeight ?? STEP_MINUTES, 0), MINUTES_PER_DAY);
  const perDay = days.map((): TimedPlacement<T>[] => []);
  for (const item of items) {
    if (item.allDay) continue;
    const { start, end } = timedBounds(item);
    const { first, last } = dateSpan(item);
    days.forEach((date, dayIndex) => {
      if (date < first || date > last) return;
      const dayStart = startOfDay(date);
      const dayEnd = startOfDay(addDays(date, 1));
      const from = start > dayStart ? minuteOfDay(start) : 0;
      const to = end < dayEnd ? minuteOfDay(end) : MINUTES_PER_DAY;
      const height = Math.max(to - from, minHeight);
      perDay[dayIndex]?.push({
        key: `${item.id}@${date}`,
        item,
        dayIndex,
        date,
        start: start > dayStart ? start : dayStart,
        end: end < dayEnd ? end : dayEnd,
        top: Math.max(0, Math.min(from, MINUTES_PER_DAY - height)),
        height,
        left: 0,
        width: 1,
        column: 0,
        columns: 1,
        continuesBefore: start < dayStart,
        continuesAfter: end > dayEnd,
      });
    });
  }
  return perDay.map(placeColumns);
}

function placeColumns<T extends CalendarItem>(
  placements: TimedPlacement<T>[],
): TimedPlacement<T>[] {
  placements.sort((a, b) => a.top - b.top || bottom(b) - bottom(a) || compareItems(a.item, b.item));
  let group: TimedPlacement<T>[] = [];
  let columnEnds: number[] = [];
  let groupEnd = -Infinity;
  const finishGroup = () => {
    for (const placement of group) {
      let span = 1;
      while (
        placement.column + span < columnEnds.length &&
        !group.some(
          (other) =>
            other.column === placement.column + span &&
            other.top < bottom(placement) &&
            placement.top < bottom(other),
        )
      ) {
        span += 1;
      }
      placement.columns = columnEnds.length;
      placement.left = placement.column / columnEnds.length;
      placement.width = span / columnEnds.length;
    }
    group = [];
    columnEnds = [];
  };
  for (const placement of placements) {
    if (placement.top >= groupEnd) finishGroup();
    let column = columnEnds.findIndex((end) => end <= placement.top);
    if (column === -1) column = columnEnds.length;
    columnEnds[column] = bottom(placement);
    placement.column = column;
    group.push(placement);
    groupEnd = Math.max(groupEnd, bottom(placement));
  }
  finishGroup();
  return placements.sort((a, b) => a.top - b.top || a.left - b.left);
}

/** The 24 hour marks for the hour axis; `label` formats each one (12- or 24-hour time). */
export function hourAxis(label: (time: string, hour: number) => string): HourMark[] {
  return Array.from({ length: 24 }, (_, hour) => {
    const time = `${String(hour).padStart(2, '0')}:00`;
    return { hour, minute: hour * 60, time, label: label(time, hour) };
  });
}

/** Where to draw the "now" line, or null when today isn't shown. */
export function nowPosition(
  now: CivilDateTime,
  days: readonly CivilDate[],
): { dayIndex: number; minute: number } | null {
  const dayIndex = days.indexOf(datePart(now));
  return dayIndex === -1 ? null : { dayIndex, minute: minuteOfDay(now) };
}

/**
 * Minutes from 00:00 to scroll to on opening: 7:00 AM or, when today is shown and it's later, an
 * hour above the now line (never above 00:00).
 */
export function initialScrollMinutes(now: CivilDateTime, days: readonly CivilDate[]): number {
  const current = days.includes(datePart(now)) ? minuteOfDay(now) : 0;
  return current > OPEN_AT_MINUTES ? Math.max(current - NOW_LEAD_MINUTES, 0) : OPEN_AT_MINUTES;
}
