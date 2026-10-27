// Lengths and date math that stay inside team-time's range, 0001-01-01 to 9999-12-31.
import {
  addDays,
  addMinutes,
  datePart,
  daysBetween,
  isCivilDate,
  timePart,
} from '@carehub/team-time';
import type { CivilDate } from '@carehub/team-time';
import { dateOf } from './civil';
import { RepeatError } from './types';
import type { Civil } from './types';

export const FIRST_DATE: CivilDate = '0001-01-01';
export const LAST_DATE: CivilDate = '9999-12-31';

export function outOfRange(): never {
  throw new RepeatError('invalid-input', 'Dates must stay between 0001-01-01 and 9999-12-31.');
}

export const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/** Length of [start, end): days when either is a date, minutes otherwise. */
export function lengthOf(start: Civil, end: Civil): number {
  const days = daysBetween(dateOf(start), dateOf(end));
  if (isCivilDate(start) || isCivilDate(end)) return days;
  return days * 1440 + minutesOf(timePart(end)) - minutesOf(timePart(start));
}

/** `date` moved by `days`, or null when that leaves the range. */
export function tryAddDays(date: CivilDate, days: number): CivilDate | null {
  const room = daysBetween(date, days < 0 ? FIRST_DATE : LAST_DATE);
  return Math.abs(days) <= Math.abs(room) ? addDays(date, days) : null;
}

/** Adds a length from `lengthOf` (days to a date, minutes to a date-time); null out of range. */
export function tryPlus(value: Civil, length: number): Civil | null {
  if (isCivilDate(value)) return tryAddDays(value, length);
  const days = Math.floor((minutesOf(timePart(value)) + length) / 1440);
  return tryAddDays(datePart(value), days) === null ? null : addMinutes(value, length);
}

/** `tryPlus` for edits, where leaving the range is invalid input. */
export const plus = (value: Civil, length: number): Civil => tryPlus(value, length) ?? outOfRange();
