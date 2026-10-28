// Time helpers for Home: what's still on, which day it's under, and the clock that drives them.
import { datePart, formatTime, toCivil, todayIn, type TimePrefs } from '@carehub/team-time';
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
