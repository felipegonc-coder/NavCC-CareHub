/**
 * Repeating database templates (Templates and buttons 3.2): the moments a template makes its rows,
 * what the repeat job should make now (a run missed by less than 24 hours still runs once; older
 * ones are skipped), the new rows' names and "Created by" label, when a repeat pauses and the
 * notice it sends, and checks before a schedule is saved. Pure: the time is always an input.
 */
import { can } from './access';
import {
  MONTH_SHORT,
  addDays,
  daysBetween,
  daysInMonth,
  instantToCalendarDate,
  isCalendarDate,
  isValidTimeZone,
  parseCalendarDate,
  startOfWeek,
  toCalendarDate,
  zonedParts,
  zonedToInstant,
  type YMD,
} from './dates';
import {
  LIMITS,
  type CalendarDate,
  type DatabaseGrant,
  type Id,
  type Instant,
  type RepeatSchedule,
  type RowTemplate,
} from './types';

/**
 * Words for repeating templates. createdBy is the spec's; the next four are the request schemas'
 * own; the rest, the pause notice included, are ours (the spec has no wording for them).
 */
export const REPEAT_MESSAGES = {
  createdBy: (name: string) => `Created by ${name} (repeating)`,
  noDays: 'Pick at least one day.',
  endBeforeStart: "The end can't be before the start.",
  tooMany: 'Up to 10 repeating templates.',
  timeZone: 'Unknown time zone.',
  every: 'Choose how often it repeats.',
  interval: 'Enter a number from 1 to 365.',
  days: 'Pick each day once.',
  monthDay: 'Pick a day from 1 to 28, or the last day.',
  month: 'Pick a month.',
  time: 'Pick a time on the quarter hour.',
  date: 'Enter a date.',
  paused: 'A repeating template was paused because the person who set it up no longer has access.',
} as const;
const M = REPEAT_MESSAGES;

/** What the repeat job should do for one schedule now. */
export interface DueRuns {
  /** The run to make now (its moment names the row), or null. */
  run: Instant | null;
  /** Missed runs were dropped: ones 24 hours old or more, or all but the latest. */
  skipped: boolean;
  /** The next run after now; null when paused, out of times or past the end. */
  next: Instant | null;
}

const DAY_MS = 86_400_000;
const TIME = /^(?:[01]\d|2[0-3]):(?:00|15|30|45)$/;
const EVERY: readonly RepeatSchedule['every'][] = ['day', 'weekday', 'week', 'month', 'year'];
const MONDAY_TO_FRIDAY = [1, 2, 3, 4, 5];

/**
 * The next `count` moments a schedule runs, strictly after `after`, oldest first: each run day at
 * its time in its time zone, from the start date through the end date. Every N days from the
 * start; Monday to Friday ("every weekday") or the chosen days, in every Nth week from the start's
 * week (weeks start on Sunday); every N months on the chosen day (1–28 or the last day; otherwise
 * the start's day, or the month's last day when it's shorter); every N years on that day of the
 * chosen month (otherwise the start's). The local time holds across clock changes, so no run is
 * skipped or doubled; a time the clock skips moves forward. Paused or not (dueRuns checks that);
 * an invalid schedule gives none.
 */
export function nextRuns(
  schedule: RepeatSchedule,
  after: Instant | Date,
  count: number,
): Instant[] {
  const first = parseCalendarDate(schedule.start);
  const afterMs = typeof after === 'string' ? Date.parse(after) : after.getTime();
  if (!first || !Number.isFinite(afterMs) || validateSchedule(schedule) !== null) return [];
  const [hour = 0, minute = 0] = schedule.time.split(':').map(Number);
  const n = schedule.interval ?? 1;
  // No run on a day before the one ahead of `after` (in the zone) can come after it.
  const near = addDays(instantToCalendarDate(afterMs, schedule.timeZone), -1);
  const begin = near > schedule.start ? near : schedule.start;
  const out: Instant[] = [];
  for (let k = Math.floor(periodOf(schedule, first, begin) / n) * n; out.length < count; k += n) {
    for (const day of daysInPeriod(schedule, first, k)) {
      if (schedule.end !== null && day > schedule.end) return out;
      if (day < begin || out.length >= count) continue;
      const at = zonedToInstant(day, hour, minute, schedule.timeZone);
      if (Date.parse(at) > afterMs) out.push(at);
    }
  }
  return out;
}

/** Which period since the start (day, week, month or year) a date falls in. */
function periodOf(s: RepeatSchedule, first: YMD, date: CalendarDate): number {
  const d = parseCalendarDate(date) ?? first;
  switch (s.every) {
    case 'day':
      return daysBetween(s.start, date);
    case 'weekday':
    case 'week':
      return Math.floor(daysBetween(startOfWeek(s.start, 0), date) / 7);
    case 'month':
      return (d.y - first.y) * 12 + d.m - first.m;
    case 'year':
      return d.y - first.y;
  }
}

