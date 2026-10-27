/**
 * Wall-clock ("civil") dates and times: plain strings with no time zone and no seconds, so they
 * sort and compare correctly with < and >. Arithmetic here is on the wall clock only: every day
 * has 24 hours and clock changes don't exist. `toInstant` and `toCivil` cross into real time.
 * Invalid input throws a RangeError.
 */

/** A calendar date, 'YYYY-MM-DD' (years 0001 to 9999). */
export type CivilDate = string;
/** A time of day on the wall clock, 'HH:mm' (00:00 to 23:59). */
export type CivilTime = string;
/** A wall-clock date and time, 'YYYY-MM-DDTHH:mm' (no seconds, no zone). */
export type CivilDateTime = string;
/** Day of the week: 0 = Sunday to 6 = Saturday. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
/** First day of the week in a person's settings: 0 = Sunday, 1 = Monday, 6 = Saturday. */
export type WeekStart = 0 | 1 | 6;

type Ymd = { year: number; month: number; day: number };

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_MS = 86_400_000;
const DAY_MINUTES = 1440;
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/** @internal Two-digit zero padding. */
export const pad2 = (n: number): string => String(n).padStart(2, '0');

function whole(n: number, what: string): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`${what} must be a whole number, got ${n}`);
  return n;
}

/** Days in a month; `month` is 1 (January) to 12 (December). */
export function daysInMonth(year: number, month: number): number {
  whole(year, 'year');
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`month must be 1 to 12, got ${month}`);
  }
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return month === 2 && leap ? 29 : MONTH_DAYS[month - 1]!;
}

function readDate(value: unknown): Ymd | null {
  const match = typeof value === 'string' ? DATE_RE.exec(value) : null;
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

function parseDate(value: CivilDate): Ymd {
  const ymd = readDate(value);
  if (!ymd) throw new RangeError(`Not a date (YYYY-MM-DD): ${value}`);
  return ymd;
}

function ymd(year: number, month: number, day: number): CivilDate {
  if (!(year >= 1 && year <= 9999)) throw new RangeError('Date out of range (years 1 to 9999)');
  return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`;
}

/** Days since 1970-01-01. */
function dayNumber({ year, month, day }: Ymd): number {
  const t = new Date(0);
  t.setUTCFullYear(year, month - 1, day);
  return Math.round(t.getTime() / DAY_MS);
}

function fromDayNumber(n: number): CivilDate {
  const t = new Date(n * DAY_MS);
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** @internal Minutes since 1970-01-01T00:00 on the wall clock. */
export function wallMinutes(dt: CivilDateTime): number {
  if (!isCivilDateTime(dt)) throw new RangeError(`Not a date and time (YYYY-MM-DDTHH:mm): ${dt}`);
  const minutes = Number(dt.slice(11, 13)) * 60 + Number(dt.slice(14, 16));
  return dayNumber(parseDate(dt.slice(0, 10))) * DAY_MINUTES + minutes;
}

/** @internal The inverse of `wallMinutes`. */
export function fromWallMinutes(total: number): CivilDateTime {
  const days = Math.floor(total / DAY_MINUTES);
  const minutes = total - days * DAY_MINUTES;
  return `${fromDayNumber(days)}T${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
}

export function isCivilDate(value: unknown): value is CivilDate {
  return readDate(value) !== null;
}

export function isCivilTime(value: unknown): value is CivilTime {
  return typeof value === 'string' && TIME_RE.test(value);
}

export function isCivilDateTime(value: unknown): value is CivilDateTime {
  return (
    typeof value === 'string' &&
    value[10] === 'T' &&
    isCivilDate(value.slice(0, 10)) &&
    isCivilTime(value.slice(11))
  );
}

/** '2026-10-26T15:30' → '2026-10-26'. */
export function datePart(dt: CivilDateTime): CivilDate {
  wallMinutes(dt);
  return dt.slice(0, 10);
}

/** '2026-10-26T15:30' → '15:30'. */
export function timePart(dt: CivilDateTime): CivilTime {
  wallMinutes(dt);
  return dt.slice(11);
}

/** ('2026-10-26', '15:30') → '2026-10-26T15:30'. */
export function combine(date: CivilDate, time: CivilTime): CivilDateTime {
  parseDate(date);
  if (!isCivilTime(time)) throw new RangeError(`Not a time (HH:mm): ${time}`);
  return `${date}T${time}`;
}

export function addDays(date: CivilDate, days: number): CivilDate {
  return fromDayNumber(dayNumber(parseDate(date)) + whole(days, 'days'));
}

/** Adds calendar months, clamping to the month's last day: Jan 31 + 1 month = Feb 28 (or 29). */
export function addMonths(date: CivilDate, months: number): CivilDate {
  const { year, month, day } = parseDate(date);
  const index = year * 12 + month - 1 + whole(months, 'months');
  const y = Math.floor(index / 12);
  const m = index - y * 12 + 1;
  return ymd(y, m, Math.min(day, daysInMonth(y, m)));
}

/** Adds minutes on the wall clock (no clock changes): '2026-03-08T01:30' + 60 = '…T02:30'. */
export function addMinutes(dt: CivilDateTime, minutes: number): CivilDateTime {
  return fromWallMinutes(wallMinutes(dt) + whole(minutes, 'minutes'));
}

/** 0 = Sunday to 6 = Saturday. */
export function dayOfWeek(date: CivilDate): Weekday {
  return ((((dayNumber(parseDate(date)) + 4) % 7) + 7) % 7) as Weekday;
}

/** Whole days from `a` to `b` (b minus a). */
export function daysBetween(a: CivilDate, b: CivilDate): number {
  return dayNumber(parseDate(b)) - dayNumber(parseDate(a));
}

/** Minutes from `a` to `b` (b minus a) on the wall clock. */
export function minutesBetween(a: CivilDateTime, b: CivilDateTime): number {
  return wallMinutes(b) - wallMinutes(a);
}

/** The first day of the week that holds `date`. */
export function startOfWeek(date: CivilDate, weekStartsOn: WeekStart): CivilDate {
  if (!Number.isInteger(weekStartsOn) || weekStartsOn < 0 || weekStartsOn > 6) {
    throw new RangeError(`weekStartsOn must be 0 to 6, got ${weekStartsOn}`);
  }
  return addDays(date, -((dayOfWeek(date) - weekStartsOn + 7) % 7));
}

/**
 * Week number for week labels, following the week start setting. Weeks starting on Monday use
 * ISO 8601 (week 1 holds the year's first Thursday); weeks starting on Sunday or Saturday count
 * the week that holds January 1 as week 1.
 */
export function weekNumber(date: CivilDate, weekStartsOn: WeekStart): number {
  // The day that decides which year the week belongs to: Thursday (ISO) or the week's last day.
  const anchor = addDays(startOfWeek(date, weekStartsOn), weekStartsOn === 1 ? 3 : 6);
  return Math.floor(daysBetween(`${anchor.slice(0, 4)}-01-01`, anchor) / 7) + 1;
}
