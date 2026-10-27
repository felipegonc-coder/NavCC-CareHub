// Time zone arithmetic for the Status page, with Intl only (no time zone libraries).
// Instants are epoch milliseconds, civil dates 'YYYY-MM-DD' and wall-clock times 'HH:mm'.

export const MINUTE_MS = 60_000;
export const DAY_MINUTES = 24 * 60;
const DAY_MS = DAY_MINUTES * MINUTE_MS;
const CIVIL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const WALL_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
// Viewers pick their own zone, so the cache is capped rather than keyed by every name ever sent.
const MAX_CACHED_ZONES = 64;

const formats = new Map<string, Intl.DateTimeFormat>();

function formatFor(timeZone: string): Intl.DateTimeFormat {
  let format = formats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    if (formats.size >= MAX_CACHED_ZONES) formats.clear();
    formats.set(timeZone, format);
  }
  return format;
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallClock(ms: number, timeZone: string): WallClock {
  const parts = formatFor(timeZone).formatToParts(ms);
  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  };
}

function formatDate(year: number, month: number, day: number): string {
  const pad = (n: number, width: number) => String(n).padStart(width, '0');
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

function parseDate(date: string): { year: number; month: number; day: number } {
  const match = CIVIL_DATE.exec(date);
  if (!match) throw new RangeError(`Not a date: ${date}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/** The minute an instant falls in, counted from the Unix epoch. */
export function epochMinute(ms: number): number {
  return Math.floor(ms / MINUTE_MS);
}

/** Whether Intl knows `timeZone` (an IANA name such as America/Denver). */
export function isTimeZone(timeZone: string): boolean {
  if (timeZone === '') return false;
  try {
    formatFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** How far the wall clock in `timeZone` is ahead of UTC, in minutes (-360 in Denver in summer). */
export function zoneOffsetMinutes(ms: number, timeZone: string): number {
  const whole = Math.floor(ms / 1000) * 1000;
  const wall = wallClock(whole, timeZone);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return Math.round((asUtc - whole) / MINUTE_MS);
}

/** The civil date of an instant in `timeZone`. */
export function civilDate(ms: number, timeZone: string): string {
  const wall = wallClock(ms, timeZone);
  return formatDate(wall.year, wall.month, wall.day);
}

/** The civil date `days` days after `date` (before, if negative). */
export function addDays(date: string, days: number): string {
  const { year, month, day } = parseDate(date);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return formatDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

/**
 * The instant a wall-clock time happens on a civil date in `timeZone`. A time that happens twice
 * (clocks going back) gives the first. A skipped time (clocks going forward) is read with the
 * offset from before the change, so the start of the skipped hour is the moment of the change
 * itself (02:00 on the day Denver moves to summer time is 03:00 summer time).
 */
export function zonedInstant(date: string, time: string, timeZone: string): number {
  const { year, month, day } = parseDate(date);
  const match = WALL_TIME.exec(time);
  if (!match) throw new RangeError(`Not a time: ${time}`);
  const local = Date.UTC(year, month - 1, day, Number(match[1]), Number(match[2]));
  // Clocks change at most once a day, so these are the offsets on either side of any change.
  const before = local - zoneOffsetMinutes(local - DAY_MS, timeZone) * MINUTE_MS;
  const after = local - zoneOffsetMinutes(local + DAY_MS, timeZone) * MINUTE_MS;
  const exact = [before, after].filter(
    (ms) => ms + zoneOffsetMinutes(ms, timeZone) * MINUTE_MS === local,
  );
  return exact.length > 0 ? Math.min(...exact) : before;
}

/** The first instant of a civil date in `timeZone` (usually midnight). */
export function startOfDay(date: string, timeZone: string): number {
  return zonedInstant(date, '00:00', timeZone);
}
