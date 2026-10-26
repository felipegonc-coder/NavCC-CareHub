/**
 * Calendar dates, time zones, relative ranges and date formatting.
 * Dates without a time never shift; times are exact moments shown in the viewer's time zone.
 * Uses only Intl, so it behaves the same in the browser and on the server.
 */
import type {
  CalendarDate,
  DateFormat,
  DateRef,
  DateValue,
  DateWindow,
  Instant,
  TimeFormat,
  Viewer,
  WeekDay,
} from './types';

export interface YMD {
  y: number;
  /** 1–12 */
  m: number;
  d: number;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?Z$/;

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function parseCalendarDate(s: string): YMD | null {
  const r = DATE_RE.exec(s);
  if (!r) return null;
  const y = Number(r[1]);
  const m = Number(r[2]);
  const d = Number(r[3]);
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return { y, m, d };
}

export function isCalendarDate(s: unknown): s is CalendarDate {
  return typeof s === 'string' && parseCalendarDate(s) !== null;
}

export function isInstant(s: unknown): s is Instant {
  return typeof s === 'string' && INSTANT_RE.test(s) && !Number.isNaN(Date.parse(s));
}

export function toCalendarDate(v: YMD): CalendarDate {
  return `${pad(v.y, 4)}-${pad(v.m)}-${pad(v.d)}`;
}

function mustParse(date: CalendarDate): YMD {
  const v = parseCalendarDate(date);
  if (!v) throw new RangeError(`Not a calendar date: ${date}`);
  return v;
}

/** Days since 1970-01-01. */
export function epochDays(date: CalendarDate): number {
  const v = mustParse(date);
  return Math.round(Date.UTC(v.y, v.m - 1, v.d) / 86_400_000);
}

export function fromEpochDays(n: number): CalendarDate {
  const d = new Date(n * 86_400_000);
  return toCalendarDate({ y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() });
}

export function addDays(date: CalendarDate, n: number): CalendarDate {
  return fromEpochDays(epochDays(date) + n);
}

/** b minus a, in days. */
export function daysBetween(a: CalendarDate, b: CalendarDate): number {
  return epochDays(b) - epochDays(a);
}

/** 0 = Sunday. */
export function dayOfWeek(date: CalendarDate): WeekDay {
  return ((((epochDays(date) + 4) % 7) + 7) % 7) as WeekDay;
}

export function startOfWeek(date: CalendarDate, weekStart: WeekDay): CalendarDate {
  return addDays(date, -((dayOfWeek(date) - weekStart + 7) % 7));
}

export function endOfWeek(date: CalendarDate, weekStart: WeekDay): CalendarDate {
  return addDays(startOfWeek(date, weekStart), 6);
}

/** Adds months, keeping the day where possible (Jan 31 + 1 month = Feb 28 or 29). */
export function addMonths(date: CalendarDate, n: number): CalendarDate {
  const v = mustParse(date);
  const total = v.y * 12 + (v.m - 1) + n;
  const y = Math.floor(total / 12);
  const m = (((total % 12) + 12) % 12) + 1;
  return toCalendarDate({ y, m, d: Math.min(v.d, daysInMonth(y, m)) });
}

export function addYears(date: CalendarDate, n: number): CalendarDate {
  return addMonths(date, 12 * n);
}

export function startOfMonth(date: CalendarDate): CalendarDate {
  const v = mustParse(date);
  return toCalendarDate({ y: v.y, m: v.m, d: 1 });
}

export function endOfMonth(date: CalendarDate): CalendarDate {
  const v = mustParse(date);
  return toCalendarDate({ y: v.y, m: v.m, d: daysInMonth(v.y, v.m) });
}

export function startOfQuarter(date: CalendarDate): CalendarDate {
  const v = mustParse(date);
  return toCalendarDate({ y: v.y, m: Math.floor((v.m - 1) / 3) * 3 + 1, d: 1 });
}

export function endOfQuarter(date: CalendarDate): CalendarDate {
  return addDays(addMonths(startOfQuarter(date), 3), -1);
}

export function startOfYear(date: CalendarDate): CalendarDate {
  return `${date.slice(0, 4)}-01-01`;
}

export function endOfYear(date: CalendarDate): CalendarDate {
  return `${date.slice(0, 4)}-12-31`;
}

export function compareCalendarDates(a: CalendarDate, b: CalendarDate): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ------------------------------------------------------------------ time zones

export const DEFAULT_TIME_ZONE = 'America/Denver';

const formatters = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      weekday: 'short',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    partsFormatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

export interface ZonedParts extends YMD {
  hour: number;
  minute: number;
  second: number;
  weekday: WeekDay;
}

const WEEKDAYS: Record<string, WeekDay> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function toMillis(instant: Date | Instant | number): number {
  return typeof instant === 'number'
    ? instant
    : typeof instant === 'string'
      ? Date.parse(instant)
      : instant.getTime();
}

/** The wall-clock date and time of an exact moment in a time zone. */
export function zonedParts(instant: Date | Instant | number, timeZone: string): ZonedParts {
  const out: Record<string, string> = {};
  for (const p of partsFormatter(timeZone).formatToParts(toMillis(instant))) out[p.type] = p.value;
  return {
    y: Number(out.year),
    m: Number(out.month),
    d: Number(out.day),
    hour: Number(out.hour) % 24,
    minute: Number(out.minute),
    second: Number(out.second),
    weekday: WEEKDAYS[out.weekday ?? 'Sun'] ?? 0,
  };
}

/** Minutes the time zone is ahead of UTC at that moment (Denver in winter: -420). */
export function timeZoneOffsetMinutes(instant: Date | Instant | number, timeZone: string): number {
  const ms = toMillis(instant);
  const p = zonedParts(ms, timeZone);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60_000);
}

