// Time helpers for Home: what's still on, which day it's under, how times read, and the clock
// that drives them.
import {
  datePart,
  dayOfWeek,
  daysBetween,
  formatDate,
  formatTime,
  toCivil,
  todayIn,
  weekdayName,
  type TimePrefs,
} from '@carehub/team-time';
import { useEffect, useState } from 'react';

/** Something with a start and an end: instants when timed, dates (end exclusive) when all-day. */
export interface Span {
  allDay: boolean;
  start: string;
  end: string;
}

/** Timed: until it ends. All-day: until its last day is over in the person's time zone. */
export function isStillOn(span: Span, now: Date, timeZone: string): boolean {
  if (span.allDay) return span.end > todayIn(timeZone, now);
  return Date.parse(span.end) > now.getTime();
}

/** Upcoming's two groups: what started already or starts today is under Today. */
export function upcomingDay(span: Span, now: Date, timeZone: string): 'Today' | 'Tomorrow' {
  const day = span.allDay ? span.start : datePart(toCivil(new Date(span.start), timeZone));
  return day <= todayIn(timeZone, now) ? 'Today' : 'Tomorrow';
}

/** Upcoming's time: 'All day', 'Now' once it has started, else the start ('2:30 PM', '14:30'). */
export function upcomingTime(
  span: Span,
  now: Date,
  prefs: Pick<TimePrefs, 'timeZone' | 'use24h'>,
): string {
  if (span.allDay) return 'All day';
  const start = new Date(span.start);
  if (start.getTime() <= now.getTime()) return 'Now';
  return formatTime(toCivil(start, prefs.timeZone), prefs);
}

type ClockPrefs = Pick<TimePrefs, 'timeZone' | 'use24h'>;

/** Days from today that read as words. */
const NEAR_DAYS = new Map([
  [-1, 'Yesterday'],
  [0, 'Today'],
  [1, 'Tomorrow'],
]);

/**
 * When a reminder is due: 'Today, 3:00 PM', 'Tomorrow, 9:00 AM', 'Yesterday, 9:00 AM' (a late
 * one), else 'Mon, Nov 2, 9:00 AM', with the year when it isn't this year.
 */
export function reminderDue(dueAt: string, now: Date, prefs: ClockPrefs): string {
  const due = toCivil(new Date(dueAt), prefs.timeZone);
  const date = datePart(due);
  const today = todayIn(prefs.timeZone, now);
  const day =
    NEAR_DAYS.get(daysBetween(today, date)) ??
    formatDate(date, { weekday: 'short', year: date.slice(0, 4) !== today.slice(0, 4) });
  return `${day}, ${formatTime(due, prefs)}`;
}

/**
 * A chat's latest message in a list: the time today ('2:30 PM'), then 'Yesterday', the weekday
 * within a week ('Mon'), else the date ('Oct 18', or 'Sep 21, 2025' in another year).
 */
export function chatTime(at: string, now: Date, prefs: ClockPrefs): string {
  const sent = toCivil(new Date(at), prefs.timeZone);
  const date = datePart(sent);
  const today = todayIn(prefs.timeZone, now);
  const days = daysBetween(date, today);
  if (days <= 0) return formatTime(sent, prefs);
  if (days === 1) return 'Yesterday';
  if (days < 7) return weekdayName(dayOfWeek(date), 'short');
  return formatDate(date, { year: date.slice(0, 4) !== today.slice(0, 4) });
}

const MINUTE = 60_000;

/**
 * The time now, for greetings, Join buttons and "2 min ago": updated at the start of every
 * minute, and straight away when the tab comes back to the front.
 */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      clearTimeout(timer);
      const current = new Date();
      setNow(current);
      timer = setTimeout(tick, MINUTE - (current.getTime() % MINUTE));
    };
    timer = setTimeout(tick, MINUTE - (Date.now() % MINUTE));
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  return now;
}
