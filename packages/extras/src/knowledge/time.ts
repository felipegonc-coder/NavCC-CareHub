// Calendar days and time zones for verification dates. Dates are 'YYYY-MM-DD' with no time zone;
// an instant comes from a date, a wall-clock time and the owner's time zone.

export type CivilDate = string;

const CIVIL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;
const MONTHS =
  'January February March April May June July August September October November December'.split(
    ' ',
  );

function split(date: CivilDate): [number, number, number] {
  const match = CIVIL_DATE.exec(date);
  if (!match) throw new RangeError('Not a date.');
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function toUtc(date: CivilDate): number {
  const [year, month, day] = split(date);
  return Date.UTC(year, month - 1, day);
}

function fromUtc(ms: number): CivilDate {
  return new Date(ms).toISOString().slice(0, 10);
}

export function isCivilDate(value: string): boolean {
  if (!CIVIL_DATE.test(value)) return false;
  const [year, month, day] = split(value);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

export function addDays(date: CivilDate, days: number): CivilDate {
  return fromUtc(toUtc(date) + days * DAY_MS);
}

/** Adds calendar months, keeping the day where it can (Jan 31 + 1 month is Feb 28 or 29). */
export function addMonths(date: CivilDate, months: number): CivilDate {
  const [year, month, day] = split(date);
  const index = year * 12 + month - 1 + months;
  const toYear = Math.floor(index / 12);
  const toMonth = index - toYear * 12;
  const lastDay = new Date(Date.UTC(toYear, toMonth + 1, 0)).getUTCDate();
  return fromUtc(Date.UTC(toYear, toMonth, Math.min(day, lastDay)));
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: CivilDate, to: CivilDate): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
}

/** 0 is Sunday, 1 is Monday. */
export function dayOfWeek(date: CivilDate): number {
  return new Date(toUtc(date)).getUTCDay();
}

const clocks = new Map<string, Intl.DateTimeFormat>();

/** What the clock in `timeZone` reads at `instant`, written as if it were UTC. */
function wallClock(instant: number, timeZone: string): number {
  let clock = clocks.get(timeZone);
  if (!clock) {
    clock = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    clocks.set(timeZone, clock);
  }
  const part: Partial<Record<Intl.DateTimeFormatPartTypes, number>> = {};
  for (const { type, value } of clock.formatToParts(instant)) part[type] = Number(value);
  const { year = 1970, month = 1, day = 1, hour = 0, minute = 0, second = 0 } = part;
  return Date.UTC(year, month - 1, day, hour % 24, minute, second);
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function todayIn(timeZone: string, now: Date): CivilDate {
  return fromUtc(wallClock(now.getTime(), timeZone));
}

/** The instant when the clock in `timeZone` reads `time` ('HH:mm') on `date`. */
export function zonedInstant(date: CivilDate, time: string, timeZone: string): Date {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  const target = toUtc(date) + (hours * 60 + minutes) * 60_000;
  const first = target - (wallClock(target, timeZone) - target);
  return new Date(target - (wallClock(first, timeZone) - first));
}

/** "Oct 1" this year, "Jan 20, 2027" in any other year. */
export function formatDay(date: CivilDate, today: CivilDate): string {
  const [year, month, day] = split(date);
  const short = `${MONTHS[month - 1]?.slice(0, 3)} ${day}`;
  return year === split(today)[0] ? short : `${short}, ${year}`;
}

/** "January 20, 2027", for screen readers. */
export function formatDayLong(date: CivilDate): string {
  const [year, month, day] = split(date);
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}
