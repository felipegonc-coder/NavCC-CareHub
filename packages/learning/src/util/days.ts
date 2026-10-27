/** A calendar day, "YYYY-MM-DD" (see `IsoDate` in the course format). */
type Day = string;

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  return month === 2 ? (isLeapYear(year) ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function parts(value: unknown): { year: number; month: number; day: number } | null {
  if (typeof value !== 'string') return null;
  const match = DAY_PATTERN.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

function partsOrThrow(value: Day): { year: number; month: number; day: number } {
  const p = parts(value);
  if (!p) throw new RangeError(`Not a calendar day (YYYY-MM-DD): ${JSON.stringify(value)}`);
  return p;
}

// Day numbers count days from 1970-01-01 (proleptic Gregorian calendar), using plain integer arithmetic
// so results never depend on the computer's time zone.
function toDayNumber(value: Day): number {
  const { year, month, day } = partsOrThrow(value);
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

function fromDayNumber(dayNumber: number): Day {
  const z = dayNumber + 719468;
  const era = Math.floor(z / 146097);
  const dayOfEra = z - era * 146097;
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36524) -
      Math.floor(dayOfEra / 146096)) /
      365,
  );
  const dayOfYear =
    dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const mp = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  const year = yearOfEra + era * 400 + (month <= 2 ? 1 : 0);
  return format(year, month, day);
}

function format(year: number, month: number, day: number): Day {
  if (year < 0 || year > 9999) throw new RangeError(`Year out of range (0000-9999): ${year}`);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function wholeNumber(n: number, name: string): number {
  if (!Number.isInteger(n)) throw new RangeError(`${name} must be a whole number: ${n}`);
  return n;
}

/** True when `value` is a real calendar day written as "YYYY-MM-DD" (checks month lengths and leap years). */
export function isIsoDate(value: unknown): value is Day {
  return parts(value) !== null;
}

/** `date` moved by `days` (may be negative). Throws a RangeError on a malformed date. */
export function addDays(date: Day, days: number): Day {
  return fromDayNumber(toDayNumber(date) + wholeNumber(days, 'days'));
}

/**
 * `date` moved by `months` (may be negative). Clamps to the end of shorter months:
 * addMonths("2026-01-31", 1) is "2026-02-28". Throws a RangeError on a malformed date.
 */
export function addMonths(date: Day, months: number): Day {
  const { year, month, day } = partsOrThrow(date);
  const index = year * 12 + (month - 1) + wholeNumber(months, 'months');
  const newYear = Math.floor(index / 12);
  const newMonth = index - newYear * 12 + 1;
  return format(newYear, newMonth, Math.min(day, daysInMonth(newYear, newMonth)));
}

/** Whole days from `from` to `to`: positive when `to` is later. daysBetween("2026-10-30", "2026-11-02") is 3. */
export function daysBetween(from: Day, to: Day): number {
  return toDayNumber(to) - toDayNumber(from);
}

/** Sort comparator for calendar days: negative when `a` is earlier, 0 when equal, positive when later. */
export function compareDays(a: Day, b: Day): number {
  return Math.sign(daysBetween(b, a));
}

/**
 * The calendar day of an instant in an IANA time zone, e.g. isoDateInTimeZone("2026-10-27T03:00:00Z",
 * "America/Denver") is "2026-10-26". Throws a RangeError for an invalid instant or time zone.
 */
export function isoDateInTimeZone(instant: string, timeZone: string): Day {
  const ms = Date.parse(instant);
  if (Number.isNaN(ms)) throw new RangeError(`Not a date and time: ${JSON.stringify(instant)}`);
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(ms);
  const get = (type: string) => Number(formatted.find((p) => p.type === type)?.value);
  return format(get('year'), get('month'), get('day'));
}

/**
 * Learning's calendar day (decision 0317): due dates, "overdue", "due soon" and "expiring soon" go
 * by today in this zone, the same day for everyone, whatever their profile's time zone.
 */
export const LEARNING_DAY_ZONE = 'America/Denver';

/**
 * Today in LEARNING_DAY_ZONE. Just after midnight UTC it is still the day before there:
 * learningToday(new Date("2026-10-28T00:30:00Z")) is "2026-10-27".
 */
export function learningToday(now: Date = new Date()): Day {
  return isoDateInTimeZone(now.toISOString(), LEARNING_DAY_ZONE);
}

/**
 * The time zone to show a person's times in (decision 0317): their profile's `timeZone` when Intl
 * accepts it, else LEARNING_DAY_ZONE (empty, missing or unknown).
 */
export function profileZone(timeZone: string | null | undefined): string {
  if (!timeZone) return LEARNING_DAY_ZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return timeZone;
  } catch {
    return LEARNING_DAY_ZONE;
  }
}
