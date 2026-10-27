// Small helpers on top of @carehub/team-time. Internal to this package.
import { combine, datePart, dayOfWeek, isCivilDate, isCivilDateTime } from '@carehub/team-time';
import type { CivilDate, CivilDateTime } from '@carehub/team-time';
import type { Civil, WeekdayCode } from './types';

/** WeekdayCode codes by `dayOfWeek` number (0 = Sunday). */
export const WEEKDAYS: readonly WeekdayCode[] = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

export const isCivil = (value: unknown): value is Civil =>
  isCivilDate(value) || isCivilDateTime(value);
export const sameKind = (a: Civil, b: Civil): boolean => isCivilDate(a) === isCivilDate(b);
export const dateOf = (value: Civil): CivilDate => (isCivilDate(value) ? value : datePart(value));

/** Comparable form: a date becomes its midnight, so dates and date-times sort together. */
export const at = (value: Civil): CivilDateTime =>
  isCivilDate(value) ? combine(value, '00:00') : value;

export const weekdayIndex = (day: WeekdayCode): number => WEEKDAYS.indexOf(day);
export const weekdayOf = (date: CivilDate): WeekdayCode => WEEKDAYS[dayOfWeek(date)] as WeekdayCode;
export const addWeekdays = (day: WeekdayCode, days: number): WeekdayCode =>
  WEEKDAYS[(((weekdayIndex(day) + days) % 7) + 7) % 7] as WeekdayCode;

const pad = (n: number, width: number) => String(n).padStart(width, '0');
export const ymd = (year: number, month: number, day: number): CivilDate =>
  `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}` as CivilDate;
export const parts = (date: CivilDate): [year: number, month: number, day: number] => [
  Number(date.slice(0, 4)),
  Number(date.slice(5, 7)),
  Number(date.slice(8, 10)),
];
