// Google Calendar API v3 over plain fetch, read-only (CA-07, CA-12): the calendar list and event
// changes with sync tokens. Care Hub never changes anything in Google. A transport carries each
// request, straight to Google with an access token (later also through the Apps Script bridge).
// Retries with backoff on rate limits, Google errors and network failures.
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { type FetchLike, TransportError, parseJson, parseRetryAfter } from './http';

export const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

/** A read. `path` is under the API root, segments encoded: `/calendars/a%40example.com/events`. */
export interface CalendarRequest {
  path: string;
  query?: [string, string][];
}
export interface CalendarResponse {
  status: number;
  body: unknown;
  retryAfter?: string;
}
export type CalendarTransport = (
  request: CalendarRequest,
  signal?: AbortSignal,
) => Promise<CalendarResponse>;

/** Calls Google directly with an OAuth access token. */
export function directTransport(options: {
  fetch: FetchLike;
  accessToken: string;
  baseUrl?: string;
}): CalendarTransport {
  return async (request, signal) => {
    const query = new URLSearchParams(request.query ?? []).toString();
    const url = `${options.baseUrl ?? GOOGLE_CALENDAR_API}${request.path}${query ? `?${query}` : ''}`;
    const headers = { authorization: `Bearer ${options.accessToken}`, accept: 'application/json' };
    try {
      const response = await options.fetch(url, { method: 'GET', headers, signal });
      const text = await response.text();
      const retryAfter = response.headers.get('retry-after') ?? undefined;
      return { status: response.status, body: parseJson(text), retryAfter };
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new TransportError('network', "Couldn't reach Google Calendar.", true, {
        cause: error,
      });
    }
  };
}

const timeSchema = z.object({
  date: z.string().optional(),
  dateTime: z.string().optional(),
  timeZone: z.string().optional(),
});
const personSchema = z.object({
  email: z.string().optional(),
  displayName: z.string().optional(),
  self: z.boolean().optional(),
});
export const googleEventSchema = z.object({
  id: z.string().min(1),
  etag: z.string().optional(),
  status: z.string().optional(),
  /** The event's page in Google Calendar, where the person replies (CA-17). */
  htmlLink: z.string().optional(),
  iCalUID: z.string().optional(),
  summary: z.string().optional(),
  description: z.string().optional(),
  location: z.string().optional(),
  start: timeSchema.optional(),
  end: timeSchema.optional(),
  endTimeUnspecified: z.boolean().optional(),
  originalStartTime: timeSchema.optional(),
  recurrence: z.array(z.string()).optional(),
  recurringEventId: z.string().optional(),
  sequence: z.number().optional(),
  updated: z.string().optional(),
  transparency: z.string().optional(),
  visibility: z.string().optional(),
  hangoutLink: z.string().optional(),
  conferenceData: z
    .object({
      entryPoints: z
        .array(z.object({ entryPointType: z.string().optional(), uri: z.string().optional() }))
        .optional(),
    })
    .optional(),
  organizer: personSchema.optional(),
  attendees: z
    .array(
      personSchema.extend({
        responseStatus: z.string().optional(),
        organizer: z.boolean().optional(),
        resource: z.boolean().optional(),
      }),
    )
    .optional(),
  eventType: z.string().optional(),
});
export type GoogleEvent = z.infer<typeof googleEventSchema>;

const pageSchema = z.object({
  items: z.array(z.unknown()).optional(),
  nextPageToken: z.string().optional(),
  nextSyncToken: z.string().optional(),
  timeZone: z.string().optional(),
});
const calendarEntrySchema = z.object({
  id: z.string().min(1),
  summary: z.string().optional(),
  summaryOverride: z.string().optional(),
  timeZone: z.string().optional(),
  primary: z.boolean().optional(),
});
const googleErrorSchema = z.object({
  error: z.object({
    status: z.string().optional(),
    errors: z.array(z.object({ reason: z.string().optional() })).optional(),
    details: z.array(z.object({ reason: z.string().optional() })).optional(),
  }),
});

export interface GoogleCalendarInfo {
  id: string;
  name: string;
  timeZone?: string;
  primary: boolean;
}
export interface EventChanges {
  /** True when this is everything in the window, not just changes since the sync token. */
  full: boolean;
  /** True when Google dropped the sync token and this became a full sync. */
  resynced: boolean;
  events: GoogleEvent[];
  /** Items Google sent that Care Hub couldn't read. */
  skipped: { id?: string; problem: string }[];
  nextSyncToken?: string;
  /** The calendar's own time zone. */
  timeZone?: string;
}
export type GoogleCalendarErrorKind =
  | 'unauthorized'
  | 'forbidden'
  | 'not-configured'
  | 'not-found'
  | 'rate-limited'
  | 'unavailable'
  | 'bad-request'
  | 'unexpected';
