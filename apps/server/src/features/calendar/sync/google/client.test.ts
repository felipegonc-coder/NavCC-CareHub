import { describe, expect, it } from 'vitest';
import {
  type CalendarTransport,
  GoogleCalendarError,
  accountEmail,
  createGoogleCalendarClient,
  directTransport,
} from './client';
import { TransportError } from './http';
import { createMockGoogle, googleErrorBody } from './mock-google';
import { createGoogleOAuth, googleRedirectUri } from './oauth';

const WINDOW = { timeMin: '2026-04-27T00:00:00Z', timeMax: '2027-10-27T00:00:00Z' };
const AVERY = 'avery.lin@example.com';
const SCOPE = 'https://www.googleapis.com/auth/';

const timed = (summary: string, start: string, end: string) => ({
  summary,
  start: { dateTime: start, timeZone: 'America/New_York' },
  end: { dateTime: end, timeZone: 'America/New_York' },
});

function setup(options: { maxPageSize?: number; scopes?: string[]; signal?: AbortSignal } = {}) {
  const google = createMockGoogle(options.maxPageSize ? { maxPageSize: options.maxPageSize } : {});
  const sleeps: number[] = [];
  const accessToken = google.issueAccessToken(options.scopes);
  const client = createGoogleCalendarClient({
    transport: directTransport({ fetch: google.fetch, accessToken }),
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    random: () => 0.5,
    now: () => google.now().getTime(),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const calendarCalls = () => google.requests.filter((r) => r.url.host === 'www.googleapis.com');
  return { google, client, sleeps, calendarCalls };
}

async function failure(promise: Promise<unknown>): Promise<GoogleCalendarError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof GoogleCalendarError) return error;
    throw error;
  }
  throw new Error('Expected a GoogleCalendarError');
}

describe('calendar list', () => {
  it('lists calendars the person can read, with the names they see in Google', async () => {
    const { google, client, calendarCalls } = setup();
    google.addCalendar({
      summary: 'Lin household',
      summaryOverride: 'Family',
      accessRole: 'writer',
    });
    google.addCalendar({ summary: 'Holidays', accessRole: 'reader', timeZone: 'America/Denver' });
    google.addCalendar({ summary: 'Busy times', accessRole: 'freeBusyReader' });
    const calendars = await client.listCalendars();
    expect(calendars.map(({ name, primary }) => ({ name, primary }))).toEqual([
      { name: AVERY, primary: true },
      { name: 'Family', primary: false },
      { name: 'Holidays', primary: false },
    ]);
    expect(calendars[2]).toMatchObject({ timeZone: 'America/Denver' });
    expect(accountEmail(calendars)).toBe(AVERY);
    expect(calendarCalls()[0]?.url.searchParams.get('minAccessRole')).toBe('reader');
    expect(calendarCalls()[0]?.headers.authorization).toMatch(/^Bearer mock-access-/);
  });

  it('follows pages', async () => {
    const { google, client, calendarCalls } = setup({ maxPageSize: 2 });
    for (const name of ['Rota', 'Clinic', 'School', 'Choir']) google.addCalendar({ summary: name });
    expect(await client.listCalendars()).toHaveLength(5);
    expect(calendarCalls()).toHaveLength(3);
  });
});

