import {
  datePart,
  dayOfWeek,
  daysBetween,
  DEFAULT_TIME_PREFS,
  formatDate,
  formatDayDivider,
  formatTime,
  todayIn,
  toCivil,
  weekdayName,
  type TimePrefs,
} from '@carehub/team-time';

export type TimeSettings = Pick<TimePrefs, 'timeZone' | 'use24h'>;

/** Times use the default settings until the person's own reach the web app (as notices do). */
export const TIME_SETTINGS: TimeSettings = DEFAULT_TIME_PREFS;

const civil = (iso: string, prefs: TimeSettings) => toCivil(new Date(iso), prefs.timeZone);

/** The day an instant falls on in the person's zone: '2026-10-27'. */
export function dayOf(iso: string, prefs: TimeSettings = TIME_SETTINGS): string {
  return datePart(civil(iso, prefs));
}

/** Day dividers: 'Today', 'Yesterday', 'Mon, Oct 26', or 'Fri, Dec 26, 2025' in another year. */
export function dayDivider(iso: string, now: Date, prefs: TimeSettings = TIME_SETTINGS): string {
  return formatDayDivider(dayOf(iso, prefs), todayIn(prefs.timeZone, now));
}

/** A message's time: '3:30 PM', or '15:30' with the 24-hour setting. */
export function messageTime(iso: string, prefs: TimeSettings = TIME_SETTINGS): string {
  return formatTime(civil(iso, prefs), prefs);
}

/** The full date and time, for tooltips: 'Mon, Oct 26, 2026, 3:30 PM'. */
export function fullTime(iso: string, prefs: TimeSettings = TIME_SETTINGS): string {
  const at = civil(iso, prefs);
  return `${formatDate(datePart(at), { weekday: 'short' })}, ${formatTime(at, prefs)}`;
}

/** The chat list's time: '3:30 PM' today, 'Yesterday', 'Mon' this week, then 'Oct 26'. */
export function listTime(iso: string, now: Date, prefs: TimeSettings = TIME_SETTINGS): string {
  const at = civil(iso, prefs);
  const date = datePart(at);
  const today = todayIn(prefs.timeZone, now);
  const days = daysBetween(date, today);
  if (days <= 0) return formatTime(at, prefs);
  if (days === 1) return 'Yesterday';
  if (days < 7) return weekdayName(dayOfWeek(date), 'short');
  return formatDate(date, { year: date.slice(0, 4) !== today.slice(0, 4) });
}