/** The calendar day of an exact moment in a time zone. */
export function instantToCalendarDate(
  instant: Date | Instant | number,
  timeZone: string,
): CalendarDate {
  const p = zonedParts(instant, timeZone);
  return toCalendarDate(p);
}

/**
 * The exact moment of a wall-clock time in a time zone.
 * In a daylight-saving gap the time moves forward; in an overlap the earlier moment wins.
 */
export function zonedToInstant(
  date: CalendarDate,
  hour: number,
  minute: number,
  timeZone: string,
): Instant {
  const v = mustParse(date);
  const wall = Date.UTC(v.y, v.m - 1, v.d, hour, minute);
  const first = wall - timeZoneOffsetMinutes(wall, timeZone) * 60_000;
  const second = wall - timeZoneOffsetMinutes(first, timeZone) * 60_000;
  const candidates = [first, second].filter((t) => {
    const p = zonedParts(t, timeZone);
    return Date.UTC(p.y, p.m - 1, p.d, p.hour, p.minute) === wall;
  });
  const t = candidates.length ? Math.min(...candidates) : Math.max(first, second);
  return new Date(t).toISOString();
}

/** First moment of a calendar day in a time zone. */
export function startOfDayInstant(date: CalendarDate, timeZone: string): Instant {
  return zonedToInstant(date, 0, 0, timeZone);
}

export function todayIn(viewer: Pick<Viewer, 'now' | 'timeZone'>): CalendarDate {
  return instantToCalendarDate(viewer.now, viewer.timeZone);
}

// ------------------------------------------------------------------ date values

export function isValidDateValue(v: unknown): v is DateValue {
  if (typeof v !== 'object' || v === null) return false;
  const { start, end, hasTime } = v as Record<string, unknown>;
  if (typeof hasTime !== 'boolean') return false;
  const ok = hasTime ? isInstant : isCalendarDate;
  if (!ok(start)) return false;
  if (end === null) return true;
  if (!ok(end)) return false;
  return hasTime
    ? Date.parse(end as string) >= Date.parse(start as string)
    : (end as string) >= (start as string);
}

/** The calendar days a date value covers for this viewer (dates without a time never shift). */
export function dateValueDays(
  v: DateValue,
  timeZone: string,
): { start: CalendarDate; end: CalendarDate } {
  if (!v.hasTime) return { start: v.start, end: v.end ?? v.start };
  const start = instantToCalendarDate(v.start, timeZone);
  return { start, end: v.end ? instantToCalendarDate(v.end, timeZone) : start };
}

/** The calendar day used by every date condition except "is within" and "is between". */
export function dateValueStartDay(v: DateValue, timeZone: string): CalendarDate {
  return v.hasTime ? instantToCalendarDate(v.start, timeZone) : v.start;
}

// ------------------------------------------------------------------ relative dates

export function resolveDateRef(ref: DateRef, today: CalendarDate): CalendarDate {
  if ('exact' in ref) return ref.exact;
  switch (ref.relative) {
    case 'today':
      return today;
    case 'tomorrow':
      return addDays(today, 1);
    case 'yesterday':
      return addDays(today, -1);
    case 'one_week_ago':
      return addDays(today, -7);
    case 'one_week_from_now':
      return addDays(today, 7);
    case 'one_month_ago':
      return addMonths(today, -1);
    case 'one_month_from_now':
      return addMonths(today, 1);
  }
}

/**
 * An inclusive range of days. "Next 7 days" is today plus the 6 days after it;
 * "past 7 days" is the 6 days before today plus today. Weeks follow the viewer's week start.
 */