describe('event changes', () => {
  it('first sync gets everything in the window, page by page, with a sync token', async () => {
    const { google, client, calendarCalls } = setup({ maxPageSize: 2 });
    google.addEvent(AVERY, timed('Physio', '2026-11-03T09:00:00', '2026-11-03T10:00:00'));
    google.addEvent(AVERY, timed('Pharmacy', '2026-11-04T09:00:00', '2026-11-04T09:30:00'));
    google.addEvent(AVERY, {
      summary: 'Respite week',
      start: { date: '2026-12-21' },
      end: { date: '2026-12-28' },
    });
    google.addEvent(AVERY, timed('Long ago', '2025-01-10T09:00:00', '2025-01-10T10:00:00'));
    const changes = await client.listEventChanges({ calendarId: AVERY, window: WINDOW });
    expect(changes).toMatchObject({ full: true, resynced: false, timeZone: 'America/New_York' });
    expect(changes.events.map((event) => event.summary)).toEqual([
      'Physio',
      'Pharmacy',
      'Respite week',
    ]);
    expect(changes.events[0]?.htmlLink).toMatch(
      /^https:\/\/www\.google\.com\/calendar\/event\?eid=/,
    );
    expect(changes.nextSyncToken).toBeTruthy();
    const [first, second] = calendarCalls();
    expect(Object.fromEntries(first?.url.searchParams ?? [])).toEqual({
      ...WINDOW,
      showDeleted: 'true',
      maxResults: '1000',
    });
    expect(second?.url.searchParams.get('pageToken')).toBeTruthy();
  });

  it('next sync gets only what changed, deletions included, with the sync token alone', async () => {
    const { google, client, calendarCalls } = setup();
    const physio = google.addEvent(
      AVERY,
      timed('Physio', '2026-11-03T09:00:00', '2026-11-03T10:00:00'),
    );
    const pharmacy = google.addEvent(
      AVERY,
      timed('Pharmacy', '2026-11-04T09:00:00', '2026-11-04T09:30:00'),
    );
    google.addEvent(AVERY, timed('Dentist', '2026-11-05T09:00:00', '2026-11-05T10:00:00'));
    const first = await client.listEventChanges({ calendarId: AVERY, window: WINDOW });
    google.editEvent(AVERY, String(physio.id), { summary: 'Physio with Sam Ortiz' });
    google.removeEvent(AVERY, String(pharmacy.id));
    google.addEvent(AVERY, timed('Haircut', '2026-11-06T09:00:00', '2026-11-06T10:00:00'));
    const next = await client.listEventChanges({
      calendarId: AVERY,
      syncToken: first.nextSyncToken,
      window: WINDOW,
    });
    expect(next.full).toBe(false);
    expect(next.events.map(({ summary, status }) => ({ summary, status }))).toEqual([
      { summary: 'Physio with Sam Ortiz', status: 'confirmed' },
      { status: 'cancelled' },
      { summary: 'Haircut', status: 'confirmed' },
    ]);
    const query = calendarCalls().at(-1)?.url.searchParams;
    expect(query?.get('syncToken')).toBe(first.nextSyncToken);
    expect(query?.has('timeMin')).toBe(false);
    expect(next.nextSyncToken).not.toBe(first.nextSyncToken);
  });

  it('starts over with a full sync when Google drops the sync token', async () => {
    const { google, client, calendarCalls } = setup();
    google.addEvent(AVERY, timed('Physio', '2026-11-03T09:00:00', '2026-11-03T10:00:00'));
    const first = await client.listEventChanges({ calendarId: AVERY, window: WINDOW });
    google.expireSyncTokens();
    const next = await client.listEventChanges({
      calendarId: AVERY,
      syncToken: first.nextSyncToken,
      window: WINDOW,
    });
    expect(next).toMatchObject({ full: true, resynced: true });
    expect(next.events).toHaveLength(1);
    expect(calendarCalls()).toHaveLength(3);
  });

  it('skips items it cannot read, and says which', async () => {
    const transport: CalendarTransport = async () => ({
      status: 200,
      body: {
        items: [
          {
            id: 'good1',
            status: 'confirmed',
            start: { date: '2026-11-03' },
            end: { date: '2026-11-04' },
          },
          { summary: 'No id' },
          { id: 'bad2', start: 'tomorrow' },
        ],
        nextSyncToken: 'token-1',
      },
    });
    const client = createGoogleCalendarClient({ transport });
    const changes = await client.listEventChanges({ calendarId: AVERY, window: WINDOW });
    expect(changes.events.map((event) => event.id)).toEqual(['good1']);
    expect(changes.skipped.map((item) => item.id)).toEqual([undefined, 'bad2']);
    expect(changes.nextSyncToken).toBe('token-1');
  });
});

describe('read-only', () => {
  it('only ever reads from Google', async () => {
    const { google, client } = setup();
    google.addEvent(AVERY, timed('Physio', '2026-11-03T09:00:00', '2026-11-03T10:00:00'));
    const first = await client.listEventChanges({ calendarId: AVERY, window: WINDOW });
    await client.listEventChanges({
      calendarId: AVERY,
      syncToken: first.nextSyncToken,
      window: WINDOW,
    });
    await client.listCalendars();
    expect(google.requests.map((request) => request.method)).toEqual(['GET', 'GET', 'GET']);
    expect(google.requests.every((request) => request.body === '')).toBe(true);
  });

  it('does not retry a read Google refuses', async () => {
    const { client, sleeps, calendarCalls } = setup();
    const error = await failure(
      client.listEventChanges({ calendarId: 'gone@group.calendar.example.com', window: WINDOW }),
    );
    expect(error).toMatchObject({ kind: 'not-found', status: 404, reason: 'notFound' });
    expect(error.retryable).toBe(false);
    expect(calendarCalls()).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });
});

