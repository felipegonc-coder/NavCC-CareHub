// Events from connected calendars as the occurrences that show in a range (Calendar spec, Events:
// times are exact moments shown in the viewer's time zone, and all-day events are dates that
// never shift; CA-13). Copies keep a repeating event the way its calendar sent it: an RRULE,
// RDATEs and EXDATEs, plus each changed or cancelled occurrence as its own event with a
// RECURRENCE-ID. The rule is expanded with @carehub/team-repeat on the wall clock of the event's
// own time zone, so a 9:00 meeting stays at 9:00 there when the clocks change.
import { LIMITS } from '@carehub/team-calendar-api';
import { MAX_OCCURRENCES, expand, isUnsupported, parseRRule } from '@carehub/team-repeat';
import type { Civil, RepeatRule } from '@carehub/team-repeat';
import {
  addDays,
  addMinutes,
  combine,
  daysBetween,
  isCivilDate,
  isValidTimeZone,
  timePart,
  toCivil,
  toInstant,
} from '@carehub/team-time';
import type { CivilDate, CivilDateTime } from '@carehub/team-time';
import type { ExternalEvent, ExternalTime } from './types';

/** Time one read may spend, so calendars full of costly events can't hold up the server. */
export const MAX_EXPAND_MS = 250;
/** RDATEs read per event, as many as the iCalendar reader keeps. */
export const MAX_RDATES = 1000;

/** The days asked for, in the viewer's time zone: `to` is exclusive, at most 42 days after `from`. */
export interface ExpandRange {
  from: CivilDate;
  to: CivilDate;
  /** The viewer's time zone. Floating times, which have none, are read in it. */
  timeZone: string;
}

/** What expandSyncedEvents needs from listSyncedEvents' rows. */
export interface SyncedRow {
  id: string;
  /** On a changed or cancelled occurrence: its series' row, or null when Care Hub can't see it. */
  seriesId: string | null;
  event: ExternalEvent;
}

export interface SyncedOccurrence<R> {
  /** The row whose details show: the event itself, or the changed occurrence that replaces it. */
  row: R;
  /** The series' row, for an occurrence of a repeating event; null otherwise. */
  series: R | null;
  /**
   * Null for a single event. Otherwise the occurrence's original start, which stays the same when
   * it moves: a date for all-day events, or an exact moment such as '2026-10-27T16:00:00.000Z'.
   */
  key: string | null;
  allDay: boolean;
  /** Dates for all-day occurrences, with `end` exclusive; exact moments otherwise. */
  start: string;
  end: string;
  /** The event's own time zone; null when it's all-day. Floating times are the viewer's. */
  timeZone: string | null;
}

export interface SyncedExpansion<R> {
  /** By start. */
  occurrences: SyncedOccurrence<R>[];
  /**
   * True when there may be more than these: a cap was reached, an event couldn't be read, or a
   * repeat rule is one Care Hub can't expand (then only its first occurrence, its RDATEs and its
   * changed occurrences show).
   */
  truncated: boolean;
}

/** Stops expanding rules once `now()` passes `until`. */
export interface ExpandBudget {
  now: () => number;
  until: number;
}

type Range = { from: CivilDate; to: CivilDate; zone: string; fromMs: number; toMs: number };
type Times = Pick<SyncedOccurrence<unknown>, 'allDay' | 'start' | 'end' | 'timeZone'>;
/** How a series counts occurrences: by date, or on the wall clock of one time zone. */
type Frame = { allDay: true } | { allDay: false; zone: string; time: string };
type Timed = Exclude<ExternalTime, { kind: 'date' }>;

const DAY_MS = 86_400_000;
const msAt = (civil: CivilDateTime, zone: string) => toInstant(civil, zone).getTime();
const iso = (ms: number) => new Date(ms).toISOString();
const zoneOr = (zone: string, floating: string) => (isValidTimeZone(zone) ? zone : floating);

function readRange({ from, to, timeZone }: ExpandRange): Range {
  if (!isCivilDate(from) || !isCivilDate(to) || !isValidTimeZone(timeZone)) {
    throw new RangeError('The range needs two dates and a time zone.');
  }
  const days = daysBetween(from, to);
  if (days < 1 || days > LIMITS.rangeDays) {
    throw new RangeError(`The range must cover 1 to ${LIMITS.rangeDays} days.`);
  }
  const [fromMs, toMs] = [msAt(`${from}T00:00`, timeZone), msAt(`${to}T00:00`, timeZone)];
  return { from, to, zone: timeZone, fromMs, toMs };
}

