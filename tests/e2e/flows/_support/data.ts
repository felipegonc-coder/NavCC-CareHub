import { randomUUID } from 'node:crypto';

/**
 * A fictional name that is unique for this run, such as "Fictional QA page 3f9c1a", so tests that
 * run in parallel or are retried never see each other's data. The database is shared by every test
 * of a run and is never emptied in between.
 */
export function uniqueName(label: string): string {
  return `${label} ${randomUUID().slice(0, 6)}`;
}

/** The time zone people have by default; the app shows dates and times in it. */
export const DEFAULT_TIME_ZONE = 'America/Denver';

/** A date the way the app shows it, for example "Oct 26, 2026". */
export function shownDate(date: Date, timeZone = DEFAULT_TIME_ZONE): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone,
  }).format(date);
}

/** A time the way the app shows it with the 12-hour default, for example "3:30 PM". */
export function shownTime(date: Date, timeZone = DEFAULT_TIME_ZONE): string {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone }).format(
    date,
  );
}
