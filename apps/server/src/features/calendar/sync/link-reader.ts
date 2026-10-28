// Reads a private calendar link for the sync engine. The link is fetched only through
// fetchCalendarLink (its address checks and limits) and read only through
// parseCalendarInWorker (a worker with time and memory limits). At most MAX_LINK_READS run at
// once, however many subscriptions are due; the others wait their turn.

import { fetchCalendarLink } from './fetch-link';
import type { FetchLinkOptions } from './fetch-link';
import { parseCalendarInWorker } from './ical/parse-in-worker';
import type { ParseOptions } from './ical/parse';
import { createLimit } from './limit';
import type { ExternalEvent } from './types';

export const MAX_LINK_READS = 4;
const reads = createLimit(MAX_LINK_READS);

/** Saved with the subscription and passed back on the next read. */
export interface LinkCursor {
  etag?: string;
  lastModified?: string;
}

export type LinkRead =
  | { status: 'not-modified'; cursor: LinkCursor }
  | {
      status: 'ok';
      /** The feed's events, one per UID and RECURRENCE-ID; with `window`, those that may touch it. */
      events: ExternalEvent[];
      calendar: { name?: string; timeZone?: string };
      cursor: LinkCursor;
      /**
       * False when the feed was cut off: it stopped before END:VCALENDAR, or had more events or
       * lines than the reader keeps. Then save what came and delete nothing.
       */
      complete: boolean;
      warnings: string[];
    };

export interface ReadLinkOptions extends Pick<
  FetchLinkOptions,
  'signal' | 'testOrigins' | 'resolve' | 'transport'
> {
  /** The owner's addresses: their attendee gets `self: true`. */
  ownAddresses?: readonly string[];
  /** Leaves out events that can't touch this window. */
  window?: { start: Date; end: Date };
  now?: Date;
  workerFile?: URL; // for tests
}

/**
 * Fetches and reads a link. `signal` cancels it, also while it waits its turn. Throws
 * FetchLinkError (its message is safe to show and never contains the link) or IcalParseError.
 */
export function readCalendarLink(
  link: string,
  cursor: LinkCursor | undefined,
  options: ReadLinkOptions = {},
): Promise<LinkRead> {
  return reads(() => read(link, cursor, options), options.signal);
}

async function read(
  link: string,
  cursor: LinkCursor | undefined,
  { ownAddresses, window, now, workerFile, ...fetchOptions }: ReadLinkOptions,
): Promise<LinkRead> {
  const previous = validators(cursor);
  const result = await fetchCalendarLink(link, { ...fetchOptions, ...previous });
  if (result.status === 'not-modified') {
    return { status: 'not-modified', cursor: { ...previous, ...validators(result) } };
  }
  const parseOptions: ParseOptions = { charset: result.charset, window, now, ownAddresses };
  const parsed = await parseCalendarInWorker(result.body, parseOptions, {
    signal: fetchOptions.signal,
    workerFile,
  });
  // A feed that doesn't end with END:VCALENDAR was cut off on the way.
  const tail = Buffer.from(result.body.subarray(-64)).toString('latin1');
  const { name, timeZone } = parsed.calendar;
  return {
    status: 'ok',
    events: parsed.events,
    calendar: { ...(name ? { name } : {}), ...(timeZone ? { timeZone } : {}) },
    cursor: validators(result),
    complete: /END:VCALENDAR\s*$/i.test(tail) && !parsed.truncated,
    warnings: parsed.warnings,
  };
}

/** Only non-empty string validators are kept, so a saved cursor can't carry anything else. */
function validators(source: LinkCursor | undefined): LinkCursor {
  const out: LinkCursor = {};
  const { etag, lastModified } = (source ?? {}) as Record<string, unknown>;
  if (typeof etag === 'string' && etag) out.etag = etag;
  if (typeof lastModified === 'string' && lastModified) out.lastModified = lastModified;
  return out;
}

/** The host a link reads from, to show which calendar a subscription follows without its secret. */
export function linkHost(link: string): string | undefined {
  try {
    const url = new URL(link.trim().replace(/^webcals?:\/\//i, 'https://'));
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname
      ? url.hostname
      : undefined;
  } catch {
    return undefined;
  }
}