/** The exact moment of a timed value. Floating ones are read in `floating`. */
function msOf(time: Timed, floating: string): number {
  if (time.kind === 'utc') return Date.parse(time.instant);
  const zone = time.kind === 'zoned' ? zoneOr(time.timeZone, floating) : floating;
  return msAt(time.dateTime, zone);
}

/** Within a day of a time's exact moment, without time zone math: zones are within 14 hours of UTC. */
function roughMs(time: ExternalTime): number {
  if (time.kind === 'utc') return Date.parse(time.instant);
  return Date.parse(time.kind === 'date' ? `${time.date}T00:00Z` : `${time.dateTime}Z`);
}

/** An event at its own times, as it shows on its own. */
function ownTimes(event: ExternalEvent, floating: string): Times {
  const { start, end } = event;
  if (start.kind === 'date') {
    const last = end?.kind === 'date' && end.date > start.date ? end.date : addDays(start.date, 1);
    return { allDay: true, start: start.date, end: last, timeZone: null };
  }
  const startMs = msOf(start, floating);
  const endMs = end && end.kind !== 'date' ? Math.max(startMs, msOf(end, floating)) : startMs;
  const timeZone =
    start.kind === 'utc'
      ? 'UTC'
      : start.kind === 'zoned'
        ? zoneOr(start.timeZone, floating)
        : floating;
  return { allDay: false, start: iso(startMs), end: iso(endMs), timeZone };
}

/** Whether it overlaps the range. Something with no length counts at its start. */
function overlaps(times: Times, range: Range): boolean {
  if (times.allDay) return times.start < range.to && times.end > range.from;
  const [start, end] = [Date.parse(times.start), Date.parse(times.end)];
  return start < range.toMs && (end > range.fromMs || (start === end && start >= range.fromMs));
}

function frameOf(start: ExternalTime, floating: string): Frame {
  switch (start.kind) {
    case 'date':
      return { allDay: true };
    case 'utc':
      return { allDay: false, zone: 'UTC', time: start.instant.slice(11, 16) };
    case 'zoned':
      return {
        allDay: false,
        zone: zoneOr(start.timeZone, floating),
        time: timePart(start.dateTime),
      };
    case 'floating':
      return { allDay: false, zone: floating, time: timePart(start.dateTime) };
  }
}

/**
 * A time as the series counts it: a date, or the wall clock in the series' zone. A date given for
 * a timed series means its occurrence that day; a time given for an all-day series, its date.
 */
function inFrame(time: ExternalTime, frame: Frame): Civil {
  if (frame.allDay) {
    if (time.kind === 'date') return time.date;
    return (time.kind === 'utc' ? time.instant : time.dateTime).slice(0, 10);
  }
  switch (time.kind) {
    case 'date':
      return combine(time.date, frame.time);
    case 'floating':
      return time.dateTime;
    case 'zoned':
      return time.timeZone === frame.zone
        ? time.dateTime
        : toCivil(new Date(msOf(time, frame.zone)), frame.zone);
    case 'utc':
      return toCivil(new Date(time.instant), frame.zone);
  }
}

/** Where an occurrence of the series with this key shows, before any change to it. */
function regular(key: Civil, frame: Frame, length: number): Times & { key: string } {
  if (frame.allDay) {
    return { key, allDay: true, start: key, end: addDays(key, length), timeZone: null };
  }
  const start = iso(msAt(key, frame.zone));
  return {
    key: start,
    allDay: false,
    start,
    end: iso(Date.parse(start) + length),
    timeZone: frame.zone,
  };
}

/** The key that goes out with an occurrence: a date, or the exact moment of the original start. */
const outKey = (key: Civil, frame: Frame) => (frame.allDay ? key : iso(msAt(key, frame.zone)));

/**
 * Outlook and Apple write "the 2nd Tuesday" as BYDAY=TU;BYSETPOS=2, which team-repeat doesn't
 * read. With one weekday and no BYMONTHDAY, in a monthly rule or a yearly one with one month,
 * that's BYDAY=2TU. Any other rule comes back unchanged.
 */
