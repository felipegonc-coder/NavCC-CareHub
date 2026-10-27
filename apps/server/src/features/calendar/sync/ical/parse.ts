// Reads iCalendar files (RFC 5545, with RFC 7986 additions) into ExternalEvents. A broken
// event is skipped with a warning; only input that isn't a calendar at all, or is too large,
// fails as a whole.

import { createHash } from 'node:crypto';
import type { ExternalAttendee, ExternalEvent, ExternalTime } from '../types';
import { findVideoLink } from '../video-link';
import { logicalLines, parseContentLine, readComponents, unescapeText, unfoldBytes } from './text';
import type { Component, ContentLine } from './text';
import {
  civilToMs,
  DAY_MS,
  formatDate,
  formatDateTime,
  formatInstant,
  msToCivil,
  parseCivil,
  parseDuration,
  parseIcalDateTime,
} from './values';
import type { Duration, IcalDateTime } from './values';
import { customWallToUtc, matchIanaZone, readVTimezone } from './vtimezone';
import type { CustomZone } from './vtimezone';
import { msToZoned, zonedToMs, zoneFromTzid } from './zones';

export const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
export const DEFAULT_MAX_EVENTS = 5000; // the spec's limit per calendar within the date window
const MAX_LIST = 1000; // attendees, RDATEs or EXDATEs kept per event
const MAX_WARNINGS = 50;
const MAX_CUSTOM_ZONES = 20; // custom VTIMEZONEs read per file
const MAX_LINES = 400_000; // content lines per file: about 40 MB of a typical calendar

export interface ParseOptions {
  maxBytes?: number;
  maxEvents?: number;
  /** Keeps only events that may touch this window; series are kept unless clearly outside. */
  window?: { start: Date; end: Date };
  /** Custom VTIMEZONEs are matched to IANA zones around this time. Defaults to now. */
  now?: Date;
  /** Charset of byte input, from the Content-Type header. UTF-8 by default. */
  charset?: string;
}

export interface CalendarInfo {
  name?: string;
  description?: string;
  color?: string;
  timeZone?: string; // X-WR-TIMEZONE, a hint for floating times
  method?: string;
}

export interface ParseResult {
  events: ExternalEvent[];
  calendar: CalendarInfo;
  skipped: number; // broken events left out
  truncated: boolean; // more than maxEvents or MAX_LINES; the rest were left out
  warnings: string[];
}

/** `too-complex`: the worker ran out of time or memory (see parse-in-worker.ts). */
export type IcalParseErrorCode = 'too-large' | 'not-calendar' | 'too-complex';

export class IcalParseError extends Error {
  readonly code: IcalParseErrorCode;
  constructor(code: IcalParseErrorCode, message: string) {
    super(message);
    this.name = 'IcalParseError';
    this.code = code;
  }
}

type Zone =
  { kind: 'iana'; zone: string } | { kind: 'custom'; custom: CustomZone } | { kind: 'unknown' };

interface Context {
  zone: (tzid: string) => Zone;
  warn: (message: string) => void;
  hasMethod: boolean;
}

