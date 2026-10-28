import { addDays, addMinutes, combine, dayOfWeek, timePart } from '@carehub/team-time';
import type { CivilDate, CivilDateTime } from '@carehub/team-time';

// Small helpers on top of @carehub/team-time. Wall clock only: every day is 1,440 minutes,
// so days with a clock change need no special cases.

/** 00:00 on a date. */
export const startOfDay = (date: CivilDate): CivilDateTime => combine(date, '00:00');

/** The date-time a number of minutes after 00:00 on a date (1440 is the next midnight). */
export const atMinute = (date: CivilDate, minutes: number): CivilDateTime =>
  addMinutes(startOfDay(date), minutes);

/** Minutes after midnight on the wall clock, 0 to 1439. */
export function minuteOfDay(dateTime: CivilDateTime): number {
  const time = timePart(dateTime);
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

export function isWeekend(date: CivilDate): boolean {
  const day = dayOfWeek(date);
  return day === 0 || day === 6;
}

/** Walks a number of days forward (back when negative); with skipWeekends, only weekdays count. */
export function stepDays(date: CivilDate, count: number, skipWeekends: boolean): CivilDate {
  let current = date;
  let left = Math.abs(count);
  while (left > 0) {
    current = addDays(current, Math.sign(count));
    if (!skipWeekends || !isWeekend(current)) left -= 1;
  }
  return current;
}

/** The first day of the month a date is in, moved by a number of months. */
export function monthStart(date: CivilDate, months = 0): CivilDate {
  const index = Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1 + months;
  const month = String((index % 12) + 1).padStart(2, '0');
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${month}-01` as CivilDate;
}