export function withoutSetPos(text: string): string {
  const parts = text
    .trim()
    .replace(/^RRULE:/i, '')
    .split(';')
    .filter((part) => part !== '')
    .map((part) => part.split('='));
  const values = new Map(parts.map(([name = '', value = '']) => [name.toUpperCase(), value]));
  const positions = values.get('BYSETPOS')?.split(',');
  const day = values.get('BYDAY')?.toUpperCase() ?? '';
  const freq = values.get('FREQ')?.toUpperCase();
  const oneMonth = /^\d{1,2}$/.test(values.get('BYMONTH') ?? '');
  if (
    !positions ||
    parts.some((part) => part.length !== 2) ||
    values.size !== parts.length ||
    !(freq === 'MONTHLY' || (freq === 'YEARLY' && oneMonth)) ||
    values.has('BYMONTHDAY') ||
    !/^(SU|MO|TU|WE|TH|FR|SA)$/.test(day) ||
    !positions.every((position) => /^[+-]?[1-5]$/.test(position))
  ) {
    return text;
  }
  const days = positions.map((position) => `${position.replace('+', '')}${day}`);
  return parts
    .filter(([name = '']) => name.toUpperCase() !== 'BYSETPOS')
    .map(([name = '', value]) =>
      name.toUpperCase() === 'BYDAY' ? `BYDAY=${days.join(',')}` : `${name}=${value}`,
    )
    .join(';');
}

function readRule(text: string, frame: Frame): RepeatRule | null {
  // A UTC UNTIL counts on the series' wall clock; for all-day series, on UTC's.
  const fromUtc = (instant: string) =>
    frame.allDay ? instant.slice(0, 16) : toCivil(new Date(instant), frame.zone);
  const rule = parseRRule(withoutSetPos(text), { fromUtc });
  return isUnsupported(rule) ? null : rule;
}

/** Of two copies of one changed occurrence, the later version. */
const newer = (a: ExternalEvent, b: ExternalEvent) =>
  (a.sequence ?? 0) !== (b.sequence ?? 0)
    ? (a.sequence ?? 0) > (b.sequence ?? 0)
    : (a.updatedAt ?? '') > (b.updatedAt ?? '');

/**
 * The occurrences of one event that show in the range, by start: a single event, or a series with
 * its changed and cancelled occurrences (rows with the same uid and a `recurrenceId`). Changed
 * occurrences show at their own times, with the key of the occurrence they replace, even when the
 * rule doesn't make that occurrence. Throws a RangeError for a bad range or a time it can't read.
 */
export function expandSeries<R extends { event: ExternalEvent }>(
  series: R,
  changes: readonly R[],
  range: ExpandRange,
  budget?: ExpandBudget,
): SyncedExpansion<R> {
  return expandOne(series, changes, readRange(range), budget);
}

function expandOne<R extends { event: ExternalEvent }>(
  series: R,
  changes: readonly R[],
  checked: Range,
  budget: ExpandBudget | undefined,
): SyncedExpansion<R> {
  const { event } = series;
  const floating = checked.zone;
  if (event.status === 'cancelled') return { occurrences: [], truncated: false };
  const own = ownTimes(event, floating);
  const repeats = Boolean(event.rrule) || (event.rdates?.length ?? 0) > 0;
  if (!repeats && !changes.some((change) => change.event.recurrenceId)) {
    const occurrences = overlaps(own, checked)
      ? [{ row: series, series: null, key: null, ...own }]
      : [];
    return { occurrences, truncated: false };
  }

  if (budget && budget.now() > budget.until) return { occurrences: [], truncated: true };
  const frame = frameOf(event.start, floating);
  const start = inFrame(event.start, frame);
  // All-day: days. Timed: the exact length, which every occurrence keeps (RFC 5545, 3.8.5.3).
  const length = own.allDay
    ? daysBetween(own.start, own.end)
    : Date.parse(own.end) - Date.parse(own.start);

  const replaced = new Map<Civil, R>();
  for (const change of changes) {
    if (!change.event.recurrenceId) continue;
    const key = inFrame(change.event.recurrenceId, frame);
    const kept = replaced.get(key);
    if (!kept || newer(change.event, kept.event)) replaced.set(key, change);
  }
  // EXDATEs and RDATEs far from the range can't matter, so they skip the time zone math.
  const reach = own.allDay ? length * DAY_MS : length;
  const near = (time: ExternalTime) => {
    const ms = roughMs(time);
    return ms > checked.fromMs - reach - 2 * DAY_MS && ms < checked.toMs + 2 * DAY_MS;
  };
  const removed = new Set<Civil>(replaced.keys());
  for (const time of event.exdates ?? []) if (near(time)) removed.add(inFrame(time, frame));

  const found: SyncedOccurrence<R>[] = [];
  const seen = new Set<Civil>([start]);
  let truncated = false;
  const add = (key: Civil) => {
    const times = regular(key, frame, length);
    if (!removed.has(key) && overlaps(times, checked)) {
      found.push({ row: series, series, ...times });
    }
  };

  const rule = event.rrule ? readRule(event.rrule, frame) : null;
  if (event.rrule && !rule) truncated = true;
  if (rule) {
    // Timed series: a day more on each side, then exact moments decide (clock changes included).
    const window = frame.allDay
      ? { from: checked.from, to: checked.to }
      : {
          from: combine(
            addDays(toCivil(new Date(checked.fromMs), frame.zone).slice(0, 10), -1),
            '00:00',
          ),
          to: combine(
            addDays(toCivil(new Date(checked.toMs), frame.zone).slice(0, 10), 2),
            '00:00',
          ),
        };
    const end = frame.allDay
      ? addDays(start, length)
      : addMinutes(start, Math.round(length / 60_000));
    const expansion = expand({ start, end, rule }, window);
    truncated ||= expansion.truncated;
    for (const { key } of expansion.occurrences) {
      seen.add(key);
      add(key);
    }
  } else {
    add(start);
  }
  const rdates = event.rdates ?? [];
  if (rdates.length > MAX_RDATES) truncated = true;
  for (const time of rdates.slice(0, MAX_RDATES)) {
    if (!near(time)) continue;
    const key = inFrame(time, frame);
    if (seen.has(key)) continue;
    seen.add(key);
    add(key);
  }
  for (const [key, change] of replaced) {
    if (change.event.status === 'cancelled') continue;
    const times = ownTimes(change.event, floating);
    if (overlaps(times, checked)) {
      found.push({ row: change, series, key: outKey(key, frame), ...times });
    }
  }
  found.sort(byStart);
  if (found.length > MAX_OCCURRENCES) truncated = true;
  return { occurrences: found.slice(0, MAX_OCCURRENCES), truncated };
}

