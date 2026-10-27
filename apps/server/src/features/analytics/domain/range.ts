// The date ranges Analytics shows, in the viewer's time zone (Analytics spec, section 2; AN-04).
import { addDays, combine, isCivilDate, toInstant, type CivilDate } from '@carehub/team-time';

const DAY_MS = 86_400_000;

/** How many days of activity are kept (AN-D2: 1 year), counting today. */
export const KEEP_DAYS = 365;

/** The ranges to choose from: the last 7 days (the default), 30 days or 90 days, with today. */
export const PRESET_DAYS = [7, 30, 90] as const;
export type PresetDays = (typeof PRESET_DAYS)[number];
export const DEFAULT_PRESET_DAYS: PresetDays = 7;

/** Days from `from` to `to`, both included. */
export interface DayRange {
  from: CivilDate;
  to: CivilDate;
}

/** One day in the viewer's time zone, from `start` up to (not including) `end`. */
export interface DaySpan {
  day: CivilDate;
  start: Date;
  end: Date;
}

export function presetRange(days: PresetDays, today: CivilDate): DayRange {
  return { from: addDays(today, 1 - days), to: today };
}

/** The first day that's still kept, in the viewer's time zone. */
export function firstKeptDay(today: CivilDate): CivilDate {
  return addDays(today, 1 - KEEP_DAYS);
}

/**
 * A custom range, cut to the days that are kept (the first kept day to today). Null when `from`
 * and `to` aren't dates, `from` is after `to`, or none of its days are kept.
 */
export function customRange(from: unknown, to: unknown, today: CivilDate): DayRange | null {
  if (!isCivilDate(from) || !isCivilDate(to) || from > to) return null;
  const first = firstKeptDay(today);
  const range = { from: from < first ? first : from, to: to > today ? today : to };
  return range.from <= range.to ? range : null;
}

const midnight = (day: CivilDate, timeZone: string) => toInstant(combine(day, '00:00'), timeZone);

/** Each day of the range in order, with its start and end in `timeZone`. */
export function daySpans(range: DayRange, timeZone: string): DaySpan[] {
  const spans: DaySpan[] = [];
  let start = midnight(range.from, timeZone);
  for (let day = range.from; day <= range.to; day = addDays(day, 1)) {
    const end = midnight(addDays(day, 1), timeZone);
    spans.push({ day, start, end });
    start = end;
  }
  return spans;
}

/**
 * The nightly clean-up deletes activity from before this (AN-07). It keeps a day more than
 * KEEP_DAYS, so the first kept day is whole in every time zone.
 */
export function deleteBefore(now: Date): Date {
  return new Date(now.getTime() - (KEEP_DAYS + 1) * DAY_MS);
}
