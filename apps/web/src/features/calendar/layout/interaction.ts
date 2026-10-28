import { addDays, addMinutes, datePart, daysBetween, minutesBetween } from '@carehub/team-time';
import type { CivilDate, CivilDateTime } from '@carehub/team-time';
import { atMinute, minuteOfDay } from './civil';
import { dateSpan, timedBounds } from './items';
import {
  DEFAULT_EVENT_MINUTES,
  MIN_DURATION_MINUTES,
  MINUTES_PER_DAY,
  STEP_MINUTES,
} from './types';
import type { CalendarItem, ItemTimes } from './types';

/** The time grid's size on screen. */
export interface GridGeometry {
  /** Width of all the day columns together, in px (without the hour labels). */
  width: number;
  /** Height of one hour, in px. */
  hourHeight: number;
  /** The day columns, from viewRange(...).days. */
  days: readonly CivilDate[];
}

/** Pixels from the top-left corner of the first day column at 00:00 (include the scroll offset). */
export interface GridPoint {
  x: number;
  y: number;
}

export interface Slot {
  dayIndex: number;
  date: CivilDate;
  start: CivilDateTime;
}

export interface Shift {
  days?: number;
  /** Rounded to 15-minute steps. */
  minutes?: number;
}

/** Rounds minutes to a step: 'floor' finds the slot under a click, 'round' follows a drag. */
export function snapMinutes(
  minutes: number,
  mode: 'floor' | 'round' = 'round',
  step = STEP_MINUTES,
): number {
  const steps = mode === 'floor' ? Math.floor(minutes / step) : Math.round(minutes / step);
  return steps * step || 0;
}

/** The 15-minute slot under a point: where a click or long-press makes an event. */
export function slotAt(point: GridPoint, grid: GridGeometry): Slot {
  const dayIndex = columnAt(point.x, grid);
  const date = grid.days[dayIndex];
  if (date === undefined) throw new RangeError('The grid has no day columns');
  const minute = snapMinutes(toMinutes(point.y, grid), 'floor');
  return {
    dayIndex,
    date,
    start: atMinute(date, Math.min(Math.max(minute, 0), MINUTES_PER_DAY - STEP_MINUTES)),
  };
}

/** A drag from one point to another: moves in 15-minute steps and across day columns. */
export function dragMove(
  item: CalendarItem,
  from: GridPoint,
  to: GridPoint,
  grid: GridGeometry,
): ItemTimes {
  return moveItem(item, { days: dayShift(from, to, grid), minutes: pixelMinutes(from, to, grid) });
}

/** A drag of the bottom edge: changes the end in 15-minute steps (null for all-day items). */
export function dragResize(
  item: CalendarItem,
  from: GridPoint,
  to: GridPoint,
  grid: GridGeometry,
): ItemTimes | null {
  return resizeItem(item, {
    days: dayShift(from, to, grid),
    minutes: pixelMinutes(from, to, grid),
  });
}

/**
 * Moves an item, keeping its length on the wall clock. All-day items move by whole days only;
 * moving in Month passes days only, so times are kept.
 */
export function moveItem(item: CalendarItem, shift: Shift): ItemTimes {
  const days = Math.round(shift.days ?? 0);
  if (item.allDay) {
    const { first, last } = dateSpan(item);
    const end = item.end == null ? null : addDays(last, days);
    return { allDay: true, start: addDays(first, days), end };
  }
  const minutes = days * MINUTES_PER_DAY + snapMinutes(shift.minutes ?? 0);
  const { start, end } = timedBounds(item);
  return {
    allDay: false,
    start: addMinutes(start, minutes),
    end: item.end == null ? null : addMinutes(end, minutes),
  };
}

/**
 * Moves a timed item's end. A resize never makes it shorter than 15 minutes (an item that's
 * already shorter can only grow). Null for all-day items.
 */
export function resizeItem(item: CalendarItem, shift: Shift): ItemTimes | null {
  if (item.allDay) return null;
  const { start, end } = timedBounds(item);
  const length = minutesBetween(start, end);
  const change = Math.round(shift.days ?? 0) * MINUTES_PER_DAY + snapMinutes(shift.minutes ?? 0);
  const shortest = change > 0 ? MIN_DURATION_MINUTES : Math.min(length, MIN_DURATION_MINUTES);
  const next = Math.max(length + change, shortest);
  const keepOpen = next === length && item.end == null;
  return { allDay: false, start, end: keepOpen ? null : addMinutes(start, next) };
}

/** A new timed event (a slot click, the C shortcut, or an all-day item dropped into the hours). */
export function timedAt(start: CivilDateTime, minutes = DEFAULT_EVENT_MINUTES): ItemTimes {
  return { allDay: false, start, end: addMinutes(start, minutes) };
}

/** A new all-day item (a click in Month, or a timed item dropped onto the all-day row). */
export function allDayOn(date: CivilDate): ItemTimes {
  return { allDay: true, start: date, end: null };
}

/** The next :00 or :30 after now, for the C shortcut. */
export function nextHalfHour(now: CivilDateTime): CivilDateTime {
  return atMinute(datePart(now), (Math.floor(minuteOfDay(now) / 30) + 1) * 30);
}

function columnAt(x: number, grid: GridGeometry): number {
  const ratio = grid.width > 0 ? x / grid.width : 0;
  return Math.min(Math.max(Math.floor(ratio * grid.days.length), 0), grid.days.length - 1);
}

function dayShift(from: GridPoint, to: GridPoint, grid: GridGeometry): number {
  const [a, b] = [grid.days[columnAt(from.x, grid)], grid.days[columnAt(to.x, grid)]];
  return a === undefined || b === undefined ? 0 : daysBetween(a, b);
}

const toMinutes = (px: number, grid: GridGeometry): number =>
  grid.hourHeight > 0 ? (px / grid.hourHeight) * 60 : 0;

const pixelMinutes = (from: GridPoint, to: GridPoint, grid: GridGeometry): number =>
  toMinutes(to.y - from.y, grid);