/** Reads a calendar. Throws IcalParseError only when the input is too large or not iCalendar. */
export function parseCalendar(input: string | Uint8Array, options: ParseOptions = {}): ParseResult {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const size = typeof input === 'string' ? Buffer.byteLength(input, 'utf8') : input.length;
  if (size > maxBytes) {
    throw new IcalParseError('too-large', `The calendar is larger than ${maxBytes} bytes.`);
  }
  const text = typeof input === 'string' ? input.replace(/^\uFEFF/, '') : decode(input, options);
  const warnings: string[] = [];
  const warn = (message: string) => void (warnings.length < MAX_WARNINGS && warnings.push(message));
  // Lines are parsed as the tree is built, so lines that end up dropped are never kept.
  let cut = false;
  const lines = function* (): Generator<ContentLine> {
    let count = 0;
    for (const { text: raw, line } of logicalLines(text)) {
      if (++count > MAX_LINES) {
        cut = true;
        warn(`The calendar has more than ${MAX_LINES} lines; the rest was left out.`);
        return;
      }
      const parsed = parseContentLine(raw, line);
      if (parsed) yield parsed;
      else warn(`Line ${line} isn't a valid iCalendar line and was ignored.`);
    }
  };
  const roots = readComponents(lines());
  const calendars = roots.filter((c) => c.name === 'VCALENDAR');
  const loose = roots.filter((c) => c.name === 'VEVENT');
  if (loose.length > 0) calendars.push({ name: 'VCALENDAR', props: [], children: loose });
  if (calendars.length === 0)
    throw new IcalParseError('not-calendar', "This isn't an iCalendar file.");

  const now = options.now?.getTime() ?? Date.now();
  const window = options.window && {
    start: options.window.start.getTime() - DAY_MS,
    end: options.window.end.getTime() + DAY_MS,
  };
  const maxEvents = options.maxEvents ?? DEFAULT_MAX_EVENTS;
  const kept = new Map<string, ExternalEvent>();
  let skipped = 0;
  let truncated = false;
  let customZones = 0;
  for (const calendar of calendars) {
    const vtimezones = new Map<string, Component>();
    for (const child of calendar.children) {
      const tzid = child.name === 'VTIMEZONE' && first(child, 'TZID')?.value.trim();
      if (tzid) vtimezones.set(tzid, child);
    }
    const zones = new Map<string, Zone>();
    const zone = (tzid: string): Zone => {
      let found = zones.get(tzid);
      if (!found) {
        const vtimezone = vtimezones.get(tzid.trim());
        found = resolveZone(
          tzid,
          vtimezone && customZones++ < MAX_CUSTOM_ZONES ? vtimezone : undefined,
        );
        zones.set(tzid, found);
      }
      return found;
    };
    const resolveZone = (tzid: string, vtimezone: Component | undefined): Zone => {
      const named = zoneFromTzid(tzid);
      if (named) return { kind: 'iana', zone: named };
      const custom = vtimezone && readVTimezone(vtimezone);
      const label = JSON.stringify(tzid.slice(0, 60));
      if (custom) {
        const matched = custom.location ?? matchIanaZone(custom, now);
        if (matched) return { kind: 'iana', zone: matched };
        warn(`Time zone ${label} matches no IANA zone; its times were converted to UTC.`);
        return { kind: 'custom', custom };
      }
      warn(`Time zone ${label} is unknown; its times were read as floating.`);
      return { kind: 'unknown' };
    };
    const ctx: Context = {
      zone,
      warn,
      hasMethod: first(calendar, 'METHOD') !== undefined,
    };
    for (const component of calendar.children) {
      if (component.name !== 'VEVENT') continue;
      const line = component.props[0]?.line ?? 0;
      let event: ExternalEvent | string;
      try {
        event = readEvent(component, ctx);
      } catch {
        event = "couldn't be read";
      }
      if (typeof event === 'string') {
        skipped++;
        warn(`The event near line ${line} ${event} and was skipped.`);
        continue;
      }
      if (window && !mayTouch(event, window)) continue;
      const key = `${event.uid}\n${event.recurrenceId ? JSON.stringify(event.recurrenceId) : ''}`;
      const previous = kept.get(key);
      if (previous) {
        warn(`The event near line ${line} repeats an earlier UID; the newer copy was kept.`);
        if (isNewer(event, previous)) kept.set(key, event);
        continue;
      }
      if (kept.size >= maxEvents) {
        truncated = true;
        break;
      }
      kept.set(key, event);
    }
    if (truncated) break;
  }
  return {
    events: [...kept.values()],
    calendar: readCalendarInfo(calendars[0]!),
    skipped,
    truncated: truncated || cut,
    warnings,
  };
}

function decode(bytes: Uint8Array, options: ParseOptions): string {
  const unfolded = unfoldBytes(bytes);
  try {
    return new TextDecoder(options.charset?.trim() || 'utf-8').decode(unfolded);
  } catch {
    return new TextDecoder('utf-8').decode(unfolded);
  }
}

const first = (c: Component, name: string) => c.props.find((p) => p.name === name);
const all = (c: Component, name: string) => c.props.filter((p) => p.name === name);
const param = (p: ContentLine | undefined, name: string) =>
  p?.params.get(name)?.join(',').trim().toUpperCase();

