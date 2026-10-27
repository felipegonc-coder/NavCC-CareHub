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
  CONNECTED_LAYER_PREFIX,
  calendarIdOfLayer,
  connectedLayerId,
  listConnectedLayers,
  setConnectedLayer,
} from './layers';
import {
  calendarConnectionCalendars as calendars,
  calendarConnections as connections,
  calendarSyncedEvents as syncedEvents,
} from './schema';
import { createConnection } from './store';
import { insertTestEvent, testGoogleConnection } from './testing';

const CALENDAR_ID = '3f2b8c1e-5d4a-4e7b-9c6d-1a2b3c4d5e6f';

describe('connected layer ids', () => {
  it('reads the calendar id back from a layer id', () => {
    expect(connectedLayerId(CALENDAR_ID)).toBe(`connected:${CALENDAR_ID}`);
    expect(CONNECTED_LAYER_PREFIX).toBe('connected:');
    expect(calendarIdOfLayer(`connected:${CALENDAR_ID.toUpperCase()}`)).toBe(CALENDAR_ID);
    expect(calendarIdOfLayer(`team:${CALENDAR_ID}`)).toBeUndefined();
    expect(calendarIdOfLayer('connected:not-a-calendar')).toBeUndefined();
  });
});

describe.skipIf(!hasDatabase)('connected calendar layers', () => {
  let testApp: TestApp;
  let db: Db;
  let avery: TestUser;
  let sam: TestUser;
  let connectionId: string;
  let ownId: string;
  let familyId: string;

  beforeAll(async () => {
    testApp = await createTestApp();
    db = testApp.db;
    avery = await createUser(db, { name: 'Avery Lin', email: 'avery.lin@example.com' });
    sam = await createUser(db, { name: 'Sam Ortiz', email: 'sam.ortiz@example.com' });
    const input = testGoogleConnection(avery.id, { label: 'Avery at work' });
    connectionId = input.id;
    await createConnection(db, input);
    const rows = await db
      .select({ id: calendars.id })
      .from(calendars)
      .where(eq(calendars.connectionId, connectionId))
      .orderBy(asc(calendars.name));
    ownId = rows[0]!.id;
    familyId = rows[1]!.id;
  });

  afterAll(async () => {
    await testApp?.close();
  });

  it("lists the person's connected calendars as layers", async () => {
    const [own, family, ...others] = await listConnectedLayers(db, avery.id);
    expect(own).toEqual({
      id: `connected:${ownId}`,
      calendarId: ownId,
      connectionId,
      connectionLabel: 'Avery at work',
      kind: 'google',
      name: 'Avery Lin',
      color: 'blue',
      shown: true,
      status: 'ok',
      lastError: null,
      lastSyncedAt: null,
      truncated: false,
    });
    expect(family).toMatchObject({ calendarId: familyId, name: 'Family', shown: false });
    expect(others).toEqual([]);
  });

  it('shows no one else, admins included, the connected calendars', async () => {
    const admin = await createUser(db, { siteAdmin: true });
    expect(await listConnectedLayers(db, sam.id)).toEqual([]);
    expect(await listConnectedLayers(db, admin.id)).toEqual([]);
    expect(await setConnectedLayer(db, admin.id, ownId, { color: 'red' })).toBeNull();
    expect(await setConnectedLayer(db, sam.id, ownId, { shown: false })).toBeNull();
    expect(await setConnectedLayer(db, avery.id, 'not-a-calendar', { shown: false })).toBeNull();
    const [own] = await listConnectedLayers(db, avery.id);
    expect(own).toMatchObject({ color: 'blue', shown: true });
  });

  it('changes the colour', async () => {
    const layer = await setConnectedLayer(db, avery.id, ownId, { color: 'green' });
    expect(layer).toMatchObject({ id: `connected:${ownId}`, color: 'green', shown: true });
    expect(await setConnectedLayer(db, avery.id, ownId, {})).toMatchObject({ color: 'green' });
  });

  it('drops the copies when hidden and makes a sync due when shown again', async () => {
    await db
      .update(calendars)
      .set({ cursor: { syncToken: 'token-1' }, lastFullSyncAt: new Date() })
      .where(eq(calendars.id, ownId));
    await insertTestEvent(db, ownId);
    const later = new Date(Date.now() + 60 * 60_000);
    await db.update(connections).set({ nextSyncAt: later }).where(eq(connections.id, connectionId));

    expect(await setConnectedLayer(db, avery.id, ownId, { shown: false })).toMatchObject({
      shown: false,
    });
    const copies = await db.select().from(syncedEvents).where(eq(syncedEvents.calendarId, ownId));
    expect(copies).toEqual([]);
    const [hidden] = await db.select().from(calendars).where(eq(calendars.id, ownId));
    expect(hidden).toMatchObject({ cursor: null, lastFullSyncAt: null, shown: false });

    const now = new Date('2026-10-27T15:00:00.000Z');
    expect(await setConnectedLayer(db, avery.id, ownId, { shown: true }, now)).toMatchObject({
      shown: true,
    });
    const [connection] = await db
      .select({ nextSyncAt: connections.nextSyncAt })
      .from(connections)
      .where(eq(connections.id, connectionId));
    expect(connection?.nextSyncAt.toISOString()).toBe(now.toISOString());
  });
});
