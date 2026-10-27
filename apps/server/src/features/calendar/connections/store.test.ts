import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../../db';
import {
  type TestApp,
  type TestUser,
  createTestApp,
  createUser,
  hasDatabase,
} from '../../../testing';
import {
  calendarConnectionCalendars as calendars,
  calendarConnections as connections,
  calendarSyncedEvents as syncedEvents,
} from './schema';
import {
  CONNECTION_LIMIT_MESSAGE,
  ConnectionLimitError,
  MAX_CONNECTIONS,
  createConnection,
  findConnectionByAccount,
  isAccountConnected,
  listConnections,
  maskAccount,
  nextLayers,
  reconnectConnection,
  removeConnection,
  renameConnection,
  setCalendarShown,
} from './store';
import {
  TEST_SEALED_SECRET,
  insertTestEvent,
  testGoogleConnection,
  testLinkConnection,
} from './testing';

describe('maskAccount', () => {
  it('keeps the first letter and the domain', () => {
    expect(maskAccount('avery.lin@example.com')).toBe('a…@example.com');
    expect(maskAccount('sam')).toBe('s…');
    expect(maskAccount(null)).toBeNull();
  });
});

describe.skipIf(!hasDatabase)('calendar connections store', () => {
  let testApp: TestApp;
  let db: Db;
  let avery: TestUser;
  let sam: TestUser;

  beforeAll(async () => {
    testApp = await createTestApp();
    db = testApp.db;
    avery = await createUser(db, { name: 'Avery Lin', email: 'avery.lin@example.com' });
    sam = await createUser(db, { name: 'Sam Ortiz', email: 'sam.ortiz@example.com' });
  });

  afterAll(async () => {
    await testApp?.close();
  });

  const connectionIds = async (ownerId: string) =>
    (await listConnections(db, ownerId)).map((view) => view.id);

  it('adds a connection with its calendars and lists it without the secret', async () => {
    const input = testGoogleConnection(avery.id);
    await createConnection(db, input);

    const [view, ...others] = await listConnections(db, avery.id);
    expect(others).toEqual([]);
    expect(view).toMatchObject({
      id: input.id,
      kind: 'google',
      label: 'Google',
      account: 'a…@example.com',
      status: 'ok',
      lastError: null,
      lastSyncedAt: null,
    });
    expect(JSON.stringify(view)).not.toContain(TEST_SEALED_SECRET);
    expect(view?.calendars.map(({ name, color, shown }) => ({ name, color, shown }))).toEqual([
      { name: 'Avery Lin', color: 'blue', shown: true },
      { name: 'Family', color: 'purple', shown: false },
    ]);
    expect(await listConnections(db, sam.id)).toEqual([]);
  });

  it('gives new calendars the next colours and places, unless a colour is chosen', async () => {
    expect(await nextLayers(db, avery.id, 2)).toEqual([
      { color: 'pink', order: 102 },
      { color: 'red', order: 103 },
    ]);
    const link = testLinkConnection(avery.id, 'Soccer');
    link.calendars[0]!.color = 'green';
    await createConnection(db, link);
    const views = await listConnections(db, avery.id);
    expect(views.map((view) => view.label)).toEqual(['Google', 'Soccer']);
    expect(views[1]?.calendars).toMatchObject([{ name: 'Soccer', color: 'green' }]);
  });

  it('allows 10 connections per person, also when two are added at once', async () => {
    const jordan = await createUser(db, { name: 'Jordan Lee', email: 'jordan.lee@example.com' });
    for (let i = 1; i < MAX_CONNECTIONS; i += 1) {
      await createConnection(db, testLinkConnection(jordan.id, `Link ${i}`));
    }
    const results = await Promise.allSettled([
      createConnection(db, testLinkConnection(jordan.id, 'Tenth')),
      createConnection(db, testLinkConnection(jordan.id, 'Eleventh')),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find((result) => result.status === 'rejected');
    expect(failed?.reason).toBeInstanceOf(ConnectionLimitError);
    expect((failed?.reason as Error).message).toBe(CONNECTION_LIMIT_MESSAGE);
    expect(await listConnections(db, jordan.id)).toHaveLength(MAX_CONNECTIONS);
  });

  it('removes a connection with its calendars and copied events, for its owner only', async () => {
    const input = testGoogleConnection(sam.id, { account: 'sam.ortiz@example.com' });
    await createConnection(db, input);
    const [calendar] = await db
      .select({ id: calendars.id })
      .from(calendars)
      .where(eq(calendars.connectionId, input.id));
    await insertTestEvent(db, calendar!.id);

    expect(await removeConnection(db, avery.id, input.id)).toBeUndefined();
    expect(await connectionIds(sam.id)).toContain(input.id);

    expect(await removeConnection(db, sam.id, input.id)).toEqual({
      id: input.id,
      kind: 'google',
      account: 'sam.ortiz@example.com',
      secret: TEST_SEALED_SECRET,
    });
    expect(await connectionIds(sam.id)).not.toContain(input.id);
    const left = await db
      .select({ remoteId: syncedEvents.remoteId })
      .from(syncedEvents)
      .where(eq(syncedEvents.calendarId, calendar!.id));
    expect(left).toEqual([]);
  });

  it('refuses a secret that was not sealed', async () => {
    const input = testLinkConnection(sam.id, 'Plain');
    input.secret = 'https://calendar.example.com/private.ics';
    await expect(createConnection(db, input)).rejects.toThrow();
    expect(await connectionIds(sam.id)).not.toContain(input.id);
  });
});

describe.skipIf(!hasDatabase)('changing connections', () => {
  let testApp: TestApp;
  let db: Db;
  let avery: TestUser;
  let sam: TestUser;

  beforeAll(async () => {
    testApp = await createTestApp();
    db = testApp.db;
    avery = await createUser(db, { name: 'Avery Lin', email: 'avery.lin@example.com' });
    sam = await createUser(db, { name: 'Sam Ortiz', email: 'sam.ortiz@example.com' });
  });

  afterAll(async () => {
    await testApp?.close();
  });

  const saved = async (id: string) =>
    (await db.select().from(connections).where(eq(connections.id, id)))[0];
  const calendarsOf = (connectionId: string) =>
    db
      .select()
      .from(calendars)
      .where(eq(calendars.connectionId, connectionId))
      .orderBy(asc(calendars.name));

  it('renames and reconnects a connection, for its owner only', async () => {
    const input = testGoogleConnection(avery.id);
    await createConnection(db, input);
    expect(await renameConnection(db, sam.id, input.id, 'Not yours')).toBe(false);
    expect(await renameConnection(db, avery.id, 'not-an-id', 'Work')).toBe(false);
    expect(await renameConnection(db, avery.id, input.id, 'Work')).toBe(true);

    await db
      .update(connections)
      .set({
        status: 'needs-reconnect',
        lastError: 'Google needs you to sign in again.',
        failures: 3,
      })
      .where(eq(connections.id, input.id));
    const now = new Date('2026-10-27T16:00:00.000Z');
    const update = { secret: 'v1.new-sign-in', account: 'avery.lin@example.com' };
    expect(await reconnectConnection(db, sam.id, input.id, update, now)).toBe(false);
    expect(await reconnectConnection(db, avery.id, input.id, update, now)).toBe(true);
    expect(await saved(input.id)).toMatchObject({
      label: 'Work',
      secret: 'v1.new-sign-in',
      status: 'ok',
      lastError: null,
      failures: 0,
      nextSyncAt: now,
    });
  });

  it('hides a calendar with its copies, and reads it in full when it shows again', async () => {
    const input = testGoogleConnection(sam.id, { account: 'sam.ortiz@example.com' });
    await createConnection(db, input);
    const [own, family] = await calendarsOf(input.id);
    await insertTestEvent(db, own!.id);
    await db
      .update(calendars)
      .set({ cursor: { syncToken: 'sync-1' }, lastFullSyncAt: new Date() })
      .where(eq(calendars.id, own!.id));

    expect(await setCalendarShown(db, avery.id, own!.id, false)).toBeUndefined();
    expect(await setCalendarShown(db, sam.id, own!.id, false)).toBe(input.id);
    expect((await calendarsOf(input.id))[0]).toMatchObject({
      shown: false,
      cursor: null,
      lastFullSyncAt: null,
    });
    const left = await db.select().from(syncedEvents).where(eq(syncedEvents.calendarId, own!.id));
    expect(left).toEqual([]);

    const now = new Date('2026-10-27T16:30:00.000Z');
    expect(await setCalendarShown(db, sam.id, family!.id, true, now)).toBe(input.id);
    expect((await calendarsOf(input.id))[1]).toMatchObject({ shown: true });
    expect((await saved(input.id))?.nextSyncAt).toEqual(now);
    // Already shown: nothing changes.
    expect(await setCalendarShown(db, sam.id, family!.id, true)).toBe(input.id);
  });

  it('finds the connection for an account, whatever the case of its letters', async () => {
    const input = testGoogleConnection(avery.id, { account: 'Jordan.Lee@example.com' });
    await createConnection(db, input);
    const find = (ownerId: string, kind: 'google' | 'link', account: string) =>
      findConnectionByAccount(db, { ownerId, kind, account });
    expect(await find(avery.id, 'google', 'jordan.lee@EXAMPLE.com')).toBe(input.id);
    expect(await find(sam.id, 'google', 'jordan.lee@example.com')).toBeUndefined();
    expect(await find(avery.id, 'link', 'jordan.lee@example.com')).toBeUndefined();
    // Anyone's connection to the account keeps its Google sign-in alive.
    expect(await isAccountConnected(db, 'google', 'JORDAN.LEE@example.com')).toBe(true);
    expect(await isAccountConnected(db, 'google', 'riley.park@example.com')).toBe(false);
  });
});