function readCalendarInfo(calendar: Component): CalendarInfo {
  const text = (...names: string[]) => {
    for (const name of names) {
      const value = unescapeText(first(calendar, name)?.value ?? '').trim();
      if (value) return value;
    }
    return undefined;
  };
  return compact({
    name: text('NAME', 'X-WR-CALNAME'),
    description: text('X-WR-CALDESC', 'DESCRIPTION'),
    color: text('COLOR', 'X-APPLE-CALENDAR-COLOR'),
    timeZone: zoneFromTzid(text('X-WR-TIMEZONE') ?? ''),
    method: text('METHOD')?.toUpperCase(),
  });
}

function readEvent(c: Component, ctx: Context): ExternalEvent | string {
  const text = (name: string) => {
    const value = first(c, name)?.value;
    return value === undefined ? undefined : unescapeText(value);
  };
  const startLine = first(c, 'DTSTART');
  const start = startLine && readTimes(startLine, ctx)[0];
  if (!start) return 'has no valid start time (DTSTART)';
  const recurrenceLine = first(c, 'RECURRENCE-ID');
  const recurrenceId = recurrenceLine && readTimes(recurrenceLine, ctx)[0];
  if (recurrenceLine && !recurrenceId) return 'has an unreadable RECURRENCE-ID';
  if (param(recurrenceLine, 'RANGE') === 'THISANDFUTURE') {
    ctx.warn('A RANGE=THISANDFUTURE change was read as a change to one occurrence.');
  }
  let uid = first(c, 'UID')?.value.trim();
  if (!uid) {
    const seed = [startLine.value, text('SUMMARY'), recurrenceLine?.value].join('\n');
    uid = `nouid-${createHash('sha256').update(seed).digest('hex').slice(0, 32)}`;
    ctx.warn('An event without a UID was given a UID made from its start and title.');
  }

  const rrule = first(c, 'RRULE')
    ?.value.trim()
    .replace(/^RRULE:/i, '');
  const validRule =
    rrule && /(^|;)FREQ=(SECONDLY|MINUTELY|HOURLY|DAILY|WEEKLY|MONTHLY|YEARLY)(;|$)/i.test(rrule);
  if (rrule && !validRule)
    ctx.warn(`Event ${uid} has an invalid RRULE; it was read as a single event.`);
  if (all(c, 'RRULE').length > 1)
    ctx.warn(`Event ${uid} has several RRULEs; only the first is used.`);
  if (first(c, 'EXRULE')) ctx.warn(`Event ${uid} has an EXRULE, which is ignored.`);
  const rdates = all(c, 'RDATE').flatMap((p) => readTimes(p, ctx));
  const exdates = all(c, 'EXDATE').flatMap((p) => readTimes(p, ctx));
  if (Math.max(rdates.length, exdates.length) > MAX_LIST)
    ctx.warn(`Event ${uid} has more than ${MAX_LIST} RDATEs or EXDATEs.`);

  const description = text('DESCRIPTION');
  const location = text('LOCATION');
  const conference = c.props
    .filter(
      (p) =>
        p.name === 'CONFERENCE' ||
        /^X-.*(CONFERENCE|MEETINGURL|MEETINGLINK|EXTERNALLINK)$/.test(p.name),
    )
    .sort(
      (a, b) =>
        Number(/VIDEO/.test(param(b, 'FEATURE') ?? '')) -
        Number(/VIDEO/.test(param(a, 'FEATURE') ?? '')),
    )
    .map((p) => p.value);
  const videoLink = findVideoLink({
    conference,
    url: first(c, 'URL')?.value,
    location,
    description: [description, text('X-ALT-DESC')].filter(Boolean).join('\n'),
  })?.url;

  const status = (first(c, 'STATUS')?.value.trim().toUpperCase() ?? '') as string;
  const transp = first(c, 'TRANSP')?.value.trim().toUpperCase();
  const busyStatus = first(c, 'X-MICROSOFT-CDO-BUSYSTATUS')?.value.trim().toUpperCase();
  const visibility = first(c, 'CLASS')?.value.trim().toUpperCase();
  const sequence = Number(first(c, 'SEQUENCE')?.value.trim());
  const organizerLine = first(c, 'ORGANIZER');
  const organizerEmail = organizerLine && emailOf(organizerLine);
  const attendees = all(c, 'ATTENDEE')
    .slice(0, MAX_LIST)
    .flatMap((p): ExternalAttendee[] => {
      const email = emailOf(p);
      if (!email) return [];
      const partstat = param(p, 'PARTSTAT');
      const name = p.params.get('CN')?.join(',').trim();
      return [
        compact({
          email,
          name: name || undefined,
          response:
            partstat === 'ACCEPTED'
              ? 'accepted'
              : partstat === 'DECLINED'
                ? 'declined'
                : partstat === 'TENTATIVE'
                  ? 'tentative'
                  : 'needs-action',
          organizer:
            organizerEmail && email.toLowerCase() === organizerEmail.toLowerCase()
              ? true
              : undefined,
        }),
      ];
    });
  const updated = first(c, 'LAST-MODIFIED') ?? (ctx.hasMethod ? undefined : first(c, 'DTSTAMP'));
  const updatedValue = updated && parseIcalDateTime(updated.value);

  return compact({
    uid,
    recurrenceId,
    status:
      status === 'CANCELLED' ? 'cancelled' : status === 'TENTATIVE' ? 'tentative' : 'confirmed',
    title: text('SUMMARY') ?? '',
    description: description || undefined,
    location: location || undefined,
    videoLink,
    start,
    end: readEnd(c, start, ctx),
    rrule: validRule ? rrule : undefined,
    exdates: exdates.length > 0 ? exdates.slice(0, MAX_LIST) : undefined,
    rdates: rdates.length > 0 ? rdates.slice(0, MAX_LIST) : undefined,
    sequence: Number.isInteger(sequence) && sequence >= 0 ? sequence : undefined,
    updatedAt:
      updatedValue && !updatedValue.dateOnly
        ? new Date(
            civilToMs(updatedValue.civil) + Math.min(updatedValue.seconds, 59) * 1000,
          ).toISOString()
        : undefined,
    busy: transp ? transp !== 'TRANSPARENT' : busyStatus !== 'FREE',
    visibility:
      visibility === 'PUBLIC'
        ? 'public'
        : visibility === 'PRIVATE' || visibility === 'CONFIDENTIAL'
          ? 'private'
          : undefined,
    organizerEmail,
    attendees: attendees.length > 0 ? attendees : undefined,
  } satisfies ExternalEvent);
}

