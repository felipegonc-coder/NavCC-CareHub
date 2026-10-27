/**
 * Schedules for automations (Automations spec, section 3, Schedule and Running): when a scheduled
 * automation runs, how its schedule reads in plain words, and what happens to a run the server
 * was off for. Times are wall-clock times in the schedule's own time zone, so "9:00 AM" stays
 * 9:00 AM across clock changes. A time that doesn't exist that day runs at the next valid time;
 * a time that happens twice runs once, the first time. Pure: the caller passes `now`.
 */
import type { CivilDate, CivilTime, TimePrefs, Weekday } from '@carehub/team-time';
import {
  addDays,
  combine,
  datePart,
  dayOfWeek,
  daysInMonth,
  defaultZoneLabel,
  formatDate,
  formatTime,
  isCivilDate,
  isCivilTime,
  isValidTimeZone,
  toCivil,
  toInstant,
  todayIn,
  weekdayName,
} from '@carehub/team-time';

/** Once on a date, every day, Monday to Friday, chosen days of the week, or a day of the month. */
export type Schedule =
  | { kind: 'once'; date: CivilDate; time: CivilTime; timeZone: string }
  | { kind: 'daily'; time: CivilTime; timeZone: string; endDate: CivilDate | null }
  | { kind: 'weekdays'; time: CivilTime; timeZone: string; endDate: CivilDate | null }
  | {
      kind: 'weekly';
      days: Weekday[];
      time: CivilTime;
      timeZone: string;
      endDate: CivilDate | null;
    }
  | {
      kind: 'monthly';
      /** 1 to 28, or the month's last day. */
      dayOfMonth: number | 'last';
      time: CivilTime;
      timeZone: string;
      endDate: CivilDate | null;
    };

export type ScheduleKind = Schedule['kind'];

/** A save error that names its field ('time', 'days'…), worded for the editor. */
export type ScheduleProblem = { field: string; message: string };

/** How a run went against its planned time (spec, Running). */
export type RunTiming =
  { kind: 'on-time' } | { kind: 'late'; minutes: number } | { kind: 'missed' };

/** Runs of one scheduled automation are at least this far apart (spec, Running: Limits). */
export const MIN_MINUTES_BETWEEN_RUNS = 15;
/** A run that starts this many minutes after its planned time is marked late. */
export const LATE_AFTER_MINUTES = 1;
/** A run this many minutes late or more isn't run: it's logged as missed. */
export const MISSED_AFTER_MINUTES = 60;
export const MISSED_MESSAGE = 'Missed: the server was off';

const MINUTE_MS = 60_000;
// Every kind runs at least once a month, so a run is never further ahead than this.
const MAX_DAYS_AHEAD = 62;

/** True when a repeating schedule has a run on `date` (ignoring the end date). */
function runsOn(schedule: Exclude<Schedule, { kind: 'once' }>, date: CivilDate): boolean {
  const weekday = dayOfWeek(date);
  switch (schedule.kind) {
    case 'daily':
      return true;
    case 'weekdays':
      return weekday >= 1 && weekday <= 5;
    case 'weekly':
      return schedule.days.includes(weekday);
    case 'monthly': {
      const day = Number(date.slice(8));
      if (schedule.dayOfMonth !== 'last') return day === schedule.dayOfMonth;
      return day === daysInMonth(Number(date.slice(0, 4)), Number(date.slice(5, 7)));
    }
  }
}

/** The first planned run strictly after `after`, or null when none is left. */
export function nextRun(schedule: Schedule, after: Date): Date | null {
  if (schedule.kind === 'once') {
    const at = toInstant(combine(schedule.date, schedule.time), schedule.timeZone);
    return at.getTime() > after.getTime() ? at : null;
  }
  // Start a day early: a time moved forward by a clock change can land on the next day.
  let date = addDays(datePart(toCivil(after, schedule.timeZone)), -1);
  for (let i = 0; i < MAX_DAYS_AHEAD; i += 1, date = addDays(date, 1)) {
    if (schedule.endDate !== null && date > schedule.endDate) return null;
    if (!runsOn(schedule, date)) continue;
    const at = toInstant(combine(date, schedule.time), schedule.timeZone);
    if (at.getTime() > after.getTime()) return at;
  }
  return null;
}

/** The run to plan next: after `now`, and at least 15 minutes after the last run, if any. */
export function planNextRun(
  schedule: Schedule,
  now: Date,
  lastRanAt: Date | null = null,
): Date | null {
  const earliest = lastRanAt ? lastRanAt.getTime() + MIN_MINUTES_BETWEEN_RUNS * MINUTE_MS - 1 : 0;
  return nextRun(schedule, new Date(Math.max(now.getTime(), earliest)));
}

/** On time, late (within the hour) or missed, for a run starting at `now`. */
export function runTiming(plannedFor: Date, now: Date): RunTiming {
  const minutes = Math.floor((now.getTime() - plannedFor.getTime()) / MINUTE_MS);
  if (minutes >= MISSED_AFTER_MINUTES) return { kind: 'missed' };
  if (minutes >= LATE_AFTER_MINUTES) return { kind: 'late', minutes };
  return { kind: 'on-time' };
}

/** 'Ran 25 minutes late', 'Missed: the server was off', or null for a run on time. */
export function describeRunTiming(timing: RunTiming): string | null {
  if (timing.kind === 'missed') return MISSED_MESSAGE;
  if (timing.kind === 'on-time') return null;
  return `Ran ${timing.minutes} minute${timing.minutes === 1 ? '' : 's'} late`;
}