const ERROR_MESSAGES: Record<GoogleCalendarErrorKind, string> = {
  unauthorized: 'Google needs you to sign in again.',
  forbidden: "Google Calendar didn't let Care Hub read this calendar.",
  'not-configured': "The Google Calendar API isn't turned on for Care Hub's Google client.",
  'not-found': "Google Calendar couldn't find this calendar.",
  'rate-limited': 'Google Calendar asked Care Hub to slow down. Care Hub will try again shortly.',
  unavailable: "Google Calendar isn't answering right now. Care Hub will try again shortly.",
  'bad-request': "Google Calendar didn't accept Care Hub's request.",
  unexpected: "Google Calendar sent an answer Care Hub didn't understand.",
};

export class GoogleCalendarError extends Error {
  readonly kind: GoogleCalendarErrorKind;
  readonly status: number | undefined;
  /** Google's reason, like `rateLimitExceeded` or `insufficientPermissions`. */
  readonly reason: string | undefined;
  readonly retryAfterMs: number | undefined;

  constructor(
    kind: GoogleCalendarErrorKind,
    details: { status?: number; reason?: string; retryAfterMs?: number } = {},
  ) {
    super(ERROR_MESSAGES[kind]);
    this.name = 'GoogleCalendarError';
    this.kind = kind;
    this.status = details.status;
    this.reason = details.reason;
    this.retryAfterMs = details.retryAfterMs;
  }

  get retryable(): boolean {
    return this.kind === 'rate-limited' || this.kind === 'unavailable';
  }
}

const RATE_LIMIT_REASONS = ['rateLimitExceeded', 'userRateLimitExceeded', 'RATE_LIMIT_EXCEEDED'];
const API_OFF_REASONS = ['accessNotConfigured', 'SERVICE_DISABLED'];

function reasonsOf(body: unknown): string[] {
  const parsed = googleErrorSchema.safeParse(body);
  if (!parsed.success) return [];
  const { errors = [], details = [], status } = parsed.data.error;
  return [...errors, ...details, { reason: status }].flatMap((item) => item.reason ?? []);
}

function kindOf(status: number, reasons: string[]): GoogleCalendarErrorKind {
  if (status === 401) return 'unauthorized';
  if (status === 429) return 'rate-limited';
  if (status === 403) {
    if (reasons.some((reason) => RATE_LIMIT_REASONS.includes(reason))) return 'rate-limited';
    return reasons.some((reason) => API_OFF_REASONS.includes(reason))
      ? 'not-configured'
      : 'forbidden';
  }
  if (status === 404 || status === 410) return 'not-found';
  if (status >= 500) return 'unavailable';
  return status >= 400 ? 'bad-request' : 'unexpected';
}

function errorFor(response: CalendarResponse, retryAfterMs?: number): GoogleCalendarError {
  const reasons = reasonsOf(response.body);
  const kind = kindOf(response.status, reasons);
  return new GoogleCalendarError(kind, {
    status: response.status,
    reason: reasons[0],
    retryAfterMs,
  });
}

const MAX_PAGES = 40;
const MAX_BACKOFF_MS = 32_000;
/** A longer Retry-After ends the run; the caller tries again later. */
const MAX_RETRY_AFTER_MS = 60_000;

const eventsPath = (calendarId: string) => `/calendars/${encodeURIComponent(calendarId)}/events`;
const withPage = (query: [string, string][], pageToken?: string): [string, string][] =>
  pageToken ? [...query, ['pageToken', pageToken]] : query;
const idOf = (item: unknown) =>
  typeof item === 'object' && item !== null && 'id' in item && typeof item.id === 'string'
    ? item.id
    : undefined;

export interface GoogleCalendarClientOptions {
  transport: CalendarTransport;
  signal?: AbortSignal;
  /** Tries per request, including the first. Default 5. */
  maxAttempts?: number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<unknown>;
  random?: () => number;
  now?: () => number;
}