describe('retries', () => {
  it('waits as long as Google asks on 429', async () => {
    const { google, client, sleeps } = setup();
    google.fail({ status: 429, reason: 'rateLimitExceeded', retryAfter: '2' });
    expect(await client.listCalendars()).toHaveLength(1);
    expect(sleeps).toEqual([2000]);
  });

  it('backs off on 403 rate limits, Google errors and network failures', async () => {
    const { google, client, sleeps } = setup();
    google.fail({ status: 403, reason: 'userRateLimitExceeded' });
    google.fail({ status: 503 });
    google.fail({ network: true });
    expect(await client.listCalendars()).toHaveLength(1);
    expect(sleeps).toEqual([1500, 2500, 4500]);
  });

  it('gives up after five tries', async () => {
    const { google, client, sleeps, calendarCalls } = setup();
    google.fail({ status: 500, times: 5 });
    const error = await failure(client.listCalendars());
    expect(error).toMatchObject({ kind: 'unavailable', status: 500 });
    expect(error.retryable).toBe(true);
    expect(calendarCalls()).toHaveLength(5);
    expect(sleeps).toEqual([1500, 2500, 4500, 8500]);
  });

  it('stops when Google asks for a long wait, so the job can come back later', async () => {
    const { google, client, sleeps } = setup();
    google.fail({ status: 429, retryAfter: '120' });
    const error = await failure(client.listCalendars());
    expect(error).toMatchObject({ kind: 'rate-limited', retryAfterMs: 120_000 });
    expect(sleeps).toEqual([]);
  });

  it('stops when the run is cancelled', async () => {
    const controller = new AbortController();
    const google = createMockGoogle();
    google.fail({ status: 503 });
    const client = createGoogleCalendarClient({
      transport: directTransport({ fetch: google.fetch, accessToken: google.issueAccessToken() }),
      signal: controller.signal,
      sleep: async (_ms, signal) => {
        controller.abort();
        signal?.throwIfAborted();
      },
    });
    await expect(client.listCalendars()).rejects.toThrow(/abort/i);
    expect(google.requests).toHaveLength(1);
  });

  it('says plainly when the API is off, the sign-in has expired or a scope is missing', async () => {
    const { google, client } = setup();
    const off = googleErrorBody(
      403,
      'accessNotConfigured',
      'Calendar API has not been used in project 1',
    );
    google.fail({ status: 403, body: off });
    const notOn = await failure(client.listCalendars());
    expect(notOn.kind).toBe('not-configured');
    expect(notOn.message).toBe(
      "The Google Calendar API isn't turned on for Care Hub's Google client.",
    );
    google.advance(3_600_000);
    expect(await failure(client.listCalendars())).toMatchObject({
      kind: 'unauthorized',
      message: 'Google needs you to sign in again.',
    });
    const listOnly = setup({ scopes: [`${SCOPE}calendar.calendarlist.readonly`] });
    const error = await failure(
      listOnly.client.listEventChanges({ calendarId: AVERY, window: WINDOW }),
    );
    expect(error).toMatchObject({ kind: 'forbidden', reason: 'insufficientPermissions' });
  });
});

describe('limits', () => {
  const hang = (_url: string, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
    });

  it('tries a slow call again, and says so plainly when Google never answers', async () => {
    const google = createMockGoogle();
    const sleeps: number[] = [];
    let calls = 0;
    const client = createGoogleCalendarClient({
      transport: directTransport({
        fetch: (url, init) => (calls++ === 0 ? hang(url, init) : google.fetch(url, init)),
        accessToken: google.issueAccessToken(),
        timeoutMs: 20,
      }),
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      random: () => 0.5,
    });
    expect(await client.listCalendars()).toHaveLength(1);
    expect(sleeps).toEqual([1500]);
    const stuck = createGoogleCalendarClient({
      transport: directTransport({ fetch: hang, accessToken: 'token', timeoutMs: 20 }),
      maxAttempts: 1,
    });
    const error = await stuck.listCalendars().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TransportError);
    expect(error).toMatchObject({ code: 'timeout', retryable: true });
    expect((error as Error).message).toBe("Google Calendar didn't answer in time.");
  });

  it('passes a cancel through as it is', async () => {
    const controller = new AbortController();
    const read = directTransport({ fetch: hang, accessToken: 'token' })(
      { path: '/users/me/calendarList' },
      controller.signal,
    );
    controller.abort();
    await expect(read).rejects.toThrow(/abort/i);
  });

  it('refuses a reply over 10 MB at once, without trying again', async () => {
    let calls = 0;
    const client = createGoogleCalendarClient({
      transport: directTransport({
        fetch: async () => {
          calls += 1;
          return new Response('{}', { headers: { 'content-length': String(11 * 1024 * 1024) } });
        },
        accessToken: 'token',
      }),
      sleep: async () => undefined,
    });
    const error = await client.listCalendars().catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: 'too-large', retryable: false });
    expect(calls).toBe(1);
  });
});

describe('sign-in and Calendar API together', () => {
  it('an expired access token is refused, and a refreshed one works', async () => {
    const google = createMockGoogle();
    const redirectUri = googleRedirectUri('https://carehub.example.org');
    const oauth = createGoogleOAuth(google.settings, { fetch: google.fetch, now: google.now });
    const request = oauth.createAuthorizationRequest({ redirectUri });
    if (request.kind !== 'ready') throw new Error('not ready');
    const signedIn = await oauth.exchangeCode({
      callback: google.consent(request.url),
      expectedState: request.state,
      codeVerifier: request.codeVerifier,
      redirectUri,
    });
    if (signedIn.kind !== 'connected') throw new Error(signedIn.message);
    const clientFor = (accessToken: string) =>
      createGoogleCalendarClient({
        transport: directTransport({ fetch: google.fetch, accessToken }),
      });
    expect(await clientFor(signedIn.tokens.accessToken).listCalendars()).toHaveLength(1);
    google.advance(3_600_000);
    const expired = await failure(clientFor(signedIn.tokens.accessToken).listCalendars());
    expect(expired.kind).toBe('unauthorized');
    const refreshed = await oauth.refresh(signedIn.tokens.refreshToken);
    if (refreshed.kind !== 'connected') throw new Error(refreshed.message);
    expect(await clientFor(refreshed.tokens.accessToken).listCalendars()).toHaveLength(1);
  });
});
