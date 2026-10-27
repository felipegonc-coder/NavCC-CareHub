/**
 * Dates and times in the specs' English wording. A person's settings are always passed in. Output
 * uses normal spaces only (never the U+202F that `Intl` puts before AM and PM), so it reads the
 * same in every browser and on the server.
 */
import type { CivilDate, CivilDateTime, CivilTime, Weekday } from './civil';
import {
  addDays,
  combine,
  datePart,
  dayOfWeek,
  daysBetween,
  isCivilDate,
  isCivilDateTime,
  isCivilTime,
  pad2,
  startOfWeek,
  timePart,
} from './civil';
import type { TimePrefs } from './prefs';
import { toCivil, toInstant, todayIn } from './zones';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;
const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;
/** An en dash between normal spaces, as in "Oct 25 – 31, 2026". */
const DASH = ' \u2013 ';

/** Which parts `formatDate` shows. */
export type DateStyle = { weekday?: 'short' | 'long'; month?: 'short' | 'long'; year?: boolean };
/** The Calendar's views. */
export type CalendarView = 'day' | 'week' | 'month';
/** Home's greeting: morning is 5:00–11:59, afternoon 12:00–16:59, evening the rest. */
export type TimeOfDay = 'morning' | 'afternoon' | 'evening';

function split(date: CivilDate): { year: number; month: number; day: number } {
  if (!isCivilDate(date)) throw new RangeError(`Not a date (YYYY-MM-DD): ${date}`);
  return {
    year: Number(date.slice(0, 4)),
    month: Number(date.slice(5, 7)),
    day: Number(date.slice(8)),
  };
}

function clock(time: CivilTime | CivilDateTime): CivilTime {
  if (isCivilDateTime(time)) return timePart(time);
  if (!isCivilTime(time)) throw new RangeError(`Not a time (HH:mm): ${time}`);
  return time;
}

/** '1 hour', '2 hours'. */
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** 'Monday', or 'Mon' with style 'short'. */
export function weekdayName(day: Weekday, style: 'long' | 'short' = 'long'): string {
  const name = WEEKDAYS[day];
  if (!name) throw new RangeError(`Not a weekday (0 to 6): ${day}`);
  return style === 'short' ? name.slice(0, 3) : name;
}

/** 'Oct 26, 2026' by default; `{ weekday: 'long', year: false }` gives 'Monday, Oct 26'. */
export function formatDate(date: CivilDate, style: DateStyle = {}): string {
  const { year, month, day } = split(date);
  const name = MONTHS[month - 1]!;
  const weekday = style.weekday ? `${weekdayName(dayOfWeek(date), style.weekday)}, ` : '';
  const monthDay = `${style.month === 'long' ? name : name.slice(0, 3)} ${day}`;
  return `${weekday}${monthDay}${style.year === false ? '' : `, ${year}`}`;
}

/** '3:30 PM', or '15:30' with the 24-hour setting. Takes 'HH:mm' or a date-time. */
export function formatTime(
  time: CivilTime | CivilDateTime,
  prefs: Pick<TimePrefs, 'use24h'>,
): string {
  const hhmm = clock(time);
  if (prefs.use24h) return hhmm;
  const hour = Number(hhmm.slice(0, 2));
  return `${hour % 12 || 12}:${hhmm.slice(3)} ${hour < 12 ? 'AM' : 'PM'}`;
}

/** '10:00 to 11:00 AM', '11:30 AM to 12:30 PM', or '10:00 to 11:00' with the 24-hour setting. */
export function formatTimeRange(
  start: CivilTime | CivilDateTime,
  end: CivilTime | CivilDateTime,
  prefs: Pick<TimePrefs, 'use24h'>,
): string {
  const from = formatTime(start, prefs);
  const to = formatTime(end, prefs);
  const samePeriod = !prefs.use24h && from.slice(-2) === to.slice(-2);
  return `${samePeriod ? from.slice(0, -3) : from} to ${to}`;
}

/** Hour lines in a calendar grid: '9 AM', '2:30 PM', or '09:00' with the 24-hour setting. */
export function formatHourLabel(
  time: CivilTime | CivilDateTime,
  prefs: Pick<TimePrefs, 'use24h'>,
): string {
  const label = formatTime(time, prefs);
  return prefs.use24h ? label : label.replace(':00 ', ' ');
}

