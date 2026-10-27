// Rough UTC bounds of a synced event, so range reads only load what might show (Calendar spec,
// Connections). Wall-clock times widen by 14 hours on each side, enough for any time zone, and a
// series without an end date is open-ended. The range read finds exact times later, in the
// reader's zone.
import type { ExternalEvent, ExternalTime } from '../sync/types';

const ZONE_SLACK_MS = 14 * 3_600_000;
const DAY_MS = 86_400_000;

/** The instant if the time is one, else the wall-clock time read as UTC. */
function rough(time: ExternalTime): { ms: number; exact: boolean } {
  switch (time.kind) {
    case 'utc':
      return { ms: Date.parse(time.instant), exact: true };
    case 'date':
      return { ms: Date.parse(`${time.date}T00:00:00Z`), exact: false };
    default:
      return { ms: Date.parse(`${time.dateTime}:00Z`), exact: false };
  }
}
const earliest = (time: ExternalTime) => rough(time).ms - (rough(time).exact ? 0 : ZONE_SLACK_MS);
const latest = (time: ExternalTime) => rough(time).ms + (rough(time).exact ? 0 : ZONE_SLACK_MS);

/** How long each occurrence lasts. Without an end, an all-day event lasts its day. */
function durationOf(event: ExternalEvent): number {
  if (event.end) return Math.max(0, rough(event.end).ms - rough(event.start).ms);
  return event.start.kind === 'date' ? DAY_MS : 0;
}

/** The UNTIL of an RRULE as a rough instant, or undefined when the series has none. */
function untilOf(rrule: string): number | undefined {
  const m = /(?:^|;)UNTIL=(\d{4})(\d\d)(\d\d)(?:T(\d\d)(\d\d)(\d\d)Z?)?/i.exec(rrule);
  if (!m) return undefined;
  const ms = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4] ?? '23'}:${m[5] ?? '59'}:${m[6] ?? '59'}Z`);
  return Number.isNaN(ms) ? undefined : ms + ZONE_SLACK_MS;
}

export interface EventBounds {
  startsAt: Date;
  /** Null for a series without an end. */
  endsAt: Date | null;
}

/** Covers every occurrence, and for a changed occurrence also the start it replaces. */
export function eventBounds(event: ExternalEvent): EventBounds {
  const duration = durationOf(event);
  const starts = [event.start, event.recurrenceId, ...(event.rdates ?? [])].filter(
    (time): time is ExternalTime => time !== undefined,
  );
  const first = Math.min(...starts.map(earliest));
  let last = Math.max(...starts.map((time) => latest(time) + duration));
  if (event.rrule && !event.recurrenceId) {
    const until = untilOf(event.rrule);
    if (until === undefined) return { startsAt: safeDate(first), endsAt: null };
    last = Math.max(last, until + duration);
  }
  if (Number.isNaN(first) || Number.isNaN(last)) return { startsAt: new Date(0), endsAt: null };
  return { startsAt: new Date(first), endsAt: new Date(Math.max(first, last)) };
}

const safeDate = (ms: number) => new Date(Number.isNaN(ms) ? 0 : ms);