/** Reads DTSTART, DTEND, RECURRENCE-ID, or a list of EXDATEs or RDATEs (a PERIOD keeps its start). */
function readTimes(line: ContentLine, ctx: Context): ExternalTime[] {
  const forceDate = param(line, 'VALUE') === 'DATE';
  const tzid = line.params.get('TZID')?.join(',');
  return line.value.split(',').flatMap((raw) => {
    const value = parseIcalDateTime(raw.split('/')[0] ?? '');
    return value ? [toExternal(value, forceDate, tzid, ctx)] : [];
  });
}

function toExternal(
  value: IcalDateTime,
  forceDate: boolean,
  tzid: string | undefined,
  ctx: Context,
): ExternalTime {
  const { civil } = value;
  if (value.dateOnly || forceDate) return { kind: 'date', date: formatDate(civil) };
  if (value.utc) return { kind: 'utc', instant: formatInstant(civilToMs(civil)) };
  const zone = tzid ? ctx.zone(tzid) : undefined;
  if (zone?.kind === 'iana')
    return {
      kind: 'zoned',
      dateTime: formatDateTime(civil),
      timeZone: zone.zone,
    };
  if (zone?.kind === 'custom') {
    return {
      kind: 'utc',
      instant: formatInstant(customWallToUtc(zone.custom, civilToMs(civil))),
    };
  }
  return { kind: 'floating', dateTime: formatDateTime(civil) };
}

