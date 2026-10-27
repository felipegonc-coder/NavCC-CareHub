// Google Calendar events to Care Hub's ExternalEvent, read-only (CA-07, CA-17, CA-18). Times keep
// their zone, all-day stays all-day, a series keeps its RRULE, EXDATEs and RDATEs, and the
// meeting link comes from Google's conference details, the location or the description.
import type { ExternalAttendee, ExternalEvent, ExternalTime } from '../types';
import { findVideoLink } from '../video-link';
import type { GoogleEvent } from './client';

export type MappedGoogleEvent =
  /** `htmlLink` opens the event in Google Calendar, where the person replies (CA-17). */
  | { kind: 'event'; event: ExternalEvent; htmlLink?: string }
  | { kind: 'deleted'; remoteId: string }
  | { kind: 'skipped'; remoteId: string; reason: 'no-start' | 'working-location' };

export interface FromGoogleOptions {
  /** The calendar's zone, for times Google sends with only an offset. */
  calendarTimeZone?: string;
}

type GoogleTime = NonNullable<GoogleEvent['start']>;
const RESPONSES: Record<string, ExternalAttendee['response']> = {
  accepted: 'accepted',
  declined: 'declined',
  tentative: 'tentative',
};
const formatters = new Map<string, Intl.DateTimeFormat | null>();

