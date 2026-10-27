// Test support only; no production code imports this. An in-memory Google with the OAuth
// endpoints and the parts of Calendar API v3 that Care Hub uses, behind `fetch`, so tests run
// the real HTTP code. The client ID, the secret and all tokens are made up at run time.
import { createHash, randomBytes } from 'node:crypto';
import type { FetchLike } from './http';

export interface MockHttpRequest {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
}
export interface MockHttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}
export interface LoggedRequest {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body: string;
}
/** Makes the next matching request(s) fail. `path` matches part of the URL path. */
export type MockFailure = { times?: number; path?: string } & (
  { status: number; reason?: string; retryAfter?: string; body?: unknown } | { network: true }
);
type Json = Record<string, unknown>;

const token = (bytes = 24) => randomBytes(bytes).toString('base64url');
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => ({
  status,
  headers: { 'content-type': 'application/json; charset=UTF-8', ...headers },
  body: JSON.stringify(body),
});
/** Google's JSON error shape. */
export const googleErrorBody = (status: number, reason: string, message = reason) => ({
  error: { code: status, message, errors: [{ domain: 'global', reason, message }] },
});
const apiError = (status: number, reason: string, message?: string) =>
  json(status, googleErrorBody(status, reason, message));
const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
/** Google's patch rules: objects merge, arrays replace, null clears. */
function mergePatch(target: Json, patch: Json): Json {
  const out: Json = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (value === null) delete out[key];
    else if (isObject(value)) out[key] = mergePatch(isObject(out[key]) ? out[key] : {}, value);
    else out[key] = structuredClone(value);
  }
  return out;
}
const hasZone = (dateTime: string) => /(Z|[+-]\d\d:\d\d)$/.test(dateTime);
/** Roughly when a time is, for window filters (all-day and zoneless times read as UTC). */
function instant(time: unknown, fallback: number): number {
  if (!isObject(time)) return fallback;
  if (typeof time.date === 'string') return Date.parse(`${time.date}T00:00:00Z`);
  if (typeof time.dateTime !== 'string') return fallback;
  return Date.parse(hasZone(time.dateTime) ? time.dateTime : `${time.dateTime}Z`);
}
const BASE32HEX = '0123456789abcdefghijklmnopqrstuv';
const newEventId = () => [...randomBytes(26)].map((byte) => BASE32HEX.charAt(byte & 31)).join('');
const AUTH = 'https://www.googleapis.com/auth/';
/** Which scopes let a token list calendars or read events. */
const ACCEPTS = {
  list: [
    'calendar.calendarlist.readonly',
    'calendar.calendarlist',
    'calendar.readonly',
    'calendar',
  ],
  read: ['calendar.events', 'calendar.events.readonly', 'calendar.readonly', 'calendar'],
};
const RANK = { freeBusyReader: 0, reader: 1, writer: 2, owner: 3 };
export interface MockCalendar {
  id: string;
  summary: string;
  summaryOverride?: string;
  timeZone: string;
  accessRole: keyof typeof RANK;
  primary: boolean;
}

interface Grant {
  scopes: string[];
  revoked: boolean;
}