/** The run days in period `k` since the start, in order. */
function daysInPeriod(s: RepeatSchedule, first: YMD, k: number): CalendarDate[] {
  switch (s.every) {
    case 'day':
      return [addDays(s.start, k)];
    case 'weekday':
    case 'week': {
      const week = addDays(startOfWeek(s.start, 0), 7 * k);
      const days =
        s.every === 'weekday' ? MONDAY_TO_FRIDAY : [...(s.weekDays ?? [])].sort((a, b) => a - b);
      return days.map((d) => addDays(week, d));
    }
    case 'month': {
      const months = first.y * 12 + first.m - 1 + k;
      return [dayIn(s, Math.floor(months / 12), (months % 12) + 1, first.d)];
    }
    case 'year':
      return [dayIn(s, first.y + k, s.month ?? first.m, first.d)];
  }
}

/** The run day in a month: monthDay, or the last day, or the start's day kept within the month. */
function dayIn(s: RepeatSchedule, y: number, m: number, startDay: number): CalendarDate {
  const last = daysInMonth(y, m);
  const d = s.monthDay === 'last' ? last : Math.min(s.monthDay ?? startDay, last);
  return toCalendarDate({ y, m, d });
}

/**
 * What a repeating template should make now (the job checks every 15 minutes). The latest run
 * after `lastRunAt` (the last row made; before the first, when the schedule was saved) that came
 * less than 24 hours ago runs once, even if several were missed while Care Hub was down; older
 * ones are skipped. Paused schedules never run, nor ones with no times left: `timesLeft` is for
 * "ending after a number of times", which RepeatSchedule doesn't hold yet (null: no such limit).
 */
export function dueRuns(
  schedule: RepeatSchedule,
  lastRunAt: Instant | null,
  now: Date,
  opts: { timesLeft?: number | null } = {},
): DueRuns {
  const left = opts.timesLeft ?? null;
  if (schedule.paused || (left !== null && left < 1))
    return { run: null, skipped: false, next: null };
  const nowMs = now.getTime();
  const since = Math.max(lastRunAt === null ? -Infinity : Date.parse(lastRunAt), nowMs - DAY_MS);
  const due = nextRuns(schedule, new Date(since), 3).filter((t) => Date.parse(t) <= nowMs);
  const missed = lastRunAt === null ? undefined : nextRuns(schedule, lastRunAt, 1)[0];
  const skipped = due.length > 1 || (missed !== undefined && Date.parse(missed) <= nowMs - DAY_MS);
  const run = due.at(-1) ?? null;
  const next = run !== null && left === 1 ? null : (nextRuns(schedule, now, 1)[0] ?? null);
  return { run, skipped, next };
}

/**
 * A repeating template's new row name: its name and the run's date in the schedule's time zone,
 * without the year ("Weekly huddle – Oct 26"); "Untitled" when the name is empty. A long name is
 * cut so the whole fits 2,000 characters.
 */
export function repeatTitle(name: string, runAt: Instant, timeZone: string): string {
  const p = zonedParts(runAt, timeZone);
  const suffix = ` – ${MONTH_SHORT[p.m - 1] ?? ''} ${p.d}`;
  return (name.trim() || 'Untitled').slice(0, LIMITS.title - suffix.length) + suffix;
}

/**
 * Whether a repeat must pause: the person it runs as has left the workspace, or can no longer use
 * templates to add rows in the database (their grant, or Can add rows on a rows-only share). The
 * server then sends REPEAT_MESSAGES.paused to the people with Full access on the database.
 */
export function shouldPause(owner: {
  active: boolean;
  access: DatabaseGrant | null | undefined;
  canAddRows?: boolean;
}): boolean {
  const canAddRows = owner.canAddRows === true;
  return !owner.active || !can('use_templates', owner.access, { locked: false, canAddRows });
}

/**
 * Checks a schedule before it's saved; the first problem, or null. Every N is 1 to 365; weekly
 * needs at least one day, each once; monthly days are 1 to 28 or the last day; months 1 to 12; the
 * time is on the quarter hour; the time zone is known; the end isn't before the start. With the
 * database's `templates` and the `templateId` it's for, an 11th repeating template is refused.
 */
export function validateSchedule(
  schedule: RepeatSchedule,
  opts: { templates?: readonly RowTemplate[]; templateId?: Id } = {},
): string | null {
  const s = schedule;
  const whole = (v: unknown, min: number, max: number) =>
    Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
  if (!EVERY.includes(s.every)) return M.every;
  if (s.interval !== undefined && !whole(s.interval, 1, 365)) return M.interval;
  if (s.every === 'week') {
    const days = s.weekDays ?? [];
    if (!days.length) return M.noDays;
    if (new Set(days).size < days.length || !days.every((d) => whole(d, 0, 6))) return M.days;
  }
  if (s.monthDay !== undefined && s.monthDay !== 'last' && !whole(s.monthDay, 1, 28)) {
    return M.monthDay;
  }
  if (s.month !== undefined && !whole(s.month, 1, 12)) return M.month;
  if (!TIME.test(s.time)) return M.time;
  if (!isValidTimeZone(s.timeZone)) return M.timeZone;
  if (!isCalendarDate(s.start) || (s.end !== null && !isCalendarDate(s.end))) return M.date;
  if (s.end !== null && s.end < s.start) return M.endBeforeStart;
  const others = (opts.templates ?? []).filter((t) => t.repeat && t.id !== opts.templateId);
  return others.length >= LIMITS.repeatingTemplates ? M.tooMany : null;
}
