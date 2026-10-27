import { describe, expect, it } from 'vitest';
import type { SendNoticeInput } from '../../notices';
import { createMockGoogle } from '../sync/google/mock-google';
import {
  GOOGLE_SIGN_IN_MESSAGES,
  createGoogleOAuth,
  googleRedirectUri,
} from '../sync/google/oauth';
import type { ExternalEvent } from '../sync/types';
import { createMemorySyncStore } from './memory-sync-store';
import { type SecretBox, connectionSecretContext, sealJson, secretBoxFrom } from './secrets';
import {
  GOOGLE_EVERY_MS,
  LINK_EVERY_MS,
  type LinkReadResult,
  RECONNECT_MESSAGE,
  type ReadCalendarLink,
  createCalendarSync,
  linkEventId,
} from './sync';

const REDIRECT = googleRedirectUri('https://carehub.example.org/');
const AVERY = 'user-avery';
const LINK = 'https://school.example.org/calendars/private-3f9c.ics';
const testBox = secretBoxFrom(Buffer.alloc(32, 7).toString('base64'));
if (!testBox) throw new Error('No test key');
const box: SecretBox = testBox;

const physio = {
  summary: 'Physio with Sam Ortiz',
  start: { dateTime: '2026-10-28T10:00:00Z' },
  end: { dateTime: '2026-10-28T11:00:00Z' },
};
const call = {
  summary: 'Call with Jordan Lee',
  start: { dateTime: '2026-10-29T09:00:00Z' },
  end: { dateTime: '2026-10-29T09:30:00Z' },
};
const lesson: ExternalEvent = {
  uid: 'lesson-1@school.example.org',
  status: 'confirmed',
  title: 'Swimming lesson',
  start: { kind: 'zoned', dateTime: '2026-10-30T16:00', timeZone: 'America/New_York' },
  end: { kind: 'zoned', dateTime: '2026-10-30T17:00', timeZone: 'America/New_York' },
  busy: true,
};
const readLink = (events: ExternalEvent[], etag: string, complete = true): LinkReadResult => ({
  status: 'ok',
  events,
  cursor: { etag },
  complete,
  calendar: {},
  warnings: [],
});
const readerError = (message: string, retryable: boolean) =>
  Object.assign(new Error(message), { name: 'FetchLinkError', retryable });

function setup(options: { box?: SecretBox | undefined; withGoogle?: boolean } = { box }) {
  const google = createMockGoogle();
  const oauth = createGoogleOAuth(google.settings, { fetch: google.fetch, now: google.now });
  const memory = createMemorySyncStore();
  const notices: SendNoticeInput[] = [];
  const changes: string[][] = [];
  const reads: Parameters<ReadCalendarLink>[] = [];
  const link: { answer: () => Promise<LinkReadResult> } = {
    answer: async () => ({ status: 'not-modified' }),
  };
  const sync = createCalendarSync({
    store: memory.store,
    box: options.box,
    google: options.withGoogle === false ? undefined : oauth,
    fetch: google.fetch,
    readLink: async (...args) => {
      reads.push(args);
      return link.answer();
    },
    notify: async (input) => {
      notices.push(input);
      return { noticeId: `notice-${notices.length}`, grouped: false };
    },
    changed: (ownerId, calendarIds) => {
      changes.push([ownerId, ...calendarIds]);
    },
    now: google.now,
  });

  /** Signs in with the fake Google, as the routes do, and saves the connection. */
  async function connectGoogle(id = 'google-1') {
    const request = oauth.createAuthorizationRequest({ redirectUri: REDIRECT });
    if (request.kind !== 'ready') throw new Error(request.message);
    const outcome = await oauth.exchangeCode({
      callback: google.consent(request.url),
      expectedState: request.state,
      codeVerifier: request.codeVerifier,
      redirectUri: REDIRECT,
    });
    if (outcome.kind !== 'connected') throw new Error(outcome.message);
    const secret = sealJson(box, outcome.tokens, connectionSecretContext(id));
    memory.addConnection({ id, ownerId: AVERY, kind: 'google', account: google.account, secret });
    return id;
  }
  function addLink(id = 'link-1') {
    memory.addConnection({
      id,
      ownerId: AVERY,
      kind: 'link',
      secret: sealJson(box, { url: LINK }, connectionSecretContext(id)),
      calendars: [{ remoteId: '', name: 'School', shown: true }],
    });
    return id;
  }
  const titles = (calendarId: string) =>
    memory
      .eventsOf(calendarId)
      .map((row) => row.event.title)
      .sort();
  const shownCalendar = (connectionId: string) => {
    const calendar = memory.calendarsOf(connectionId).find((c) => c.shown);
    if (!calendar) throw new Error('No shown calendar');
    return calendar;
  };
  const calendarApi = () =>
    google.requests.filter((request) => request.url.origin === 'https://www.googleapis.com');
  const refreshes = () =>
    google.requests.filter(
      (request) =>
        request.url.pathname === '/token' &&
        new URLSearchParams(request.body).get('grant_type') === 'refresh_token',
    );

  return {
    ...{ google, memory, notices, changes, reads, link, sync, connectGoogle, addLink },
    ...{ titles, shownCalendar, calendarApi, refreshes },
  };
}

