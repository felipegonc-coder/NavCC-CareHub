// Reads a private calendar link for the sync engine: fetched safely, parsed, and with the
// person's own attendee marked, so the engine gets the whole feed and a cursor to pass back.

import { fetchCalendarLink } from './fetch-link';
import type { FetchLinkOptions } from './fetch-link';
import { parseCalendar } from './ical/parse';
import type { ExternalEvent } from './types';

/** Stored with the subscription (jsonb) and passed back on the next read. */
export interface LinkCursor {
  etag?: string;
  lastModified?: string;
}

export type LinkRead =
  | { status: 'not-modified'; cursor: LinkCursor }
  | {
      status: 'ok';
      events: ExternalEvent[]; // the whole feed; key: uid + recurrenceId
      calendar: { name?: string; timeZone?: string };
      cursor: LinkCursor;
      complete: boolean; // false when the feed was cut off: save what came, delete nothing
      warnings: string[];
    };

export interface ReadLinkOptions extends Pick<
  FetchLinkOptions,
  'signal' | 'allowLocalOrigins' | 'resolve' | 'transport'
> {
  ownAddresses?: readonly string[]; // the person's emails; their attendee gets `self: true`
  window?: { start: Date; end: Date }; // leaves out events that can't touch it
  now?: Date;
}

/** Throws FetchLinkError (safe to show, never contains the link) or IcalParseError. */
export async function readCalendarLink(
  link: string,
  cursor: LinkCursor | undefined,
  options: ReadLinkOptions = {},
): Promise<LinkRead> {
  const { window, now, ownAddresses = [], ...fetchOptions } = options;
  const previous = validators(cursor ?? {});
  const result = await fetchCalendarLink(link, { ...fetchOptions, ...previous });
  if (result.status === 'not-modified') {
    return { status: 'not-modified', cursor: { ...previous, ...validators(result) } };
  }
  const parsed = parseCalendar(result.body, { charset: result.charset, window, now });
  const own = new Set(ownAddresses.map((address) => address.trim().toLowerCase()));
  const events = parsed.events.map((event) =>
    own.size > 0 && event.attendees
      ? { ...event, attendees: event.attendees.map((a) => markSelf(a, own)) }
      : event,
  );
  // A feed that stops before END:VCALENDAR was cut off on the way.
  const tail = Buffer.from(result.body.subarray(-64)).toString('latin1');
  const closed = /END:VCALENDAR\s*$/i.test(tail);
  const { name, timeZone } = parsed.calendar;
  return {
    status: 'ok',
    events,
    calendar: { ...(name ? { name } : {}), ...(timeZone ? { timeZone } : {}) },
    cursor: validators(result),
    complete: closed && !parsed.truncated,
    warnings: parsed.warnings,
  };
}

function markSelf<T extends { email: string; self?: boolean }>(a: T, own: ReadonlySet<string>): T {
  return own.has(a.email.toLowerCase()) ? { ...a, self: true } : a;
}

/** Only string validators survive, so a stored cursor can't smuggle in other options. */
function validators(source: LinkCursor): LinkCursor {
  const out: LinkCursor = {};
  if (typeof source.etag === 'string' && source.etag) out.etag = source.etag;
  if (typeof source.lastModified === 'string' && source.lastModified) {
    out.lastModified = source.lastModified;
  }
  return out;
}
