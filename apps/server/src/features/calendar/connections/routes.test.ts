import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestApp,
  createUser,
  hasDatabase,
  injectAs,
  type TestApp,
  type TestUser,
} from '../../../testing';
import { bindMemoryNotices } from '../../notices/testing';
import { type MockGoogle, createMockGoogle } from '../sync/google/mock-google';
import { GOOGLE_SCOPES } from '../sync/google/oauth';
import { listSyncedEvents } from './layers';
import connectionRoutes, { CONNECTIONS_SCREEN } from './routes';
import { calendarConnections } from './schema';

const PUBLIC_URL = 'https://carehub.example.test';
const ACCOUNT = 'avery.lin@example.com';
const hoursFromNow = (hours: number) => new Date(Date.now() + hours * 3_600_000);
type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
type Choice = Parameters<MockGoogle['consent']>[1];

describe.skipIf(!hasDatabase)('calendar connections on Postgres', () => {
  let test: TestApp;
  let google: MockGoogle;
  let family: string;
  let avery: TestUser;
  let sam: TestUser;
  let notices: ReturnType<typeof bindMemoryNotices>;

  beforeAll(async () => {
    google = createMockGoogle({ account: ACCOUNT, now: new Date().toISOString() });
    family = google.addCalendar({ summary: 'Family' });
    const env = {
      ...google.settings,
      CALENDAR_SECRET_KEY: randomBytes(32).toString('base64'),
      CAREHUB_PUBLIC_URL: PUBLIC_URL,
    };
    test = await createTestApp({
      routes: async (app) => {
        await app.register(connectionRoutes, { prefix: '/api/calendar', env, fetch: google.fetch });
        // The same routes on a server where nothing is set up.
        await app.register(connectionRoutes, { prefix: '/api/calendar-off', env: {} });
      },
    });
    notices = bindMemoryNotices();
    avery = await createUser(test.db, { name: 'Avery Lin', email: 'avery.lin@example.test' });
    sam = await createUser(test.db, { name: 'Sam Ortiz', email: 'sam.ortiz@example.test' });
  });
  afterAll(async () => {
    notices?.unbind();
    await test?.close();
  });

  const call = (user: TestUser, method: Method, url: string, payload?: object) =>
    injectAs(test.app, user, { method, url, ...(payload ? { payload } : {}) });
  const list = async (user: TestUser) =>
    (await call(user, 'GET', '/api/calendar/connections')).json().connections as {
      id: string;
      status: string;
      lastSyncedAt: string | null;
      calendars: { id: string; name: string; shown: boolean }[];
    }[];
  const start = async (user: TestUser, body: object = {}) => {
    const started = await call(user, 'POST', '/api/calendar/connections/google', body);
    expect(started.statusCode).toBe(200);
    return started.json().url as string;
  };
  /** Google's sign-in screen, then back to Care Hub: where Care Hub sends the person next. */
  async function signIn(user: TestUser, url: string, choice?: Choice) {
    const query = Object.entries(google.consent(url, choice)).filter(([, value]) => value);
    const back = await call(
      user,
      'GET',
      `/api/calendar/google/callback?${new URLSearchParams(query)}`,
    );
    expect(back.statusCode).toBe(302);
    return new URL(String(back.headers.location), PUBLIC_URL);
  }

  it('connects Google read-only, and never sends a token or a secret (CA-07, CA-11)', async () => {
    const url = new URL(await start(avery));
    expect(url.searchParams.get('scope')?.split(' ')).toEqual([...GOOGLE_SCOPES]);
    expect(url.searchParams.get('redirect_uri')).toBe(`${PUBLIC_URL}/api/calendar/google/callback`);
    const back = await signIn(avery, url.toString());
    const id = back.searchParams.get('connected');
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    const response = await call(avery, 'GET', '/api/calendar/connections');
    expect(response.json()).toMatchObject({
      connections: [
        {
          id,
          kind: 'google',
          label: 'Google Calendar',
          account: 'a…@example.com',
          status: 'ok',
          // The main calendar is chosen to start with; the person picks the rest.
          calendars: [
            { name: ACCOUNT, shown: true },
            { name: 'Family', shown: false },
          ],
        },
      ],
      unavailable: { google: null },
    });
    expect(response.body).not.toMatch(/mock-(access|refresh|code)|v1\./);
    const [row] = await test.db
      .select()
      .from(calendarConnections)
      .where(eq(calendarConnections.id, id ?? ''));
    expect(row?.secret).toMatch(/^v1\./);
    expect(row?.secret).not.toMatch(/mock-/);
    expect(await list(sam)).toEqual([]);
  });

  it('reads the calendar on Retry and on Calendar open, for its owner only', async () => {
    const [connection] = await list(avery);
    const id = connection?.id ?? '';
    google.addEvent(ACCOUNT, {
      summary: 'Team huddle',
      start: { dateTime: hoursFromNow(24).toISOString(), timeZone: 'America/Denver' },
      end: { dateTime: hoursFromNow(25).toISOString(), timeZone: 'America/Denver' },
    });
    google.addEvent(family, {
      summary: 'Dentist',
      start: { dateTime: hoursFromNow(26).toISOString() },
      end: { dateTime: hoursFromNow(27).toISOString() },
    });
    expect((await call(sam, 'POST', `/api/calendar/connections/${id}/sync`)).statusCode).toBe(404);
    const synced = await call(avery, 'POST', `/api/calendar/connections/${id}/sync`);
    expect(synced.statusCode).toBe(200);
    expect(synced.json().connection.lastSyncedAt).not.toBeNull();
    const range = { ownerId: avery.id, from: hoursFromNow(0), to: hoursFromNow(48) };
    // Only the chosen calendar is copied.
    expect((await listSyncedEvents(test.db, range)).map((row) => row.event.title)).toEqual([
      'Team huddle',
    ]);
    expect(await listSyncedEvents(test.db, { ...range, ownerId: sam.id })).toEqual([]);

    const opened = await call(avery, 'POST', '/api/calendar/connections/refresh', {});
    expect(opened.statusCode).toBe(200);
    expect(opened.json().connections).toHaveLength(1);
  });

  it('turns back sign-ins that are cancelled, someone else’s, or for another account', async () => {
    const cancelled = await signIn(avery, await start(avery), { deny: true });
    expect(cancelled.searchParams.get('problem')).toBe('cancelled');

    const url = await start(avery);
    const query = Object.entries(google.consent(url)).filter(([, value]) => value);
    const callback = `/api/calendar/google/callback?${new URLSearchParams(query)}`;
    const stolen = await call(sam, 'GET', callback);
    expect(new URL(String(stolen.headers.location), PUBLIC_URL).searchParams.get('problem')).toBe(
      'state-mismatch',
    );
    expect(await list(sam)).toEqual([]);
    const signedOut = await test.app.inject({ method: 'GET', url: callback });
    expect(String(signedOut.headers.location)).toBe(`${CONNECTIONS_SCREEN}?problem=signed-out`);
    // The state works once, for the person who started it.
    const own = await call(avery, 'GET', callback);
    expect(String(own.headers.location)).toMatch(/connected=/);
    const again = await call(avery, 'GET', callback);
    expect(String(again.headers.location)).toBe(`${CONNECTIONS_SCREEN}?problem=state-mismatch`);
    expect(await list(avery)).toHaveLength(1);
  });

  it('reconnects a connection after Google stopped accepting it (CA-12)', async () => {
    const [before] = await list(avery);
    const id = before?.id ?? '';
    await test.db
      .update(calendarConnections)
      .set({ status: 'needs-reconnect', lastError: 'Google needs you to sign in again.' })
      .where(eq(calendarConnections.id, id));
    expect(
      (await call(sam, 'POST', '/api/calendar/connections/google', { connectionId: id }))
        .statusCode,
    ).toBe(404);
    const back = await signIn(avery, await start(avery, { connectionId: id }));
    expect(back.searchParams.get('connected')).toBe(id);
    expect(await list(avery)).toMatchObject([{ id, status: 'ok', lastError: null }]);
  });

  it('removes a connection with its copies, and ends the Google sign-in', async () => {
    const [connection] = await list(avery);
    const id = connection?.id ?? '';
    expect((await call(sam, 'DELETE', `/api/calendar/connections/${id}`)).statusCode).toBe(404);
    const grants = google.activeGrants();
    expect((await call(avery, 'DELETE', `/api/calendar/connections/${id}`)).statusCode).toBe(204);
    expect(await list(avery)).toEqual([]);
    const range = { ownerId: avery.id, from: hoursFromNow(0), to: hoursFromNow(48) };
    expect(await listSyncedEvents(test.db, range)).toEqual([]);
    expect(google.activeGrants()).toBe(grants - 1);
    expect((await call(avery, 'DELETE', `/api/calendar/connections/${id}`)).statusCode).toBe(404);
    expect((await call(avery, 'DELETE', '/api/calendar/connections/nope')).statusCode).toBe(404);
  });

  it('says plainly when connecting isn’t set up on this server', async () => {
    const response = await call(avery, 'GET', '/api/calendar-off/connections');
    expect(response.json()).toEqual({
      connections: [],
      unavailable: { google: "Calendar connections aren't set up yet." },
    });
    const started = await call(avery, 'POST', '/api/calendar-off/connections/google', {});
    expect(started.statusCode).toBe(409);
    expect(started.json().error.message).toBe("Calendar connections aren't set up yet.");
  });
});