describe('Google calendar sync', () => {
  it('reads the primary calendar on the first sync and leaves the others for Settings', async () => {
    const t = setup();
    const family = t.google.addCalendar({ summary: 'Family' });
    t.google.addEvent(t.google.account, physio);
    t.google.addEvent(family, { ...call, summary: 'Dinner with Jordan Lee' });
    const id = await t.connectGoogle();

    expect(await t.sync.runDue()).toBe(1);

    const own = t.shownCalendar(id);
    const other = t.memory.calendarsOf(id).find((c) => c.remoteId === family);
    expect(own.remoteId).toBe(t.google.account);
    expect(other).toMatchObject({ name: 'Family', shown: false });
    expect(t.titles(own.id)).toEqual(['Physio with Sam Ortiz']);
    expect(t.titles(other!.id)).toEqual([]);
    const connection = t.memory.connection(id);
    expect(connection).toMatchObject({ status: 'ok', lastError: null, failures: 0 });
    expect(connection?.leaseUntil).toBeNull();
    expect(connection?.lastSyncedAt?.toISOString()).toBe('2026-10-27T13:00:00.000Z');
    expect(connection?.nextSyncAt.getTime()).toBe(Date.parse('2026-10-27T13:05:00Z'));
    expect(t.changes).toEqual([[AVERY, own.id]]);
    // Read-only: only GETs reach the Calendar API.
    expect(t.calendarApi().length).toBeGreaterThan(0);
    expect(t.calendarApi().every((request) => request.method === 'GET')).toBe(true);
    // Not due again for 5 minutes.
    expect(await t.sync.runDue()).toBe(0);
  });

  it('then reads only the changes, and tells which calendars changed', async () => {
    const t = setup();
    const first = t.google.addEvent(t.google.account, physio);
    const id = await t.connectGoogle();
    await t.sync.runDue();
    const own = t.shownCalendar(id);
    expect(typeof own.cursor?.syncToken).toBe('string');

    t.google.advance(GOOGLE_EVERY_MS);
    t.google.addEvent(t.google.account, call);
    t.google.removeEvent(t.google.account, String(first.id));
    t.changes.length = 0;
    expect(await t.sync.runDue()).toBe(1);
    const read = t.calendarApi().filter((request) => request.url.pathname.endsWith('/events'));
    expect(read.at(-1)?.url.searchParams.get('syncToken')).toBeTruthy();
    expect(t.titles(own.id)).toEqual(['Call with Jordan Lee']);
    expect(t.changes).toEqual([[AVERY, own.id]]);

    t.google.advance(GOOGLE_EVERY_MS);
    t.changes.length = 0;
    expect(await t.sync.runDue()).toBe(1);
    expect(t.changes).toEqual([]);
  });

  it('reads everything again when Google drops the sync token', async () => {
    const t = setup();
    t.google.addEvent(t.google.account, physio);
    const id = await t.connectGoogle();
    await t.sync.runDue();
    t.google.expireSyncTokens();
    t.google.addEvent(t.google.account, call);
    t.google.advance(GOOGLE_EVERY_MS);

    expect(await t.sync.runDue()).toBe(1);
    const own = t.shownCalendar(id);
    expect(t.titles(own.id)).toEqual(['Call with Jordan Lee', 'Physio with Sam Ortiz']);
    expect(own.lastFullSyncAt?.getTime()).toBe(t.google.now().getTime());
    expect(t.memory.connection(id)?.status).toBe('ok');
  });

  it('gets a new access token when the old one runs out, and keeps it sealed', async () => {
    const t = setup();
    const id = await t.connectGoogle();
    await t.sync.runDue();
    const before = t.memory.connection(id)?.secret;
    t.google.advance(2 * 3_600_000);

    expect(await t.sync.runDue()).toBe(1);
    expect(t.refreshes()).toHaveLength(1);
    const connection = t.memory.connection(id);
    expect(connection?.status).toBe('ok');
    expect(connection?.secret).not.toBe(before);
    expect(connection?.secret).not.toContain('mock-');
  });

  it('gets a new access token once when Google turns the old one down', async () => {
    const t = setup();
    const id = await t.connectGoogle();
    t.google.fail({ status: 401, reason: 'authError', path: '/calendarList' });

    expect(await t.sync.runDue()).toBe(1);
    expect(t.refreshes()).toHaveLength(1);
    expect(t.memory.connection(id)).toMatchObject({ status: 'ok', failures: 0 });
  });

  it('asks to sign in again, with one notice, when Google stops the sign-in', async () => {
    const t = setup();
    t.google.addEvent(t.google.account, physio);
    const id = await t.connectGoogle();
    await t.sync.runDue();
    const own = t.shownCalendar(id);
    t.google.revokeAccess();
    t.google.advance(2 * 3_600_000);
    t.changes.length = 0;

    expect(await t.sync.runDue()).toBe(1);
    expect(t.memory.connection(id)).toMatchObject({
      status: 'needs-reconnect',
      lastError: RECONNECT_MESSAGE,
    });
    expect(t.notices).toHaveLength(1);
    expect(t.notices[0]).toMatchObject({
      workspaceId: 'workspace-1',
      userId: AVERY,
      kind: 'alert',
      sender: 'Calendar',
      title: 'Google needs you to sign in again',
      buttons: [{ label: 'Reconnect', href: '/calendar/connections' }],
      groupKey: `calendar-connection:${id}`,
    });
    // The layer shows it, and the copies stay until the person decides.
    expect(t.changes).toEqual([[AVERY, own.id]]);
    expect(t.titles(own.id)).toEqual(['Physio with Sam Ortiz']);

    // It waits for the person: no more periodic runs and no second notice.
    t.google.advance(7 * 3_600_000);
    expect(await t.sync.runDue()).toBe(0);
    expect(await t.sync.syncNow(AVERY, id)).toBe(true);
    expect(t.memory.connection(id)?.status).toBe('needs-reconnect');
    expect(t.notices).toHaveLength(1);
  });

  it('backs off while Google is busy and shows the problem after three tries', async () => {
    const t = setup();
    const id = await t.connectGoogle();
    t.google.fail({
      status: 429,
      reason: 'rateLimitExceeded',
      retryAfter: '300',
      times: 3,
      path: '/calendarList',
    });
    const statuses: unknown[] = [];
    for (let i = 0; i < 3; i += 1) {
      const at = t.google.now().getTime();
      expect(await t.sync.runDue()).toBe(1);
      const connection = t.memory.connection(id);
      statuses.push(connection?.status);
      // Google asked for 5 minutes.
      expect(connection?.nextSyncAt.getTime()).toBe(at + 300_000);
      t.google.advance(300_000);
    }
    expect(statuses).toEqual(['ok', 'ok', 'error']);
    const failing = t.memory.connection(id);
    expect(failing?.failures).toBe(3);
    expect(failing?.lastError).toBeTruthy();

    expect(await t.sync.runDue()).toBe(1);
    expect(t.memory.connection(id)).toMatchObject({ status: 'ok', lastError: null, failures: 0 });
  });

  it("leaves new calendars out until they're chosen, and follows renames", async () => {
    const t = setup();
    const id = await t.connectGoogle();
    await t.sync.runDue();
    const rota = t.google.addCalendar({ summary: 'Rota' });
    t.google.addEvent(rota, { ...call, summary: 'Night shift' });
    t.google.advance(GOOGLE_EVERY_MS);
    await t.sync.runDue();
    const added = t.memory.calendarsOf(id).find((c) => c.remoteId === rota)!;
    expect(added.shown).toBe(false);
    expect(t.titles(added.id)).toEqual([]);

    t.memory.setShown(added.id, true);
    t.google.advance(GOOGLE_EVERY_MS);
    await t.sync.runDue();
    expect(t.titles(added.id)).toEqual(['Night shift']);

    t.google.addCalendar({ id: rota, summary: 'Care rota' });
    t.google.advance(GOOGLE_EVERY_MS);
    t.changes.length = 0;
    await t.sync.runDue();
    expect(t.memory.calendarsOf(id).find((c) => c.id === added.id)?.name).toBe('Care rota');
    expect(t.changes).toEqual([[AVERY, added.id]]);
  });

  it("keeps syncing the others when a calendar isn't shared any more", async () => {
    const t = setup();
    t.google.addEvent(t.google.account, physio);
    const id = await t.connectGoogle();
    await t.sync.runDue();
    const shared = t.google.addCalendar({ summary: 'Shared with Avery' });
    t.google.advance(GOOGLE_EVERY_MS);
    await t.sync.runDue();
    const sharedCalendar = t.memory.calendarsOf(id).find((c) => c.remoteId === shared)!;
    t.memory.setShown(sharedCalendar.id, true);
    t.google.addEvent(shared, { ...physio, summary: 'Visit from Sam Ortiz' });
    const path = `/calendars/${encodeURIComponent(shared)}/events`;
    t.google.fail({ status: 404, reason: 'notFound', path });
    t.google.addEvent(t.google.account, call);
    t.google.advance(GOOGLE_EVERY_MS);

    expect(await t.sync.runDue()).toBe(1);
    expect(t.calendarApi().some((request) => request.url.pathname.endsWith(path))).toBe(true);
    expect(t.memory.connection(id)?.status).toBe('ok');
    expect(t.titles(sharedCalendar.id)).toEqual([]);
    const own = t.memory.calendarsOf(id).find((c) => c.remoteId === t.google.account)!;
    expect(t.titles(own.id)).toEqual(['Call with Jordan Lee', 'Physio with Sam Ortiz']);
  });

  it("shows a problem when Google sign-in isn't set up", async () => {
    const t = setup({ box, withGoogle: false });
    t.memory.addConnection({ id: 'google-1', ownerId: AVERY, kind: 'google', secret: 'v1.x' });

    expect(await t.sync.runDue()).toBe(1);
    expect(t.memory.connection('google-1')).toMatchObject({
      status: 'error',
      lastError: GOOGLE_SIGN_IN_MESSAGES['missing-settings'],
    });
  });
});