/** A cached formatter for the zone, or null when the zone isn't one this system knows. */
function formatterFor(timeZone: string): Intl.DateTimeFormat | null {
  let formatter = formatters.get(timeZone);
  if (formatter === undefined) {
    try {
      formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      formatter = null;
    }
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

function wallClock(ms: number, formatter: Intl.DateTimeFormat): string {
  const part = Object.fromEntries(formatter.formatToParts(ms).map((p) => [p.type, p.value]));
  return `${part.year}-${part.month}-${part.day}T${part.hour}:${part.minute}`;
}

function fromGoogleTime(
  time: GoogleTime | undefined,
  fallbackZone?: string,
): ExternalTime | undefined {
  if (time?.date) return { kind: 'date', date: time.date };
  if (!time?.dateTime) return undefined;
  const candidate = time.timeZone ?? fallbackZone;
  const zone = candidate && formatterFor(candidate) ? candidate : undefined;
  const local = /^(\d{4}-\d\d-\d\dT\d\d:\d\d)(:\d\d(\.\d+)?)?$/.exec(time.dateTime);
  if (local?.[1]) {
    return zone
      ? { kind: 'zoned', dateTime: local[1], timeZone: zone }
      : { kind: 'floating', dateTime: local[1] };
  }
  const ms = Date.parse(time.dateTime);
  if (Number.isNaN(ms)) return undefined;
  const formatter = zone ? formatterFor(zone) : null;
  return zone && formatter
    ? { kind: 'zoned', dateTime: wallClock(ms, formatter), timeZone: zone }
    : { kind: 'utc', instant: new Date(Math.floor(ms / 60_000) * 60_000).toISOString() };
}

/** An iCalendar DATE or DATE-TIME value from an EXDATE or RDATE line. */
function fromICalTime(
  value: string,
  tzid: string | undefined,
  isDate: boolean,
): ExternalTime | undefined {
  const m = /^(\d{4})(\d\d)(\d\d)(?:T(\d\d)(\d\d)(\d\d)(Z)?)?$/.exec(value);
  if (!m) return undefined;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  if (isDate || !m[4]) return { kind: 'date', date };
  const dateTime = `${date}T${m[4]}:${m[5]}`;
  if (m[7]) return { kind: 'utc', instant: new Date(`${dateTime}:00Z`).toISOString() };
  return tzid ? { kind: 'zoned', dateTime, timeZone: tzid } : { kind: 'floating', dateTime };
}

/** RRULE, EXDATE and RDATE lines. EXRULE and RDATE periods aren't supported and are left out. */
function fromRecurrence(lines: string[], seriesZone?: string) {
  let rrule: string | undefined;
  const dates: Record<'EXDATE' | 'RDATE', ExternalTime[]> = { EXDATE: [], RDATE: [] };
  for (const line of lines) {
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const [rawName = '', ...params] = line.slice(0, colon).split(';');
    const name = rawName.toUpperCase();
    const value = line.slice(colon + 1).trim();
    if (name === 'RRULE') rrule ??= value;
    if (name !== 'EXDATE' && name !== 'RDATE') continue;
    const tzid = params
      .find((p) => /^TZID=/i.test(p))
      ?.slice(5)
      .replaceAll('"', '');
    const isDate = params.some((p) => /^VALUE=DATE$/i.test(p));
    for (const item of value.split(',')) {
      const time = fromICalTime(item.trim(), tzid ?? seriesZone, isDate);
      if (time) dates[name].push(time);
    }
  }
  return { rrule, exdates: dates.EXDATE, rdates: dates.RDATE };
}

/** Google's page for the event, only if it really is a Google address. */
function googleLink(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    const google = host === 'google.com' || host.endsWith('.google.com');
    return url.protocol === 'https:' && google && !url.username ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

const nonEmpty = <T>(items: T[] | undefined) => (items?.length ? items : undefined);

/** Maps one event from Google. Changed and cancelled occurrences carry their series' uid. */
export function fromGoogleEvent(
  g: GoogleEvent,
  options: FromGoogleOptions = {},
): MappedGoogleEvent {
  const uid = g.iCalUID ?? `${g.recurringEventId ?? g.id}@google.com`;
  const zone = g.start?.timeZone ?? options.calendarTimeZone;
  const recurrenceId = fromGoogleTime(g.originalStartTime, zone);
  if (g.status === 'cancelled') {
    // A deleted event or series, or one occurrence taken out of a series.
    if (!g.recurringEventId || !recurrenceId) return { kind: 'deleted', remoteId: g.id };
    const event = { uid, remoteId: g.id, etag: g.etag, recurrenceId, start: recurrenceId };
    return {
      kind: 'event',
      event: compact({ ...event, status: 'cancelled', title: '', busy: false }),
    };
  }
  if (g.eventType === 'workingLocation')
    return { kind: 'skipped', remoteId: g.id, reason: 'working-location' };
  const start = fromGoogleTime(g.start, options.calendarTimeZone);
  if (!start) return { kind: 'skipped', remoteId: g.id, reason: 'no-start' };
  const series =
    g.recurrence && !g.recurringEventId ? fromRecurrence(g.recurrence, zone) : undefined;
  const attendees: ExternalAttendee[] = (g.attendees ?? []).flatMap((a) =>
    a.email && !a.resource
      ? [
          compact({
            email: a.email,
            name: a.displayName,
            response: RESPONSES[a.responseStatus ?? ''] ?? 'needs-action',
            organizer: a.organizer || undefined,
            self: a.self || undefined,
          }),
        ]
      : [],
  );
  const conference = (g.conferenceData?.entryPoints ?? []).flatMap((entry) =>
    entry.entryPointType === 'video' && entry.uri ? [entry.uri] : [],
  );
  if (g.hangoutLink) conference.push(g.hangoutLink);
  const video = findVideoLink({ conference, location: g.location, description: g.description });
  const event: ExternalEvent = compact({
    uid,
    remoteId: g.id,
    etag: g.etag,
    recurrenceId,
    status: g.status === 'tentative' ? 'tentative' : 'confirmed',
    title: g.summary ?? '',
    description: g.description || undefined,
    location: g.location || undefined,
    videoLink: video?.url,
    start,
    end: g.endTimeUnspecified ? undefined : fromGoogleTime(g.end, options.calendarTimeZone),
    rrule: series?.rrule,
    exdates: nonEmpty(series?.exdates),
    rdates: nonEmpty(series?.rdates),
    sequence: g.sequence,
    updatedAt:
      g.updated && !Number.isNaN(Date.parse(g.updated))
        ? new Date(g.updated).toISOString()
        : undefined,
    busy: g.transparency !== 'transparent',
    visibility:
      g.visibility === 'private' || g.visibility === 'confidential'
        ? 'private'
        : g.visibility === 'public' || g.visibility === 'default'
          ? g.visibility
          : undefined,
    organizerEmail: g.organizer?.email,
    attendees: nonEmpty(attendees),
  });
  const htmlLink = googleLink(g.htmlLink);
  return htmlLink ? { kind: 'event', event, htmlLink } : { kind: 'event', event };
}