export function resolveDateWindow(
  w: DateWindow,
  today: CalendarDate,
  weekStart: WeekDay,
): { start: CalendarDate; end: CalendarDate } {
  if (typeof w === 'object') {
    const n = Math.max(1, Math.floor(w.count));
    const step = (d: CalendarDate, k: number): CalendarDate =>
      w.unit === 'day'
        ? addDays(d, k)
        : w.unit === 'week'
          ? addDays(d, 7 * k)
          : w.unit === 'month'
            ? addMonths(d, k)
            : addYears(d, k);
    return w.direction === 'past'
      ? { start: addDays(step(today, -n), 1), end: today }
      : { start: today, end: addDays(step(today, n), -1) };
  }
  const week = startOfWeek(today, weekStart);
  switch (w) {
    case 'this_week':
      return { start: week, end: addDays(week, 6) };
    case 'last_week':
      return { start: addDays(week, -7), end: addDays(week, -1) };
    case 'next_week':
      return { start: addDays(week, 7), end: addDays(week, 13) };
    case 'this_month':
      return { start: startOfMonth(today), end: endOfMonth(today) };
    case 'last_month': {
      const s = addMonths(startOfMonth(today), -1);
      return { start: s, end: endOfMonth(s) };
    }
    case 'next_month': {
      const s = addMonths(startOfMonth(today), 1);
      return { start: s, end: endOfMonth(s) };
    }
    case 'this_year':
      return { start: startOfYear(today), end: endOfYear(today) };
    case 'last_year': {
      const s = addYears(startOfYear(today), -1);
      return { start: s, end: endOfYear(s) };
    }
    case 'next_year': {
      const s = addYears(startOfYear(today), 1);
      return { start: s, end: endOfYear(s) };
    }
    case 'past_7_days':
      return { start: addDays(today, -6), end: today };
    case 'next_7_days':
      return { start: today, end: addDays(today, 6) };
    case 'past_30_days':
      return { start: addDays(today, -29), end: today };
    case 'next_30_days':
      return { start: today, end: addDays(today, 29) };
  }
}

// ------------------------------------------------------------------ formatting

export const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** "Oct 26, 2026", "10/26/2026", "26/10/2026", "2026-10-26", or Today / Tomorrow / Yesterday. */
export function formatCalendarDate(
  date: CalendarDate,
  format: DateFormat,
  today?: CalendarDate,
): string {
  const v = mustParse(date);
  switch (format) {
    case 'mdy':
      return `${pad(v.m)}/${pad(v.d)}/${pad(v.y, 4)}`;
    case 'dmy':
      return `${pad(v.d)}/${pad(v.m)}/${pad(v.y, 4)}`;
    case 'ymd':
      return date;
    case 'relative':
      if (today) {
        const diff = daysBetween(today, date);
        if (diff === 0) return 'Today';
        if (diff === 1) return 'Tomorrow';
        if (diff === -1) return 'Yesterday';
      }
      return formatCalendarDate(date, 'full');
    case 'full':
      return `${MONTH_SHORT[v.m - 1]} ${v.d}, ${pad(v.y, 4)}`;
  }
}

/** "3:30 PM" or "15:30". */
export function formatTime(hour: number, minute: number, hour12: boolean): string {
  if (!hour12) return `${pad(hour)}:${pad(minute)}`;
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:${pad(minute)} ${hour < 12 ? 'AM' : 'PM'}`;
}

export interface DateFormatOptions {
  format: DateFormat;
  timeFormat?: TimeFormat;
  viewer: Pick<Viewer, 'timeZone' | 'hour12' | 'now'>;
}

/** A date value as shown: "Oct 26, 2026", "Oct 26, 2026 3:30 PM → 4:00 PM", "Oct 26, 2026 → Oct 28, 2026". */
export function formatDateValue(v: DateValue, opts: DateFormatOptions): string {
  const { timeZone } = opts.viewer;
  const today = todayIn(opts.viewer);
  const tf = opts.timeFormat ?? 'viewer';
  const showTime = v.hasTime && tf !== 'hidden';
  const hour12 = tf === 'viewer' ? opts.viewer.hour12 : tf === '12h';
  const one = (s: string): { day: CalendarDate; time: string } => {
    if (!v.hasTime) return { day: s, time: '' };
    const p = zonedParts(s, timeZone);
    return { day: toCalendarDate(p), time: showTime ? formatTime(p.hour, p.minute, hour12) : '' };
  };
  const a = one(v.start);
  const first = `${formatCalendarDate(a.day, opts.format, today)}${a.time ? ` ${a.time}` : ''}`;
  if (!v.end) return first;
  const b = one(v.end);
  if (b.day === a.day) return b.time && b.time !== a.time ? `${first} → ${b.time}` : first;
  return `${first} → ${formatCalendarDate(b.day, opts.format, today)}${b.time ? ` ${b.time}` : ''}`;
}