describe('private link sync', () => {
  it("reads the link with where it left off and the owner's address", async () => {
    const t = setup();
    const id = t.addLink();
    const [calendar] = t.memory.calendarsOf(id);
    t.link.answer = async () => readLink([lesson], '"v1"');

    expect(await t.sync.runDue()).toBe(1);
    const [link, cursor, options] = t.reads[0]!;
    expect(link).toBe(LINK);
    expect(cursor).toBeUndefined();
    expect(options.ownAddresses).toEqual(['avery.lin@example.com']);
    expect(options.window?.start.toISOString()).toBe('2026-04-27T13:00:00.000Z');
    expect(options.window?.end.toISOString()).toBe('2027-10-27T13:00:00.000Z');
    expect(t.titles(calendar!.id)).toEqual(['Swimming lesson']);
    const connection = t.memory.connection(id);
    expect(connection?.status).toBe('ok');
    expect(connection?.nextSyncAt.getTime()).toBe(t.google.now().getTime() + LINK_EVERY_MS);

    // Unchanged since last time: nothing to write or tell.
    const fresher = { etag: '"v1"', lastModified: 'Tue, 27 Oct 2026 12:00:00 GMT' };
    t.link.answer = async () => ({ status: 'not-modified', cursor: fresher });
    t.google.advance(LINK_EVERY_MS);
    t.changes.length = 0;
    expect(await t.sync.runDue()).toBe(1);
    expect(t.reads[1]?.[1]).toEqual({ etag: '"v1"' });
    expect(t.changes).toEqual([]);
    expect(t.memory.connection(id)?.lastSyncedAt?.getTime()).toBe(t.google.now().getTime());

    // Gone from the file: gone here. The fresher validators went with the read.
    t.link.answer = async () => readLink([], '"v2"');
    t.google.advance(LINK_EVERY_MS);
    await t.sync.runDue();
    expect(t.reads[2]?.[1]).toEqual(fresher);
    expect(t.titles(calendar!.id)).toEqual([]);
    expect(t.changes).toEqual([[AVERY, calendar!.id]]);
  });

  it('keeps what it has when the reader stops early', async () => {
    const t = setup();
    const id = t.addLink();
    const [calendar] = t.memory.calendarsOf(id);
    t.link.answer = async () => readLink([lesson], '"v1"');
    await t.sync.runDue();
    const moved = { ...lesson, uid: 'lesson-2@school.example.org', title: 'Swim gala' };
    t.link.answer = async () => readLink([moved], '"v2"', false);
    t.google.advance(LINK_EVERY_MS);

    await t.sync.runDue();
    expect(t.titles(calendar!.id)).toEqual(['Swim gala', 'Swimming lesson']);
  });

  it('shows a plain message when the link fails, never the link itself', async () => {
    const t = setup();
    const id = t.addLink();
    t.link.answer = async () => {
      throw readerError(`Care Hub couldn't open ${LINK}.`, false);
    };

    expect(await t.sync.runDue()).toBe(1);
    const connection = t.memory.connection(id);
    expect(connection?.status).toBe('error');
    expect(connection?.lastError).toBeTruthy();
    expect(connection?.lastError).not.toContain('school.example.org');
    expect(connection?.nextSyncAt.getTime()).toBe(t.google.now().getTime() + LINK_EVERY_MS);

    t.link.answer = async () => {
      throw readerError('This calendar link was turned off.', false);
    };
    t.google.advance(LINK_EVERY_MS);
    await t.sync.runDue();
    expect(t.memory.connection(id)?.lastError).toBe('This calendar link was turned off.');
  });

  it('gives each changed occurrence its own id', () => {
    expect(linkEventId(lesson)).toBe('lesson-1@school.example.org');
    const recurrenceId = { kind: 'utc', instant: '2026-11-02T15:00:00Z' } as const;
    expect(linkEventId({ ...lesson, recurrenceId })).toBe(
      'lesson-1@school.example.org#2026-11-02T15:00:00Z',
    );
  });
});

