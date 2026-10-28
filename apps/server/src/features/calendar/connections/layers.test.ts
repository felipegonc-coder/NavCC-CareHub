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
  listSyncedEvents,
  setConnectedLayer,
} from './layers';
import {
  calendarConnectionCalendars as calendars,
  calendarSyncedEvents as syncedEvents,
} from './schema';
import { createConnection } from './store';
import { insertTestEvent, testGoogleConnection, testLinkConnection } from './testing';

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

  it("lists the person's synced calendars as layers, in their order", async () => {
    const [own, ...others] = await listConnectedLayers(db, avery.id);
    expect(own).toEqual({
      id: `connected:${ownId}`,
      calendarId: ownId,
      connectionId,
      connectionLabel: 'Avery at work',
      kind: 'google',
      name: 'Avery Lin',
      color: 'blue',
      on: true,
      order: 100,
      status: 'ok',
      lastError: null,
      lastSyncedAt: null,
      truncated: false,
    });
    // Family isn't synced, so it isn't a layer.
    expect(others).toEqual([]);

    const link = testLinkConnection(avery.id, 'Soccer');
    await createConnection(db, link);
    const layers = await listConnectedLayers(db, avery.id);
    expect(layers.map(({ name, order }) => ({ name, order }))).toEqual([
      { name: 'Avery Lin', order: 100 },
      { name: 'Soccer', order: 102 },
    ]);
    const soccer = layers[1]!.calendarId;
    expect(await setConnectedLayer(db, avery.id, soccer, { order: 50 })).toMatchObject({
      name: 'Soccer',
      order: 50,
    });
    const reordered = await listConnectedLayers(db, avery.id);
    expect(reordered.map((layer) => layer.name)).toEqual(['Soccer', 'Avery Lin']);
  });

  it('shows no one else, admins included, the connected calendars', async () => {
    const admin = await createUser(db, { siteAdmin: true });
    expect(await listConnectedLayers(db, sam.id)).toEqual([]);
    expect(await listConnectedLayers(db, admin.id)).toEqual([]);
    expect(await setConnectedLayer(db, admin.id, ownId, { color: 'red' })).toBeNull();
    expect(await setConnectedLayer(db, sam.id, ownId, { on: false })).toBeNull();
    expect(await setConnectedLayer(db, avery.id, 'not-a-calendar', { on: false })).toBeNull();
    // A calendar that isn't synced isn't a layer either.
    expect(await setConnectedLayer(db, avery.id, familyId, { color: 'red' })).toBeNull();
    const [, own] = await listConnectedLayers(db, avery.id);
    expect(own).toMatchObject({ calendarId: ownId, color: 'blue', on: true });
  });

  it('changes the colour and the switch, and keeps the copies', async () => {
    const cursor = { syncToken: 'token-1' };
    await db.update(calendars).set({ cursor }).where(eq(calendars.id, ownId));
    await insertTestEvent(db, ownId, 'kept');

    const layer = await setConnectedLayer(db, avery.id, ownId, { color: 'green', on: false });
    expect(layer).toMatchObject({ id: `connected:${ownId}`, color: 'green', on: false });
    expect(await setConnectedLayer(db, avery.id, ownId, {})).toMatchObject({ on: false });

    const copies = await db.select().from(syncedEvents).where(eq(syncedEvents.calendarId, ownId));
    expect(copies.map((row) => row.remoteId)).toEqual(['kept']);
    const [calendar] = await db.select().from(calendars).where(eq(calendars.id, ownId));
    expect(calendar).toMatchObject({ cursor, shown: true, on: false });
    await db.delete(syncedEvents).where(eq(syncedEvents.calendarId, ownId));
  });

  it('reads copied events on synced calendars that may show in a range, for the owner only', async () => {
    const week = { from: new Date('2026-11-01T00:00:00Z'), to: new Date('2026-11-08T00:00:00Z') };
    const inside = await insertTestEvent(db, ownId, 'inside');
    await insertTestEvent(db, ownId, 'before', {
      startsAt: '2026-10-20T16:00:00.000Z',
      endsAt: '2026-10-20T17:00:00.000Z',
    });
    const series = await insertTestEvent(db, ownId, 'weekly', {
      startsAt: '2026-01-05T15:00:00.000Z',
      endsAt: null,
    });
    const moved = await insertTestEvent(
      db,
      ownId,
      'weekly-moved',
      { startsAt: '2026-11-03T15:00:00.000Z', endsAt: '2026-11-03T16:00:00.000Z' },
      { uid: series.event.uid, recurrenceId: { kind: 'utc', instant: '2026-11-02T15:00:00.000Z' } },
    );
    // An invitation to one occurrence of a series Care Hub can't see.
    await insertTestEvent(
      db,
      ownId,
      'invited-once',
      { startsAt: '2026-11-04T15:00:00.000Z', endsAt: '2026-11-04T16:00:00.000Z' },
      { recurrenceId: { kind: 'utc', instant: '2026-11-04T15:00:00.000Z' } },
    );
    // Family isn't synced, so its copies (if any were left) don't show.
    await insertTestEvent(db, familyId, 'family');

    const rows = await listSyncedEvents(db, { ownerId: avery.id, ...week });
    expect(rows.map((row) => row.remoteId)).toEqual([
      'weekly',
      'inside',
      'weekly-moved',
      'invited-once',
    ]);
    expect(rows[1]).toEqual({
      id: inside.id,
      seriesId: null,
      layerId: `connected:${ownId}`,
      calendarId: ownId,
      connectionId,
      remoteId: 'inside',
      event: inside.event,
      htmlLink: null,
    });
    expect(rows[0]).toMatchObject({ id: series.id, seriesId: null, event: series.event });
    expect(rows[2]).toMatchObject({ id: moved.id, seriesId: series.id });
    expect(rows[3]?.seriesId).toBeNull();
    expect(await listSyncedEvents(db, { ownerId: sam.id, ...week })).toEqual([]);
  });

  it('finds the series of a moved occurrence when the series has recurrenceId: null', async () => {
    const week = { from: new Date('2026-12-07T00:00:00Z'), to: new Date('2026-12-14T00:00:00Z') };
    const series = await insertTestEvent(db, ownId, 'daily', {
      startsAt: '2026-12-01T09:00:00.000Z',
      endsAt: null,
    });
    await db
      .update(syncedEvents)
      .set({ event: { ...series.event, recurrenceId: null } as unknown as typeof series.event })
      .where(eq(syncedEvents.id, series.id));
    const moved = await insertTestEvent(
      db,
      ownId,
      'daily-moved',
      { startsAt: '2026-12-08T10:00:00.000Z', endsAt: '2026-12-08T11:00:00.000Z' },
      { uid: series.event.uid, recurrenceId: { kind: 'utc', instant: '2026-12-08T09:00:00.000Z' } },
    );
    const rows = await listSyncedEvents(db, { ownerId: avery.id, ...week });
    expect(rows.find((row) => row.id === moved.id)?.seriesId).toBe(series.id);
  });
});