/** DTEND, else DTSTART plus DURATION, else the RFC 5545 default (one day, or no length). */
function readEnd(c: Component, start: ExternalTime, ctx: Context): ExternalTime {
  const endLine = first(c, 'DTEND');
  const end = endLine && readTimes(endLine, ctx)[0];
  if (end) {
    if ((end.kind === 'date') === (start.kind === 'date') && approxMs(end) >= approxMs(start)) {
      return end;
    }
    ctx.warn('An event ends before it starts, or mixes dates and times; its end was reset.');
  }
  const duration = parseDuration(first(c, 'DURATION')?.value ?? '');
  if (!end && duration && duration.sign > 0) return addDuration(start, duration);
  return addDuration(start, {
    sign: 1,
    days: start.kind === 'date' ? 1 : 0,
    seconds: 0,
  });
}

/** Adds a duration: days are calendar days in the event's zone, hours and less are exact. */
function addDuration(start: ExternalTime, { days, seconds }: Duration): ExternalTime {
  switch (start.kind) {
    case 'date': {
      const total = Math.max(1, days + Math.ceil(seconds / 86_400));
      return {
        kind: 'date',
        date: formatDate(msToCivil(civilMs(start.date) + total * DAY_MS)),
      };
    }
    case 'utc':
      return {
        kind: 'utc',
        instant: formatInstant(Date.parse(start.instant) + days * DAY_MS + seconds * 1000),
      };
    case 'floating':
      return {
        kind: 'floating',
        dateTime: formatDateTime(
          msToCivil(civilMs(start.dateTime) + days * DAY_MS + seconds * 1000),
        ),
      };
    case 'zoned': {
      const shifted = formatDateTime(msToCivil(civilMs(start.dateTime) + days * DAY_MS));
      const instant = (zonedToMs(shifted, start.timeZone) ?? 0) + seconds * 1000;
      return {
        ...start,
        dateTime: formatDateTime(msToZoned(instant, start.timeZone)),
      };
    }
  }
}

const civilMs = (text: string) => civilToMs(parseCivil(text) ?? msToCivil(0));

/** An instant close enough for ordering and window checks (floating and dates read as UTC). */
function approxMs(time: ExternalTime): number {
  switch (time.kind) {
    case 'date':
      return civilMs(time.date);
    case 'floating':
      return civilMs(time.dateTime);
    case 'utc':
      return Date.parse(time.instant);
    case 'zoned':
      return zonedToMs(time.dateTime, time.timeZone) ?? civilMs(time.dateTime);
  }
}

/** Whether an event may touch the window (which already has a day of margin each side). */
function mayTouch(event: ExternalEvent, window: { start: number; end: number }): boolean {
  const start = approxMs(event.start);
  const end = Math.max(start, approxMs(event.end ?? event.start));
  if (event.rrule) {
    const until = /(?:^|;)UNTIL=([0-9TZ]+)/i.exec(event.rrule)?.[1];
    const untilValue = until ? parseIcalDateTime(until) : undefined;
    return (
      start < window.end && (!untilValue || civilToMs(untilValue.civil) + DAY_MS > window.start)
    );
  }
  if (start < window.end && end > window.start) return true;
  const touches = (at: number) => at < window.end && at + (end - start) > window.start;
  if (event.rdates?.some((t) => touches(approxMs(t)))) return true;
  if (!event.recurrenceId) return false;
  const original = approxMs(event.recurrenceId);
  return original < window.end && original + (end - start) > window.start;
}

function isNewer(a: ExternalEvent, b: ExternalEvent): boolean {
  if ((a.sequence ?? 0) !== (b.sequence ?? 0)) return (a.sequence ?? 0) > (b.sequence ?? 0);
  return (a.updatedAt ?? '') > (b.updatedAt ?? '');
}

/** The email of an ORGANIZER or ATTENDEE: a mailto: value, else the EMAIL parameter. */
function emailOf(line: ContentLine): string | undefined {
  const value = line.value.trim();
  let email = /^mailto:/i.test(value) ? value.slice(7) : line.params.get('EMAIL')?.[0];
  try {
    email = email && decodeURIComponent(email);
  } catch {
    // Keep the undecoded address.
  }
  email = email?.trim();
  return email && /^[^\s@]+@[^\s@]+$/.test(email) ? email : undefined;
}

/** Drops undefined properties, so results compare and serialize cleanly. */
function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}
