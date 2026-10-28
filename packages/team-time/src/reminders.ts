// Remind me's preset times (Home and reminders spec, section 2), on the person's wall clock.
import {
  addDays,
  combine,
  datePart,
  dayOfWeek,
  isCivilTime,
  pad2,
  timePart,
  type CivilTime,
} from './civil';
import { toCivil, toInstant } from './zones';

const HOUR_MS = 3_600_000;
const DAY_MINUTES = 1440;

/** The presets for a page or row, in the picker's order. */
export type PageReminderPreset = 'in-1-hour' | 'later-today' | 'tomorrow' | 'next-monday';

/**
 * When each page or row preset is due from `now` in `timeZone`: in 1 hour, later today at 5:00 PM
 * (left out after 4:00 PM), tomorrow at 9:00 AM, and next Monday at 9:00 AM (a week on, when it's
 * Monday today).
 */
export function pageReminderTimes(
  now: Date,
  timeZone: string,
): { preset: PageReminderPreset; at: Date }[] {
  const civil = toCivil(now, timeZone);
  const today = datePart(civil);
  const at = (date: string, time: CivilTime) => toInstant(combine(date, time), timeZone);
  const toMonday = 7 - ((dayOfWeek(today) + 6) % 7);
  return [
    { preset: 'in-1-hour', at: new Date(now.getTime() + HOUR_MS) },
    ...(timePart(civil) <= '16:00'
      ? [{ preset: 'later-today' as const, at: at(today, '17:00') }]
      : []),
    { preset: 'tomorrow', at: at(addDays(today, 1), '09:00') },
    { preset: 'next-monday', at: at(addDays(today, toMonday), '09:00') },
  ];
}

/** Timed events, in minutes before the start: at the start, 5, 10 or 30 minutes, 1 hour, 1 day. */
export const EVENT_REMINDER_PRESETS: readonly number[] = [0, 5, 10, 30, 60, 1440];

/**
 * All-day events count back from 00:00 on the day: 9:00 AM on the day is -540 minutes before, and
 * 9:00 AM the day before is 900.
 */
export const ALL_DAY_REMINDER_PRESETS: readonly number[] = [-540, 900];

/** All-day events: `days` before the day (0 is the day itself) at `time`, in minutes before. */
export function allDayMinutesBefore(days: number, time: CivilTime): number {
  if (!Number.isSafeInteger(days)) throw new RangeError(`days must be a whole number, got ${days}`);
  if (!isCivilTime(time)) throw new RangeError(`Not a time (HH:mm): ${time}`);
  return days * DAY_MINUTES - (Number(time.slice(0, 2)) * 60 + Number(time.slice(3)));
}

/** The other way round: 900 is 1 day before at 09:00, and -540 is the day itself at 09:00. */
export function allDayReminderTime(minutesBefore: number): { days: number; time: CivilTime } {
  const days = Math.ceil(minutesBefore / DAY_MINUTES) || 0;
  const minute = days * DAY_MINUTES - minutesBefore;
  return { days, time: `${pad2(Math.floor(minute / 60))}:${pad2(minute % 60)}` };
}