/** 'Oct 25 – 31, 2026', 'Oct 26 – Nov 1, 2026' or 'Dec 27, 2026 – Jan 2, 2027'. */
export function formatDateRange(start: CivilDate, end: CivilDate): string {
  const a = split(start);
  const b = split(end);
  if (start === end) return formatDate(start);
  if (a.year !== b.year) return `${formatDate(start)}${DASH}${formatDate(end)}`;
  const last = a.month === b.month ? String(b.day) : formatDate(end, { year: false });
  return `${formatDate(start, { year: false })}${DASH}${last}, ${b.year}`;
}

/** The Calendar's period: 'Monday, Oct 26, 2026', 'Oct 25 – 31, 2026' or 'October 2026'. */
export function formatPeriod(
  view: CalendarView,
  date: CivilDate,
  prefs: Pick<TimePrefs, 'weekStart'>,
): string {
  if (view === 'month') return `${MONTHS[split(date).month - 1]!} ${split(date).year}`;
  if (view === 'day') return formatDate(date, { weekday: 'long' });
  const start = startOfWeek(date, prefs.weekStart);
  return formatDateRange(start, addDays(start, 6));
}

/** Chat day dividers: 'Today', 'Yesterday', 'Mon, Oct 26', or 'Fri, Dec 26, 2025' in another year. */
export function formatDayDivider(date: CivilDate, today: CivilDate): string {
  const days = daysBetween(date, today);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return formatDate(date, { weekday: 'short', year: date.slice(0, 4) !== today.slice(0, 4) });
}

/**
 * How long ago (or how soon), lower case for use in a sentence ("Opened 2 hours ago"): 'just now',
 * '5 min ago', '2 hours ago', 'yesterday', '3 days ago', then the date ('Oct 18', or
 * 'Sep 21, 2025' in another year). Ahead: 'now', 'in 5 min', 'in 2 hours', 'tomorrow', 'in 3 days'.
 * Days are calendar days in the person's time zone.
 */
export function formatRelative(
  instant: Date,
  now: Date,
  prefs: Pick<TimePrefs, 'timeZone'>,
): string {
  const ms = now.getTime() - instant.getTime();
  const past = ms >= 0;
  const minutes = Math.floor(Math.abs(ms) / 60_000);
  const span = (text: string) => (past ? `${text} ago` : `in ${text}`);
  if (minutes < 1) return past ? 'just now' : 'now';
  if (minutes < 60) return span(`${minutes} min`);
  const date = datePart(toCivil(instant, prefs.timeZone));
  const today = todayIn(prefs.timeZone, now);
  const days = Math.abs(daysBetween(date, today));
  if (minutes < 1440 || days === 0) return span(plural(Math.floor(minutes / 60), 'hour'));
  if (days === 1) return past ? 'yesterday' : 'tomorrow';
  if (days < 7) return span(`${days} days`);
  return formatDate(date, { year: date.slice(0, 4) !== today.slice(0, 4) });
}

export function timeOfDay(time: CivilTime | CivilDateTime): TimeOfDay {
  const hour = Number(clock(time).slice(0, 2));
  if (hour >= 5 && hour < 12) return 'morning';
  return hour >= 12 && hour < 17 ? 'afternoon' : 'evening';
}

/** Home's greeting: 'Good afternoon, Avery · Monday, October 26' (the first word of `name`). */
export function formatGreeting(
  name: string,
  now: Date,
  prefs: Pick<TimePrefs, 'timeZone'>,
): string {
  const local = toCivil(now, prefs.timeZone);
  const first = name.trim().split(/\s+/)[0] ?? '';
  const date = formatDate(datePart(local), { weekday: 'long', month: 'long', year: false });
  return `Good ${timeOfDay(local)}${first ? `, ${first}` : ''} \u00b7 ${date}`;
}

/**
 * Calendar's second time zone: for each hour line 00:00 to 23:00 of `date` in the person's zone,
 * the time in `secondZone` at that moment ('6 AM', '11:30 AM'). Works out each day on its own, so
 * a week where only one of the zones changes its clocks shows the right hours on every day.
 */
export function secondZoneHourLabels(
  date: CivilDate,
  secondZone: string,
  prefs: Pick<TimePrefs, 'timeZone' | 'use24h'>,
): string[] {
  return Array.from({ length: 24 }, (_, hour) => {
    const instant = toInstant(combine(date, `${pad2(hour)}:00`), prefs.timeZone);
    return formatHourLabel(toCivil(instant, secondZone), prefs);
  });
}

/** A default short label for a time zone: 'Europe/Lisbon' → 'Lisbon', 'America/New_York' → 'New York'. */
export function defaultZoneLabel(timeZone: string): string {
  return (timeZone.split('/').pop() ?? timeZone).replace(/_/g, ' ');
}