/**
 * Sorts out the planned runs from `plannedFor` up to `now`, for start-up after the server was
 * off: runs less than an hour late are due (run them now, marked late), older ones are missed
 * (log them). `next` is the first run still ahead. Only the latest `keep` missed runs are listed,
 * as only the last 100 runs of an automation are kept.
 */
export function catchUp(
  schedule: Schedule,
  plannedFor: Date,
  now: Date,
  keep = 100,
): { missed: Date[]; due: Date[]; next: Date | null } {
  const missed: Date[] = [];
  const due: Date[] = [];
  let at: Date | null = plannedFor;
  while (at && at.getTime() <= now.getTime()) {
    if (runTiming(at, now).kind === 'missed') missed.push(at);
    else due.push(at);
    if (missed.length > keep) missed.shift();
    at = nextRun(schedule, at);
  }
  return { missed, due, next: at };
}

/** Save errors for a schedule, each naming its field. Empty when it's fine. */
export function scheduleProblems(schedule: Schedule, now: Date): ScheduleProblem[] {
  const problems: ScheduleProblem[] = [];
  const add = (field: string, message: string) => problems.push({ field, message });
  const zoneOk = isValidTimeZone(schedule.timeZone);
  const timeOk = isCivilTime(schedule.time) && Number(schedule.time.slice(3)) % 15 === 0;
  if (!timeOk) add('time', 'Pick a time on the quarter hour, like 9:00 or 9:15.');
  if (!zoneOk) add('timeZone', 'Pick a time zone.');
  if (schedule.kind === 'once') {
    if (!isCivilDate(schedule.date)) add('date', 'Pick a date.');
    else if (timeOk && zoneOk && nextRun(schedule, now) === null) {
      add('time', 'That time has already passed.');
    }
    return problems;
  }
  if (schedule.kind === 'weekly') {
    const days = schedule.days;
    const valid = days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6);
    if (days.length === 0 || !valid) add('days', 'Pick at least one day.');
  }
  if (schedule.kind === 'monthly') {
    const day = schedule.dayOfMonth;
    if (day !== 'last' && !(Number.isInteger(day) && day >= 1 && day <= 28)) {
      add('dayOfMonth', 'Pick a day from 1 to 28, or the last day.');
    }
  }
  if (schedule.endDate !== null) {
    if (!isCivilDate(schedule.endDate)) add('endDate', 'Pick an end date.');
    else if (problems.length === 0 && nextRun(schedule, now) === null) {
      const passed = schedule.endDate < todayIn(schedule.timeZone, now);
      add(
        'endDate',
        passed ? 'That end date has already passed.' : 'No runs are left before the end date.',
      );
    }
  }
  return problems;
}

const ORDINAL_SUFFIX: Record<string, string> = { '1': 'st', '2': 'nd', '3': 'rd' };

/** 1st, 2nd, 3rd, 4th… 11th, 12th, 13th… 21st, 22nd, 23rd… 28th. */
function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  return `${n}${(!teen && ORDINAL_SUFFIX[String(n % 10)]) || 'th'}`;
}

/** 'Monday', 'Monday and Friday', 'Monday, Wednesday and Friday'. */
function listDays(days: readonly Weekday[], weekStart: number): string {
  const order = (d: Weekday) => (d - weekStart + 7) % 7;
  const names = [...new Set(days)].sort((a, b) => order(a) - order(b)).map((d) => weekdayName(d));
  return names.length <= 1
    ? names.join('')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Which days a repeating schedule runs on, as the start of a sentence. */
function describeDays(schedule: Exclude<Schedule, { kind: 'once' }>, weekStart: number): string {
  if (schedule.kind === 'daily') return 'Every day';
  if (schedule.kind === 'weekdays') return 'Weekdays';
  if (schedule.kind === 'monthly') {
    const day = schedule.dayOfMonth === 'last' ? 'last day' : ordinal(schedule.dayOfMonth);
    return `Every month on the ${day}`;
  }
  const days = new Set(schedule.days);
  if (days.size === 7) return 'Every day';
  if (days.size === 5 && !days.has(0) && !days.has(6)) return 'Weekdays';
  return `Every ${listDays(schedule.days, weekStart)}`;
}

/**
 * The schedule in plain words, for the list and the editor's readback: 'Weekdays at 9:00 AM',
 * 'Every Monday and Thursday at 2:30 PM until Dec 18, 2026', 'Once on Oct 30, 2026 at 9:00 AM'.
 * The time zone is named when it isn't the reader's own: 'Every day at 9:00 AM (Lisbon time)'.
 */
export function describeSchedule(schedule: Schedule, prefs: TimePrefs): string {
  const at = `at ${formatTime(schedule.time, prefs)}`;
  const zone =
    schedule.timeZone === prefs.timeZone
      ? ''
      : ` (${schedule.timeZone === 'UTC' ? 'UTC' : `${defaultZoneLabel(schedule.timeZone)} time`})`;
  if (schedule.kind === 'once') return `Once on ${formatDate(schedule.date)} ${at}${zone}`;
  const until = schedule.endDate === null ? '' : ` until ${formatDate(schedule.endDate)}`;
  return `${describeDays(schedule, prefs.weekStart)} ${at}${zone}${until}`;
}