describe('when calendar sync runs', () => {
  it('does nothing without CALENDAR_SECRET_KEY', async () => {
    const t = setup({ box: undefined });
    t.memory.addConnection({ id: 'link-1', ownerId: AVERY, kind: 'link', secret: 'v1.x' });

    expect(await t.sync.runDue()).toBe(0);
    expect(await t.sync.syncNow(AVERY, 'link-1')).toBe(false);
    await t.sync.refresh(AVERY, ['link-1']);
    expect(t.reads).toEqual([]);
    expect(t.memory.connection('link-1')?.leaseUntil).toBeNull();
  });

  it('"Sync now" is for the owner, and waits while another run holds the connection', async () => {
    const t = setup();
    const id = t.addLink();
    t.memory.update(id, { leaseUntil: new Date(t.google.now().getTime() + 60_000) });
    expect(await t.sync.syncNow(AVERY, id)).toBe(false);
    t.memory.update(id, { leaseUntil: null });
    expect(await t.sync.syncNow('user-sam', id)).toBe(false);
    expect(t.reads).toEqual([]);

    expect(await t.sync.syncNow(AVERY, id)).toBe(true);
    expect(t.reads).toHaveLength(1);
    expect(t.memory.connection(id)?.leaseUntil).toBeNull();
  });

  it('on Calendar open, reads only what was not read in the last minute', async () => {
    const t = setup();
    const google = await t.connectGoogle();
    const link = t.addLink();
    await t.sync.runDue();
    const calls = t.google.requests.length;

    t.google.advance(30_000);
    await t.sync.refresh(AVERY, [google, link]);
    expect(t.google.requests.length).toBe(calls);
    expect(t.reads).toHaveLength(1);

    t.google.advance(31_000);
    await t.sync.refresh('user-sam', [google, link]);
    expect(t.reads).toHaveLength(1);
    await t.sync.refresh(AVERY, [google, link]);
    expect(t.reads).toHaveLength(2);
    expect(t.google.requests.length).toBeGreaterThan(calls);

    // A calendar chosen just now makes its connection due; a sign-in that stopped working waits.
    const before = t.google.requests.length;
    t.memory.update(link, { nextSyncAt: t.google.now() });
    t.memory.update(google, { status: 'needs-reconnect', nextSyncAt: t.google.now() });
    await t.sync.refresh(AVERY, [google, link]);
    expect(t.reads).toHaveLength(3);
    expect(t.google.requests.length).toBe(before);
  });

  it('drops the outcome when the person signed in again during the run', async () => {
    const t = setup();
    const id = t.addLink();
    const resealed = sealJson(box, { url: LINK }, connectionSecretContext(id));
    t.link.answer = async () => {
      t.memory.update(id, { secret: resealed });
      throw readerError('This calendar link was turned off.', false);
    };

    expect(await t.sync.runDue()).toBe(1);
    expect(t.memory.connection(id)).toMatchObject({
      secret: resealed,
      status: 'ok',
      lastError: null,
      failures: 0,
      leaseUntil: null,
    });
  });
});