export function createGoogleCalendarClient(options: GoogleCalendarClientOptions) {
  const { transport, signal } = options;
  const maxAttempts = options.maxAttempts ?? 5;
  const sleep =
    options.sleep ?? ((ms: number, s?: AbortSignal) => delay(ms, undefined, { signal: s }));
  const random = options.random ?? Math.random;
  const now = options.now ?? Date.now;

  /** Sends with retries. Returns any answer that isn't a rate limit or a Google-side error. */
  async function send(request: CalendarRequest): Promise<CalendarResponse> {
    for (let attempt = 1; ; attempt += 1) {
      signal?.throwIfAborted();
      let response: CalendarResponse | undefined;
      try {
        response = await transport(request, signal);
      } catch (error) {
        const retryable = error instanceof TransportError && error.retryable && !signal?.aborted;
        if (!retryable || attempt >= maxAttempts) throw error;
      }
      let retryAfterMs: number | undefined;
      if (response) {
        const kind = kindOf(response.status, reasonsOf(response.body));
        if (kind !== 'rate-limited' && kind !== 'unavailable') return response;
        retryAfterMs = parseRetryAfter(response.retryAfter, now());
        if (attempt >= maxAttempts || (retryAfterMs ?? 0) > MAX_RETRY_AFTER_MS) {
          throw errorFor(response, retryAfterMs);
        }
      }
      const backoff = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** (attempt - 1));
      await sleep(retryAfterMs ?? backoff + Math.floor(random() * 1000), signal);
    }
  }

  async function read(request: CalendarRequest): Promise<z.infer<typeof pageSchema>> {
    const response = await send(request);
    if (response.status !== 200) throw errorFor(response);
    const page = pageSchema.safeParse(response.body);
    if (!page.success) throw new GoogleCalendarError('unexpected', { status: 200 });
    return page.data;
  }

  /** Calendars the person can at least read, with names as they see them in Google. */
  async function listCalendars(): Promise<GoogleCalendarInfo[]> {
    const calendars: GoogleCalendarInfo[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const query: [string, string][] = [
        ['minAccessRole', 'reader'],
        ['maxResults', '250'],
      ];
      const body = await read({
        path: '/users/me/calendarList',
        query: withPage(query, pageToken),
      });
      for (const item of body.items ?? []) {
        const entry = calendarEntrySchema.safeParse(item);
        if (!entry.success) continue;
        const c = entry.data;
        calendars.push({
          id: c.id,
          name: c.summaryOverride ?? c.summary ?? c.id,
          ...(c.timeZone ? { timeZone: c.timeZone } : {}),
          primary: c.primary === true,
        });
      }
      pageToken = body.nextPageToken;
      if (!pageToken) return calendars;
    }
    throw new GoogleCalendarError('unexpected', { reason: 'tooManyPages' });
  }

  async function listPages(calendarId: string, base: [string, string][], full: boolean) {
    const changes: EventChanges = { full, resynced: false, events: [], skipped: [] };
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const query = withPage([...base, ['showDeleted', 'true'], ['maxResults', '2500']], pageToken);
      const body = await read({ path: eventsPath(calendarId), query });
      changes.timeZone ??= body.timeZone;
      for (const item of body.items ?? []) {
        const event = googleEventSchema.safeParse(item);
        if (event.success) changes.events.push(event.data);
        else
          changes.skipped.push({
            id: idOf(item),
            problem: event.error.issues[0]?.message ?? 'unreadable',
          });
      }
      pageToken = body.nextPageToken;
      if (!pageToken) {
        if (body.nextSyncToken) changes.nextSyncToken = body.nextSyncToken;
        return changes;
      }
    }
    throw new GoogleCalendarError('unexpected', { reason: 'tooManyPages' });
  }

  /**
   * Everything in the window (no sync token), or what changed since the sync token, including
   * deletions. When Google has dropped the token (410), starts over with a full sync once.
   */
  async function listEventChanges(input: {
    calendarId: string;
    syncToken?: string;
    /** RFC 3339 instants, like 2026-04-27T00:00:00Z. Only used for a full sync. */
    window: { timeMin: string; timeMax: string };
  }): Promise<EventChanges> {
    const window: [string, string][] = [
      ['timeMin', input.window.timeMin],
      ['timeMax', input.window.timeMax],
    ];
    if (!input.syncToken) return listPages(input.calendarId, window, true);
    try {
      return await listPages(input.calendarId, [['syncToken', input.syncToken]], false);
    } catch (error) {
      if (!(error instanceof GoogleCalendarError && error.status === 410)) throw error;
      return { ...(await listPages(input.calendarId, window, true)), resynced: true };
    }
  }

  return { listCalendars, listEventChanges };
}
export type GoogleCalendarClient = ReturnType<typeof createGoogleCalendarClient>;

/** The account's email address: Google names the primary calendar after it. */
export function accountEmail(calendars: GoogleCalendarInfo[]): string | undefined {
  return calendars.find((calendar) => calendar.primary)?.id;
}
