import {
  combine,
  datePart,
  daysBetween,
  formatDate,
  formatTime,
  isCivilDate,
  isCivilTime,
  timePart,
  toCivil,
  toInstant,
  todayIn,
  type TimePrefs,
} from '@carehub/team-time';
import type { Reminder } from './api';

/** The time settings the Reminders screens use. */
export type TimeSettings = Pick<TimePrefs, 'timeZone' | 'use24h'>;

/** Minutes in each unit of "time before the start", largest first. */
const UNIT_MINUTES = { days: 1440, hours: 60, minutes: 1 } as const;
export type BeforeUnit = keyof typeof UNIT_MINUTES;

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "Today at 3:30 PM" from "today at 3:30 PM". */
export const sentence = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * When `instant` is, in words: "today at 3:30 PM", "tomorrow at 9:00 AM", "yesterday at 5:00 PM",
 * "Wed, Oct 28 at 9:00 AM", with the year when it isn't this year's.
 */
export function formatWhen(instant: string | Date, prefs: TimeSettings, now = new Date()): string {
  const civil = toCivil(new Date(instant), prefs.timeZone);
  const date = datePart(civil);
  const today = todayIn(prefs.timeZone, now);
  const time = formatTime(civil, prefs);
  const days = daysBetween(today, date);
  if (days === 0) return `today at ${time}`;
  if (days === 1) return `tomorrow at ${time}`;
  if (days === -1) return `yesterday at ${time}`;
  const year = date.slice(0, 4) !== today.slice(0, 4);
  return `${formatDate(date, { weekday: 'short', year })} at ${time}`;
}

/** 90 minutes is 90 minutes, 120 is 2 hours, 2880 is 2 days: the largest unit that fits evenly. */
export function splitBefore(minutes: number): { amount: number; unit: BeforeUnit } {
  for (const unit of ['days', 'hours'] as const) {
    if (minutes > 0 && minutes % UNIT_MINUTES[unit] === 0) {
      return { amount: minutes / UNIT_MINUTES[unit], unit };
    }
  }
  return { amount: minutes, unit: 'minutes' };
}

/**
 * An event reminder's time, in words: "At the start", "10 minutes before", "1 day before", or
 * (negative minutes, all-day events) "On the day at 9:00 AM".
 */
export function beforeLabel(minutesBefore: number, prefs: TimeSettings): string {
  if (minutesBefore === 0) return 'At the start';
  if (minutesBefore < 0) return `On the day at ${formatTime(onTheDayTime(minutesBefore), prefs)}`;
  const { amount, unit } = splitBefore(minutesBefore);
  return `${plural(amount, unit.slice(0, -1))} before`;
}

/** All-day events: -540 minutes before the start is "09:00" on the day. */
export function onTheDayTime(minutesBefore: number): string {
  const minute = Math.max(-minutesBefore, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;
}

/** The date and time inputs' values for `instant` in `timeZone`. */
export function toInputs(instant: string | Date, timeZone: string): { date: string; time: string } {
  const civil = toCivil(new Date(instant), timeZone);
  return { date: datePart(civil), time: timePart(civil) };
}

/** The instant (ISO, ending in Z) that the inputs name in `timeZone`; null when one is empty. */
export function fromInputs(date: string, time: string, timeZone: string): string | null {
  if (!isCivilDate(date) || !isCivilTime(time)) return null;
  return toInstant(combine(date, time), timeZone).toISOString();
}

/** The title to show; null means the person can't open the page or event any more. */
export function reminderTitle(reminder: Pick<Reminder, 'title' | 'target'>): string {
  if (reminder.title !== null) return reminder.title;
  return reminder.target.type === 'page' ? "A page you can't open" : "An event you can't open";
}
