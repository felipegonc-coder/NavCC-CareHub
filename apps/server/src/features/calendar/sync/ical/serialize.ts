// Writes Care Hub's own events as iCalendar (RFC 5545) for its private calendar links: escaped,
// CRLF line endings, folded at 75 octets, with a VTIMEZONE built from Intl for every zone used.
// No ORGANIZER or ATTENDEE: a subscribed calendar is read-only (some apps would offer replies
// that go nowhere), and people's addresses stay out of a link that can be passed on.

import type { ExternalEvent, ExternalTime } from '../types';
import { escapeText, foldLine, formatParamValue, stripControls } from './text';
import { formatIcalDate, formatIcalDateTime, formatIcalUtc, parseCivil } from './values';
import type { Civil } from './values';
import { writeVTimezone } from './vtimezone';

/** Years of time zone rules written before and after the current one. */
const ZONE_YEARS_BEFORE = 2;
const ZONE_YEARS_AFTER = 3;

export interface SerializeOptions {
  prodId?: string;
  now?: Date; // DTSTAMP; defaults to now
}

export function serializeCalendar(
  events: readonly ExternalEvent[],
  options: SerializeOptions = {},
): string {
  const now = options.now ?? new Date();
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${clean(options.prodId ?? '-//Care Hub//Calendar//EN')}`,
    'CALSCALE:GREGORIAN',
  ];
  const zones = new Set<string>();
  for (const time of events.flatMap(timesOf)) if (time.kind === 'zoned') zones.add(time.timeZone);
  // A fixed window around now, whatever years the events are in: an event in year 1000 would
  // otherwise cost a lookup for every day since then. The last rules stay open, so later dates
  // are still right.
  const year = now.getUTCFullYear();
  for (const zone of zones) {
    lines.push(...writeVTimezone(zone, year - ZONE_YEARS_BEFORE, year + ZONE_YEARS_AFTER));
  }
  const ordered = [...events].sort((a, b) => Number(!!a.recurrenceId) - Number(!!b.recurrenceId));
  for (const event of ordered) lines.push(...writeEvent(event, now));
  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

function writeEvent(e: ExternalEvent, now: Date): string[] {
  const out = [
    'BEGIN:VEVENT',
    `UID:${clean(e.uid)}`,
    `DTSTAMP:${formatIcalUtc(now.getTime(), true)}`,
  ];
  if (e.recurrenceId) out.push(timeLine('RECURRENCE-ID', [e.recurrenceId]));
  out.push(timeLine('DTSTART', [e.start]));
  if (e.end) out.push(timeLine('DTEND', [e.end]));
  if (e.rrule) out.push(`RRULE:${clean(e.rrule.replace(/^RRULE:/i, ''))}`);
  for (const [name, times] of [
    ['RDATE', e.rdates],
    ['EXDATE', e.exdates],
  ] as const) {
    const groups = new Map<string, ExternalTime[]>();
    for (const time of times ?? []) {
      const key = time.kind === 'zoned' ? `zoned ${time.timeZone}` : time.kind;
      const group = groups.get(key);
      if (group) group.push(time);
      else groups.set(key, [time]);
    }
    for (const group of groups.values()) out.push(timeLine(name, group));
  }
  out.push(`SUMMARY:${escapeText(e.title)}`);
  if (e.description) out.push(`DESCRIPTION:${escapeText(e.description)}`);
  if (e.location) out.push(`LOCATION:${escapeText(e.location)}`);
  if (e.videoLink) out.push(`URL:${clean(e.videoLink)}`);
  out.push(`STATUS:${e.status.toUpperCase()}`, `TRANSP:${e.busy ? 'OPAQUE' : 'TRANSPARENT'}`);
  if (e.visibility === 'public' || e.visibility === 'private') {
    out.push(`CLASS:${e.visibility.toUpperCase()}`);
  }
  if (e.sequence !== undefined) out.push(`SEQUENCE:${Math.max(0, Math.floor(e.sequence))}`);
  const updated = e.updatedAt ? Date.parse(e.updatedAt) : NaN;
  if (!Number.isNaN(updated)) out.push(`LAST-MODIFIED:${formatIcalUtc(updated, true)}`);
  out.push('END:VEVENT');
  return out;
}

/** One property line for times of the same kind (and zone). */
function timeLine(name: string, times: readonly ExternalTime[]): string {
  const head = times[0];
  if (!head) throw new Error(`No value for ${name}`);
  const values = times.map((t) => {
    switch (t.kind) {
      case 'date':
        return formatIcalDate(civil(t.date));
      case 'utc':
        return formatIcalUtc(instant(t.instant));
      default:
        return formatIcalDateTime(civil(t.dateTime));
    }
  });
  const params =
    head.kind === 'date'
      ? ';VALUE=DATE'
      : head.kind === 'zoned'
        ? `;TZID=${formatParamValue(head.timeZone)}`
        : '';
  return `${name}${params}:${values.join(',')}`;
}

function timesOf(e: ExternalEvent): ExternalTime[] {
  return [
    e.start,
    ...(e.end ? [e.end] : []),
    ...(e.recurrenceId ? [e.recurrenceId] : []),
    ...(e.rdates ?? []),
    ...(e.exdates ?? []),
  ];
}

function civil(text: string): Civil {
  const value = parseCivil(text);
  if (!value) throw new Error(`Invalid date or time: ${JSON.stringify(text)}`);
  return value;
}

function instant(text: string): number {
  const ms = Date.parse(text);
  if (Number.isNaN(ms) || !text.endsWith('Z'))
    throw new Error(`Invalid instant: ${JSON.stringify(text)}`);
  return ms;
}

/** Non-TEXT values can't be escaped, so line breaks and other controls are removed. */
const clean = (value: string) => stripControls(value, false);
