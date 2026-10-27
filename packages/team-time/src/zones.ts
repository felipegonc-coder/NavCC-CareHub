/**
 * Time zones with `Intl` only. A time zone is an IANA name such as 'America/Denver'; instants are
 * `Date` objects. Nothing here reads the machine's own zone.
 */
import type { CivilDate, CivilDateTime } from './civil';
import { datePart, pad2, wallMinutes } from './civil';

const MINUTE_MS = 60_000;
const DAY_MINUTES = 1440;
// IANA names (America/New_York, Etc/GMT+5, UTC). Offsets such as '+01:00' aren't zone names.
const ZONE_NAME = /^[A-Za-z][\w+/-]*$/;
const EARLIEST = Date.parse('0001-01-02T00:00:00Z');
const LATEST = Date.parse('9999-12-30T00:00:00Z');
// One formatter per valid zone (a few hundred at most); invalid names are never stored.
const formatters = new Map<string, Intl.DateTimeFormat>();

/** True for a time zone name that `Intl` knows, such as 'Asia/Kolkata' or 'UTC'. */
export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 64 || !ZONE_NAME.test(value)) return false;
  if (formatters.has(value)) return true;
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: value,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    });
    formatters.set(value, formatter);
    return true;
  } catch {
    return false;
  }
}

/** The wall clock in `timeZone` at a whole minute since 1970-01-01T00:00Z. */
function civilAt(minute: number, timeZone: string): CivilDateTime {
  const formatter = isValidTimeZone(timeZone) ? formatters.get(timeZone) : undefined;
  if (!formatter) throw new RangeError(`Not a time zone: ${timeZone}`);
  const parts: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const { type, value } of formatter.formatToParts(minute * MINUTE_MS)) parts[type] = value;
  const num = (type: Intl.DateTimeFormatPartTypes) => Number(parts[type]);
  const year = String(num('year')).padStart(4, '0');
  return `${year}-${pad2(num('month'))}-${pad2(num('day'))}T${pad2(num('hour') % 24)}:${pad2(num('minute'))}`;
}

/** Offset from UTC in minutes at a whole minute since the epoch (local minus UTC). */
function offsetAt(minute: number, timeZone: string): number {
  return wallMinutes(civilAt(minute, timeZone)) - minute;
}

function epochMinute(instant: Date): number {
  const ms = instant.getTime();
  if (!(ms >= EARLIEST && ms <= LATEST)) throw new RangeError('Invalid or out-of-range Date');
  return Math.floor(ms / MINUTE_MS);
}

/** The wall-clock date and time in `timeZone` at `instant` (seconds are dropped). */
export function toCivil(instant: Date, timeZone: string): CivilDateTime {
  return civilAt(epochMinute(instant), timeZone);
}

/** Offset from UTC in minutes at `instant`: -360 for Denver in summer, 330 for Kolkata. */
export function timeZoneOffset(instant: Date, timeZone: string): number {
  return offsetAt(epochMinute(instant), timeZone);
}

/**
 * The instant when the wall clock in `timeZone` shows `dt`. A time inside a gap (clocks going
 * forward) moves forward to the first valid time, the moment the clocks changed; a time that
 * happens twice (clocks going back) takes the earlier one.
 */
export function toInstant(dt: CivilDateTime, timeZone: string): Date {
  const wall = wallMinutes(dt);
  // Clock changes are days apart, so the offsets a day either side give both possible readings.
  const withBefore = wall - offsetAt(wall - DAY_MINUTES, timeZone);
  const withAfter = wall - offsetAt(wall + DAY_MINUTES, timeZone);
  const valid = [withBefore, withAfter].filter((m) => wallMinutes(civilAt(m, timeZone)) === wall);
  if (valid.length > 0) return new Date(Math.min(...valid) * MINUTE_MS);
  // In a gap: find the first minute with the new offset.
  let lo = Math.min(withBefore, withAfter);
  let hi = Math.max(withBefore, withAfter);
  const oldOffset = offsetAt(lo, timeZone);
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (offsetAt(mid, timeZone) === oldOffset) lo = mid;
    else hi = mid;
  }
  return new Date(hi * MINUTE_MS);
}

/** Today's date in `timeZone`. */
export function todayIn(timeZone: string, now: Date = new Date()): CivilDate {
  return datePart(toCivil(now, timeZone));
}
