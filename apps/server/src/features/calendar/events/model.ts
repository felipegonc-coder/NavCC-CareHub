import {
  MAX_OCCURRENCES,
  expand,
  type Civil,
  type Occurrence,
  type OccurrenceKey,
  type Override,
  type RepeatRule,
  type Series,
} from '@carehub/team-repeat';
import { addDays, isCivilDate, toCivil, toInstant, type CivilDate } from '@carehub/team-time';

/** What one occurrence can change on its own ("This event"). */
export type EventFields = {
  title: string;
  location: string;
  description: string;
  videoUrl: string | null;
};

/** An event's schedule as stored: civil values in the event's own time zone. */
export type Schedule = {
  allDay: boolean;
  timeZone: string;
  /** The first occurrence. */
  start: Civil;
  end: Civil;
  rule: RepeatRule | null;
  exceptions: OccurrenceKey[];
  overrides: Record<OccurrenceKey, Override<EventFields>>;
};

/** A viewer's range: dates in their zone (`to` exclusive) and the instants they cover. */
export type Window = { from: CivilDate; to: CivilDate; start: Date; end: Date };

const DAY_MS = 86_400_000;
const FIRST_DATE = '0001-01-01';
const LAST_DATE = '9999-12-31';

export function windowOf(from: CivilDate, to: CivilDate, timeZone: string): Window {
  const start = toInstant(`${from}T00:00`, timeZone);
  return { from, to, start, end: toInstant(`${to}T00:00`, timeZone) };
}

/** An API value (a date, or an instant) as a civil value in `timeZone`. */
export const civilOf = (when: string, timeZone: string): Civil =>
  isCivilDate(when) ? when : toCivil(new Date(when), timeZone);

/** A civil value as the API shows it: dates stay dates, date-times become instants. */
export const whenOf = (value: Civil, timeZone: string): string =>
  isCivilDate(value) ? value : toInstant(value, timeZone).toISOString();

/** The series to expand, or null for an event that doesn't repeat. */
export function seriesOf(schedule: Schedule): Series<EventFields> | null {
  const { start, end, rule, exceptions, overrides } = schedule;
  return rule ? { start, end, rule, exceptions, overrides } : null;
}

/** Whether [start, end) shows in the window: dates compare as dates, date-times as instants. */
function shows(start: Civil, end: Civil, timeZone: string, window: Window): boolean {
  if (isCivilDate(start)) return start < window.to && end > window.from;
  const [s, e] = [toInstant(start, timeZone).getTime(), toInstant(end, timeZone).getTime()];
  const [from, to] = [window.start.getTime(), window.end.getTime()];
  return s < to && (e > from || (s === e && s >= from));
}

const widen = (date: CivilDate, days: number): CivilDate => {
  if (days < 0 && date < addDays(FIRST_DATE, -days)) return FIRST_DATE;
  if (days > 0 && date > addDays(LAST_DATE, -days)) return LAST_DATE;
  return addDays(date, days);
};

/** The occurrences that show in the window. An event that doesn't repeat is its own one. */
export function occurrencesIn(
  schedule: Schedule,
  window: Window,
): { occurrences: Occurrence<EventFields>[]; truncated: boolean } {
  const { timeZone, start, end } = schedule;
  const series = seriesOf(schedule);
  if (!series) {
    const occurrences = shows(start, end, timeZone, window) ? [{ key: start, start, end }] : [];
    return { occurrences, truncated: false };
  }
  // Two days either side cover any difference between the viewer's zone and the event's.
  const civilWindow = { from: widen(window.from, -2), to: widen(window.to, 2) };
  const { occurrences, truncated } = expand(series, { ...civilWindow, limit: MAX_OCCURRENCES });
  return {
    occurrences: occurrences.filter((o) => shows(o.start, o.end, timeZone, window)),
    truncated,
  };
}

/**
 * Real-time bounds for finding an event by range, a day wider for all-day dates (they show on
 * their date in every zone). `endAt` is null when the series never ends, or is too long to tell.
 */
export function boundsOf(schedule: Schedule): { startAt: Date; endAt: Date | null } {
  const { timeZone } = schedule;
  const instant = (value: Civil, days: number) =>
    isCivilDate(value)
      ? Date.parse(`${value}T00:00:00Z`) + days * DAY_MS
      : toInstant(value, timeZone).getTime();
  const series = seriesOf(schedule);
  if (!series) {
    return {
      startAt: new Date(instant(schedule.start, -1)),
      endAt: new Date(instant(schedule.end, 1)),
    };
  }
  // A moved occurrence can sit before the first one or after the last; without its own end it
  // keeps the series' length.
  const length = instant(series.end, 0) - instant(series.start, 0);
  const moved = Object.entries(series.overrides ?? {}).map(([key, override]) => {
    const start = override.start ?? key;
    return { start, end: override.end ? instant(override.end, 1) : instant(start, 1) + length };
  });
  const startAt = new Date(
    Math.min(...[series.start, ...moved.map((o) => o.start)].map((s) => instant(s, -1))),
  );
  if (series.rule.count === undefined && series.rule.until === undefined) {
    return { startAt, endAt: null };
  }
  const all = expand(series, { from: series.start, to: LAST_DATE, limit: MAX_OCCURRENCES });
  if (all.truncated) return { startAt, endAt: null };
  const ends = [
    instant(series.end, 1),
    ...all.occurrences.map((o) => instant(o.end, 1)),
    ...moved.map((o) => o.end),
  ];
  return { startAt, endAt: new Date(Math.max(...ends)) };
}