export function createMockGoogle(
  options: { account?: string; timeZone?: string; now?: string; maxPageSize?: number } = {},
) {
  const account = options.account ?? 'avery.lin@example.com';
  let clock = Date.parse(options.now ?? '2026-10-27T13:00:00Z');
  const settings = {
    GOOGLE_CLIENT_ID: `carehub-test-${randomBytes(6).toString('hex')}.apps.example.com`,
    GOOGLE_CLIENT_SECRET: token(),
  };
  const requests: LoggedRequest[] = [];
  const failures: (MockFailure & { left: number })[] = [];
  const grants: Grant[] = [];
  const codes = new Map<
    string,
    {
      grant: Grant;
      offline: boolean;
      redirectUri: string;
      challenge: string;
      method: string;
      expiresAt: number;
    }
  >();
  const refreshTokens = new Map<string, Grant>();
  const accessTokens = new Map<string, { grant: Grant; expiresAt: number }>();

  function issueTokens(grant: Grant, withRefreshToken: boolean): Json {
    const accessToken = `mock-access-${token()}`;
    accessTokens.set(accessToken, { grant, expiresAt: clock + 3_599_000 });
    const body: Json = {
      access_token: accessToken,
      expires_in: 3599,
      scope: grant.scopes.join(' '),
      token_type: 'Bearer',
    };
    if (withRefreshToken) {
      const refreshToken = `mock-refresh-${token()}`;
      refreshTokens.set(refreshToken, grant);
      body.refresh_token = refreshToken;
    }
    return body;
  }

  /** The person's choice on Google's consent screen. Returns the callback's query. */
  function consent(
    authorizationUrl: string,
    choice: { deny?: boolean; grant?: string[]; withholdRefreshToken?: boolean } = {},
  ): { code?: string; state?: string; error?: string } {
    const url = new URL(authorizationUrl);
    const params = url.searchParams;
    if (`${url.origin}${url.pathname}` !== 'https://accounts.google.com/o/oauth2/v2/auth') {
      throw new Error('Not the Google sign-in page');
    }
    if (params.get('client_id') !== settings.GOOGLE_CLIENT_ID) throw new Error('Unknown client');
    const state = params.get('state') ?? undefined;
    if (choice.deny) return { error: 'access_denied', state };
    const grant = {
      scopes: choice.grant ?? (params.get('scope') ?? '').split(' '),
      revoked: false,
    };
    grants.push(grant);
    const code = `mock-code-${token()}`;
    codes.set(code, {
      grant,
      offline: params.get('access_type') === 'offline' && !choice.withholdRefreshToken,
      redirectUri: params.get('redirect_uri') ?? '',
      challenge: params.get('code_challenge') ?? '',
      method: params.get('code_challenge_method') ?? 'plain',
      expiresAt: clock + 600_000,
    });
    return { code, state };
  }

  function tokenEndpoint(form: URLSearchParams): MockHttpResponse {
    if (
      form.get('client_id') !== settings.GOOGLE_CLIENT_ID ||
      form.get('client_secret') !== settings.GOOGLE_CLIENT_SECRET
    ) {
      return json(401, { error: 'invalid_client', error_description: 'Unauthorized' });
    }
    const grantType = form.get('grant_type');
    if (grantType === 'authorization_code') {
      const code = form.get('code') ?? '';
      const entry = codes.get(code);
      codes.delete(code); // a code works once
      if (!entry || entry.expiresAt < clock) {
        return json(400, { error: 'invalid_grant', error_description: 'Malformed auth code.' });
      }
      if (form.get('redirect_uri') !== entry.redirectUri) {
        return json(400, { error: 'redirect_uri_mismatch', error_description: 'Bad Request' });
      }
      const verifier = form.get('code_verifier') ?? '';
      const challenge =
        entry.method === 'S256'
          ? createHash('sha256').update(verifier).digest('base64url')
          : verifier;
      if (!entry.challenge || challenge !== entry.challenge) {
        return json(400, { error: 'invalid_grant', error_description: 'Invalid code verifier.' });
      }
      return json(200, issueTokens(entry.grant, entry.offline));
    }
    if (grantType === 'refresh_token') {
      const grant = refreshTokens.get(form.get('refresh_token') ?? '');
      if (!grant || grant.revoked) {
        return json(400, {
          error: 'invalid_grant',
          error_description: 'Token has been expired or revoked.',
        });
      }
      return json(200, issueTokens(grant, false));
    }
    return json(400, { error: 'unsupported_grant_type', error_description: 'Invalid grant_type' });
  }

  function revokeEndpoint(form: URLSearchParams): MockHttpResponse {
    const value = form.get('token') ?? '';
    const grant = refreshTokens.get(value) ?? accessTokens.get(value)?.grant;
    if (!grant || grant.revoked) {
      return json(400, { error: 'invalid_token', error_description: 'Token expired or revoked' });
    }
    grant.revoked = true;
    return json(200, {});
  }

  const calendars = new Map<string, MockCalendar>();
  const store = new Map<
    string,
    Map<string, { event: Json; version: number; start: number; end: number }>
  >();
  const pages = new Map<string, { key: string; items: Json[]; last: Json }>();
  let version = 0;
  let epoch = 0;
  const iso = () => new Date(clock).toISOString();
  const eventsOf = (calendarId: string) => {
    const events = store.get(calendarId);
    if (!events) throw new Error(`No calendar ${calendarId}`);
    return events;
  };

  function addCalendar(input: Partial<MockCalendar> & { summary: string }): string {
    const id = input.id ?? `${randomBytes(8).toString('hex')}@group.calendar.example.com`;
    const defaults = {
      timeZone: options.timeZone ?? 'America/New_York',
      accessRole: 'owner' as const,
    };
    calendars.set(id, { ...defaults, primary: false, ...input, id });
    store.set(id, new Map());
    return id;
  }
  addCalendar({ id: account, summary: account, primary: true });

  function save(calendarId: string, event: Json, window?: { start: number; end: number }): Json {
    version += 1;
    const saved: Json = { ...event, etag: `"${version}"`, updated: iso() };
    const series = Array.isArray(saved.recurrence) && saved.recurrence.length > 0;
    const start = instant(saved.start ?? saved.originalStartTime, -Infinity);
    const end = series ? Infinity : instant(saved.end, start);
    eventsOf(calendarId).set(String(saved.id), {
      event: saved,
      version,
      ...(window ?? { start, end }),
    });
    return structuredClone(saved);
  }

  /** Deletes like Google: a short cancelled entry stays for sync, with the series' exceptions. */
  function cancel(calendarId: string, id: string): void {
    for (const stored of [...eventsOf(calendarId).values()]) {
      const { event } = stored;
      if ((event.id !== id && event.recurringEventId !== id) || event.status === 'cancelled')
        continue;
      const kept = ['kind', 'id', 'recurringEventId', 'originalStartTime'];
      const short = Object.fromEntries(Object.entries(event).filter(([key]) => kept.includes(key)));
      save(calendarId, { ...short, status: 'cancelled' }, { start: stored.start, end: stored.end });
    }
  }

  function paginate(
    scope: string,
    query: URLSearchParams,
    compute: () => Json[],
    last: Json,
    head: Json,
  ) {
    const key = `${scope}?${[...query.entries()]
      .filter(([name]) => name !== 'pageToken')
      .map(([name, value]) => `${name}=${value}`)
      .sort()
      .join('&')}`;
    const pageToken = query.get('pageToken');
    const saved = pageToken ? pages.get(pageToken) : { key, items: compute(), last };
    if (!saved || saved.key !== key) return apiError(400, 'invalid', 'Invalid page token value.');
    const size = Math.min(Number(query.get('maxResults') ?? 250), options.maxPageSize ?? 2500);
    const rest = saved.items.slice(size);
    if (rest.length === 0)
      return json(200, { ...head, items: saved.items.slice(0, size), ...saved.last });
    const nextPageToken = `mock-page-${token(9)}`;
    pages.set(nextPageToken, { key, items: rest, last: saved.last });
    return json(200, { ...head, items: saved.items.slice(0, size), nextPageToken });
  }

  function listEvents(calendar: MockCalendar, query: URLSearchParams): MockHttpResponse {
    const syncToken = query.get('syncToken');
    let pick: (stored: { event: Json; version: number; start: number; end: number }) => boolean;
    if (syncToken && !query.has('pageToken')) {
      if (
        ['timeMin', 'timeMax', 'updatedMin', 'q', 'iCalUID', 'orderBy'].some((k) => query.has(k))
      ) {
        return apiError(400, 'invalid', 'The sync token cannot be used with other restrictions.');
      }
      const match = /^st-(\d+)-(\d+)$/.exec(syncToken);
      if (!match) return apiError(400, 'invalid', 'Invalid sync token value.');
      if (Number(match[2]) !== epoch) {
        return apiError(
          410,
          'fullSyncRequired',
          'Sync token is no longer valid, a full sync is required.',
        );
      }
      pick = (stored) => stored.version > Number(match[1]);
    } else {
      const showDeleted = query.get('showDeleted') === 'true';
      const min = query.has('timeMin') ? Date.parse(query.get('timeMin') ?? '') : -Infinity;
      const max = query.has('timeMax') ? Date.parse(query.get('timeMax') ?? '') : Infinity;
      pick = (stored) =>
        (showDeleted || stored.event.status !== 'cancelled') &&
        stored.end > min &&
        stored.start < max;
    }
    const compute = () =>
      [...eventsOf(calendar.id).values()]
        .filter(pick)
        .sort((a, b) => a.version - b.version)
        .map((stored) => structuredClone(stored.event));
    const head = {
      kind: 'calendar#events',
      summary: calendar.summary,
      timeZone: calendar.timeZone,
    };
    return paginate(
      `events:${calendar.id}`,
      query,
      compute,
      { nextSyncToken: `st-${version}-${epoch}` },
      head,
    );
  }

  function calendarApi(method: string, url: URL, headers: Record<string, string>) {
    const bearer = /^Bearer (.+)$/.exec(headers.authorization ?? '')?.[1];
    const access = bearer ? accessTokens.get(bearer) : undefined;
    if (!access || access.grant.revoked || access.expiresAt <= clock) {
      return apiError(401, 'authError', 'Request had invalid authentication credentials.');
    }
    const allowed = (need: keyof typeof ACCEPTS) =>
      access.grant.scopes.some((scope) => ACCEPTS[need].some((name) => scope === `${AUTH}${name}`));
    const denied = apiError(
      403,
      'insufficientPermissions',
      'Request had insufficient authentication scopes.',
    );
    const parts = url.pathname.slice('/calendar/v3/'.length).split('/').map(decodeURIComponent);
    if (parts.join('/') === 'users/me/calendarList' && method === 'GET') {
      if (!allowed('list')) return denied;
      const min = RANK[url.searchParams.get('minAccessRole') as keyof typeof RANK] ?? 0;
      const items = [...calendars.values()]
        .filter((calendar) => RANK[calendar.accessRole] >= min)
        .map(({ primary, ...calendar }) => ({
          kind: 'calendar#calendarListEntry',
          ...calendar,
          ...(primary ? { primary } : {}),
        }));
      return paginate(
        'calendarList',
        url.searchParams,
        () => items,
        {},
        { kind: 'calendar#calendarList' },
      );
    }
    const calendar =
      parts[0] === 'calendars' && parts[2] === 'events' ? calendars.get(parts[1] ?? '') : undefined;
    if (!calendar || parts.length !== 3) return apiError(404, 'notFound', 'Not Found');
    // Read-only access: Google refuses changes for lack of scopes.
    if (method !== 'GET' || !allowed('read')) return denied;
    return listEvents(calendar, url.searchParams);
  }

  function handle(request: MockHttpRequest): MockHttpResponse {
    const url = new URL(request.url);
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(request.headers ?? {}))
      headers[name.toLowerCase()] = value;
    const body = request.body ?? '';
    requests.push({ method: request.method, url, headers, body });
    const failure = failures.find((f) => f.left > 0 && (!f.path || url.pathname.includes(f.path)));
    if (failure) {
      failure.left -= 1;
      if ('network' in failure) throw new TypeError('fetch failed');
      const reply =
        failure.body ?? googleErrorBody(failure.status, failure.reason ?? 'backendError');
      return json(
        failure.status,
        reply,
        failure.retryAfter ? { 'retry-after': failure.retryAfter } : {},
      );
    }
    if (url.origin === 'https://oauth2.googleapis.com' && request.method === 'POST') {
      if (url.pathname === '/token') return tokenEndpoint(new URLSearchParams(body));
      if (url.pathname === '/revoke') return revokeEndpoint(new URLSearchParams(body));
    }
    if (url.origin === 'https://www.googleapis.com' && url.pathname.startsWith('/calendar/v3/')) {
      return calendarApi(request.method, url, headers);
    }
    return json(404, { error: 'not_found' });
  }

  const fetch: FetchLike = async (url, init = {}) => {
    init.signal?.throwIfAborted();
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, name) => {
      headers[name] = value;
    });
    const body = typeof init.body === 'string' ? init.body : '';
    const reply = handle({ method: init.method ?? 'GET', url, headers, body });
    const empty = [101, 204, 205, 304].includes(reply.status);
    return new Response(empty ? null : reply.body, {
      status: reply.status,
      headers: reply.headers,
    });
  };

  return {
    /** Made-up client credentials, as `readSettings` would return them. */
    settings,
    account,
    fetch,
    /** The same, synchronously, for code that can't wait (the Apps Script stand-in). */
    handle,
    requests,
    now: () => new Date(clock),
    advance(ms: number) {
      clock += ms;
    },
    fail(failure: MockFailure) {
      failures.push({ ...failure, left: failure.times ?? 1 });
    },
    consent,
    /** The person removes Care Hub from their Google Account. */
    revokeAccess() {
      for (const grant of grants) grant.revoked = true;
    },
    activeGrants: () => grants.filter((grant) => !grant.revoked).length,
    /** An access token without the sign-in steps, for Calendar API tests. */
    issueAccessToken(
      scopes: readonly string[] = [
        `${AUTH}calendar.calendarlist.readonly`,
        `${AUTH}calendar.events.readonly`,
      ],
    ) {
      const grant = { scopes: [...scopes], revoked: false };
      grants.push(grant);
      return String(issueTokens(grant, false).access_token);
    },
    addCalendar,
    /** An event made in Google Calendar itself, or an invitation that arrived there. */
    addEvent(calendarId: string, event: Json): Json {
      const id = typeof event.id === 'string' ? event.id : newEventId();
      const eid = Buffer.from(`${id} ${calendarId}`).toString('base64url');
      const base = {
        kind: 'calendar#event',
        status: 'confirmed',
        htmlLink: `https://www.google.com/calendar/event?eid=${eid}`,
        iCalUID: `${id}@google.com`,
        sequence: 0,
        created: iso(),
        organizer: { email: calendarId, self: true },
        eventType: 'default',
      };
      return save(calendarId, mergePatch(base, { ...event, id }));
    },
    /** A change made in Google Calendar itself. */
    editEvent(calendarId: string, id: string, changes: Json): Json {
      const stored = eventsOf(calendarId).get(id);
      if (!stored) throw new Error(`No event ${id}`);
      return save(calendarId, mergePatch(stored.event, changes));
    },
    removeEvent: (calendarId: string, id: string) => cancel(calendarId, id),
    event(calendarId: string, id: string): Json | undefined {
      const stored = eventsOf(calendarId).get(id);
      return stored ? structuredClone(stored.event) : undefined;
    },
    /** Google drops every sync token handed out so far (the next incremental sync gets 410). */
    expireSyncTokens() {
      epoch += 1;
    },
  };
}
export type MockGoogle = ReturnType<typeof createMockGoogle>;
