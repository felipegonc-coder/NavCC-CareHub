import { eq } from 'drizzle-orm';
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
  calendarSyncedEvents as syncedEvents,
} from './schema';
import {
  CONNECTION_LIMIT_MESSAGE,
  ConnectionLimitError,
  MAX_CONNECTIONS,
  createConnection,
  listConnections,
  maskAccount,
  nextLayers,
  removeConnection,
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
