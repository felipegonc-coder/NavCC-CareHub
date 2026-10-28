/**
 * The Date arrives trigger (Automations spec, section 3): it fires when a row's date arrives, at
 * the date or a set number of minutes, hours or days before or after it ("1 day before Review date
 * at 9:00 AM"). Dates without a time use the trigger's time of day, 9:00 AM unless another is set,
 * in its time zone. Days move the wall clock, so "1 day before" keeps its time across clock
 * changes; minutes and hours are exact. The server checks every 30 seconds for arrivals since its
 * last check, so a moved date moves its run. Pure: the caller passes the rows and the times.
 */
import { z } from 'zod';
import type { CivilDate, CivilTime, TimePrefs } from '@carehub/team-time';
import {
  addDays,
  combine,
  datePart,
  formatTime,
  isCivilDate,
  isCivilTime,
  isValidTimeZone,
  timePart,
  toCivil,
  toInstant,
} from '@carehub/team-time';

export type DateOffsetUnit = 'minutes' | 'hours' | 'days';

/** How long before or after the date it fires. */
export interface DateOffset {
  amount: number;
  unit: DateOffsetUnit;
  direction: 'before' | 'after';
}

export interface DateArrivesTrigger {
  kind: 'dateArrives';
  databaseId: string;
  /** The Date property it watches. */
  propertyId: string;
  /** Null: at the date itself. */
  offset: DateOffset | null;
  /** The time of day for dates without a time. */
  time: CivilTime;
  /** The automation's time zone (the creator's unless changed). */
  timeZone: string;
}

export const DEFAULT_ARRIVAL_TIME: CivilTime = '09:00';
/** The largest offset for each unit: a day of minutes, 30 days of hours, a year of days. */
export const MAX_OFFSET: Readonly<Record<DateOffsetUnit, number>> = {
  minutes: 1_440,
  hours: 720,
  days: 365,
};

/** A row's date as Databases gives it: a day, or an instant for a date with a time. */
export interface RowDate {
  allDay: boolean;
  /** 'YYYY-MM-DD' for a day; an ISO instant ('…Z') for a date with a time. */
  start: string;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** The shape, checked in validate.ts; dateArrivesProblems words the errors. */
export const dateArrivesTrigger = z.object({
  kind: z.literal('dateArrives'),
  databaseId: z.string().min(1).max(200),
  propertyId: z.string().max(200),
  offset: z
    .object({
      amount: z.number(),
      unit: z.enum(['minutes', 'hours', 'days']),
      direction: z.enum(['before', 'after']),
    })
    .nullable(),
  time: z.string().max(5),
  timeZone: z.string().max(100),
});

/** The save errors, each naming its field ('propertyId', 'offset', 'time', 'timeZone'). */
export function dateArrivesProblems(
  trigger: DateArrivesTrigger,
): { field: string; message: string }[] {
  const problems: { field: string; message: string }[] = [];
  if (trigger.propertyId.trim() === '')
    problems.push({ field: 'propertyId', message: 'Pick a date property.' });
  const { offset } = trigger;
  if (offset !== null) {
    const max = MAX_OFFSET[offset.unit];
    if (!Number.isInteger(offset.amount) || offset.amount < 1 || offset.amount > max) {
      problems.push({
        field: 'offset',
        message: `Pick 1 to ${max.toLocaleString('en-US')} ${offset.unit}.`,
      });
    }
  }
  if (!isCivilTime(trigger.time))
    problems.push({ field: 'time', message: 'Pick a time, like 9:00 AM.' });
  if (!isValidTimeZone(trigger.timeZone))
    problems.push({ field: 'timeZone', message: 'Pick a time zone.' });
  return problems;
}

type Timing = Pick<DateArrivesTrigger, 'offset' | 'time' | 'timeZone'>;

/** The offset as whole days (moving the wall clock) and exact milliseconds; before is negative. */
function signedOffset(offset: DateOffset | null): { days: number; ms: number } {
  if (offset === null) return { days: 0, ms: 0 };
  const sign = offset.direction === 'before' ? -1 : 1;
  if (offset.unit === 'days') return { days: sign * offset.amount, ms: 0 };
  return { days: 0, ms: sign * offset.amount * (offset.unit === 'hours' ? HOUR_MS : MINUTE_MS) };
}

/**
 * When the trigger fires for a row's date; null when the date doesn't read. A day uses the
 * trigger's time in its zone; a time that doesn't exist that day moves to the next valid time,
 * and one that happens twice takes the first.
 */
export function arrivalTime(trigger: Timing, date: RowDate): Date | null {
  const { days, ms } = signedOffset(trigger.offset);
  try {
    let base: number;
    if (date.allDay) {
      if (!isCivilDate(date.start)) return null;
      const day = addDays(date.start, days);
      base = toInstant(combine(day, trigger.time), trigger.timeZone).getTime();
    } else {
      const at = date.start.includes('T') ? Date.parse(date.start) : Number.NaN;
      if (!Number.isFinite(at)) return null;
      if (days === 0) base = at;
      else {
        const wall = toCivil(new Date(at), trigger.timeZone);
        const day = addDays(datePart(wall), days);
        // The wall clock keeps minutes; the seconds come back afterwards.
        const seconds = at - Math.floor(at / MINUTE_MS) * MINUTE_MS;
        base = toInstant(combine(day, timePart(wall)), trigger.timeZone).getTime() + seconds;
      }
    }
    const arrival = new Date(base + ms);
    return Number.isNaN(arrival.getTime()) ? null : arrival;
  } catch {
    // Out-of-range dates, or a time or zone saved before the checks.
    return null;
  }
}

/**
 * The days of dates whose arrival can fall after `since` and up to `now`, with a day to spare on
 * each side: the range to ask Databases for. `to` is exclusive.
 */
export function datesToCheck(
  trigger: Timing,
  since: Date,
  now: Date,
): { from: CivilDate; to: CivilDate } {
  const { days, ms } = signedOffset(trigger.offset);
  const first = datePart(toCivil(new Date(since.getTime() - ms), trigger.timeZone));
  const last = datePart(toCivil(new Date(now.getTime() - ms), trigger.timeZone));
  return { from: addDays(first, -days - 1), to: addDays(last, -days + 2) };
}

/** The rows whose arrival is after `since` and at or before `now`, soonest first. */
export function arrivalsBetween<Row extends RowDate>(
  trigger: Timing,
  rows: readonly Row[],
  since: Date,
  now: Date,
): { row: Row; at: Date }[] {
  const due: { row: Row; at: Date }[] = [];
  for (const row of rows) {
    const at = arrivalTime(trigger, row);
    if (at !== null && at > since && at <= now) due.push({ row, at });
  }
  return due.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** The list's trigger column: 'When Review date arrives', '1 day before Review date at 9:00 AM'. */
export function describeDateArrives(
  trigger: Pick<DateArrivesTrigger, 'offset' | 'time'>,
  propertyName: string | undefined,
  prefs: Pick<TimePrefs, 'use24h'>,
): string {
  const property = propertyName ?? 'a date';
  const { offset } = trigger;
  if (offset === null) return `When ${property} arrives`;
  const unit = offset.amount === 1 ? offset.unit.slice(0, -1) : offset.unit;
  const words = `${offset.amount.toLocaleString('en-US')} ${unit} ${offset.direction} ${property}`;
  return offset.unit === 'days' ? `${words} at ${formatTime(trigger.time, prefs)}` : words;
}