const byStart = (a: SyncedOccurrence<unknown>, b: SyncedOccurrence<unknown>) =>
  timeOf(a) - timeOf(b) || (a.key ?? '').localeCompare(b.key ?? '');
/** All-day occurrences sort at their date's midnight in UTC. */
const timeOf = (o: SyncedOccurrence<unknown>) => Date.parse(o.start);

/**
 * Turns listSyncedEvents' rows into the occurrences that show in the range, by start. Single events
 * show as they are; series are expanded with their changed and cancelled occurrences; a changed
 * occurrence whose series isn't in `rows` shows on its own. After MAX_EXPAND_MS the remaining rows
 * are left out, and so is an event that can't be read; both set `truncated`.
 */
export function expandSyncedEvents<R extends SyncedRow>(
  rows: readonly R[],
  range: ExpandRange,
  options: { now?: () => number; budgetMs?: number } = {},
): SyncedExpansion<R> {
  const checked = readRange(range);
  const now = options.now ?? (() => performance.now());
  const budget = { now, until: now() + (options.budgetMs ?? MAX_EXPAND_MS) };
  const series = new Map(rows.filter((row) => !row.event.recurrenceId).map((row) => [row.id, row]));
  const changes = new Map<string, R[]>();
  const alone: R[] = [];
  for (const row of rows) {
    if (!row.event.recurrenceId) continue;
    const owner = row.seriesId === null ? undefined : series.get(row.seriesId);
    const list = owner && changes.get(owner.id);
    if (!owner) alone.push(row);
    else if (list) list.push(row);
    else changes.set(owner.id, [row]);
  }
  const found: SyncedOccurrence<R>[] = [];
  let truncated = false;
  for (const row of [...series.values(), ...alone]) {
    if (budget.now() > budget.until) {
      truncated = true;
      break;
    }
    try {
      const expansion = row.event.recurrenceId
        ? { occurrences: shownAlone(row, checked), truncated: false }
        : expandOne(row, changes.get(row.id) ?? [], checked, budget);
      found.push(...expansion.occurrences);
      truncated ||= expansion.truncated;
    } catch {
      truncated = true;
    }
  }
  return { occurrences: found.sort(byStart), truncated };
}

/** A changed occurrence whose series isn't in the rows, shown on its own. */
function shownAlone<R extends SyncedRow>(row: R, range: Range): SyncedOccurrence<R>[] {
  const { recurrenceId, status } = row.event;
  if (!recurrenceId || status === 'cancelled') return [];
  const times = ownTimes(row.event, range.zone);
  if (!overlaps(times, range)) return [];
  // When Care Hub has its series, just not in this range, it keeps its key.
  const key =
    row.seriesId === null
      ? null
      : recurrenceId.kind === 'date'
        ? recurrenceId.date
        : iso(msOf(recurrenceId, range.zone));
  return [{ row, series: null, key, ...times }];
}
