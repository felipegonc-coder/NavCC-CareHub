import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../../db';
import {
  type TestApp,
  type TestUser,
  createTestApp,
  createUser,
  hasDatabase,
} from '../../../testing';
import type { ExternalEvent } from '../sync/types';
import {
  calendarConnectionCalendars as calendars,
  calendarConnections as connections,
  calendarSyncedEvents as syncedEvents,
} from './schema';
import { createConnection } from './store';
import {
  MAX_EVENTS_PER_CALENDAR,
  SYNC_LEASE_MS,
  type SyncStore,
  type SyncedEventInput,
  pgSyncStore,
} from './sync-store';
import { TEST_SEALED_SECRET, testGoogleConnection, testLinkConnection } from './testing';

const NOW = new Date('2026-10-27T13:00:00.000Z');
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);

function visit(name: string, start: string, extra: Partial<ExternalEvent> = {}): ExternalEvent {
  return {
    uid: `${name}@example.com`,
    status: 'confirmed',
    title: `Visit ${name}`,
    start: { kind: 'utc', instant: start },
    end: { kind: 'utc', instant: new Date(Date.parse(start) + 3_600_000).toISOString() },
    busy: true,
    ...extra,
  };
}
const input = (remoteId: string, start: string, version?: string): SyncedEventInput => ({
  remoteId,
  event: visit(remoteId, start),
  ...(version ? { version } : {}),
});

describe.skipIf(!hasDatabase)('calendar sync storage', () => {
  let testApp: TestApp;
  let db: Db;
  let store: SyncStore;
  let avery: TestUser;
  let sam: TestUser;

  beforeAll(async () => {
    testApp = await createTestApp();
    db = testApp.db;
    store = pgSyncStore(db);
    avery = await createUser(db, { name: 'Avery Lin', email: 'avery.lin@example.com' });
    sam = await createUser(db, { name: 'Sam Ortiz', email: 'sam.ortiz@example.com' });
  });

  beforeEach(async () => {
    await db.delete(connections);
  });

  afterAll(async () => {
    await testApp?.close();
  });

  /** A Google connection due at `due`: the person's own calendar shown, Family not. */
  async function addGoogle(ownerId: string, due = minutes(-60)) {
    const connection = testGoogleConnection(ownerId);
    await createConnection(db, connection, due);
    const rows = await db
      .select({ id: calendars.id })
      .from(calendars)
      .where(eq(calendars.connectionId, connection.id))
      .orderBy(asc(calendars.name));
    return { id: connection.id, own: rows[0]!.id, family: rows[1]!.id };
  }
  const copies = (calendarId: string) =>
    db
      .select({
        id: syncedEvents.id,
        remoteId: syncedEvents.remoteId,
        version: syncedEvents.version,
      })
      .from(syncedEvents)
      .where(eq(syncedEvents.calendarId, calendarId))
      .orderBy(asc(syncedEvents.remoteId));
  const calendarRow = async (calendarId: string) => {
    const [row] = await db.select().from(calendars).where(eq(calendars.id, calendarId));
    return row;
  };
  const connectionRow = async (id: string) => {
    const [row] = await db.select().from(connections).where(eq(connections.id, id));
    return row;
  };

  it('leases due connections once, most overdue first, skipping ones waiting for a sign-in', async () => {
    const first = await addGoogle(avery.id, minutes(-60));
    const second = testLinkConnection(sam.id);
    await createConnection(db, second, minutes(-30));
    await createConnection(db, testLinkConnection(sam.id, 'Later'), minutes(30));
    const waiting = testLinkConnection(avery.id, 'Waiting');
    await createConnection(db, waiting, minutes(-90));
    await db
      .update(connections)
      .set({ status: 'needs-reconnect' })
      .where(eq(connections.id, waiting.id));

    expect(await store.claimDue(NOW, 1)).toEqual([first.id]);
    expect(await store.claimDue(NOW, 10)).toEqual([second.id]);
    expect(await store.claimDue(NOW, 10)).toEqual([]);
    // A run that crashed lets go when its lease runs out.
    const later = new Date(NOW.getTime() + SYNC_LEASE_MS + 1_000);
    expect((await store.claimDue(later, 10)).sort()).toEqual([first.id, second.id].sort());
  });

  it('leases one connection for its owner, and on Calendar open only if it is due or stale', async () => {
    const { id } = await addGoogle(avery.id);
    expect(await store.claim({ id, ownerId: sam.id, now: NOW })).toBe(false);
    expect(await store.claim({ id, ownerId: avery.id, now: NOW })).toBe(true);
    expect(await store.claim({ id, ownerId: avery.id, now: NOW })).toBe(false);
    const done = { status: 'ok', lastError: null, failures: 0, nextSyncAt: minutes(5) } as const;
    expect(await store.finish(id, TEST_SEALED_SECRET, { ...done, syncedAt: NOW })).toBe(true);

    const soon = { id, ownerId: avery.id, now: minutes(0.5), unlessSyncedAfter: minutes(-0.5) };
    expect(await store.claim(soon)).toBe(false);
    const later = { id, ownerId: avery.id, now: minutes(2), unlessSyncedAfter: minutes(1) };
    expect(await store.claim(later)).toBe(true);
    // A calendar was just chosen, so it's due, though it was read a moment ago.
    const due = { ...done, nextSyncAt: minutes(2), syncedAt: minutes(2) };
    expect(await store.finish(id, TEST_SEALED_SECRET, due)).toBe(true);
    const open = { id, ownerId: avery.id, now: minutes(2.2), unlessSyncedAfter: minutes(1.2) };
    expect(await store.claim(open)).toBe(true);
    // Waiting for a sign-in: Calendar open leaves it alone, and "Sync now" still tries.
    const signIn = {
      ...done,
      status: 'needs-reconnect',
      failures: 1,
      nextSyncAt: minutes(3),
    } as const;
    expect(await store.finish(id, TEST_SEALED_SECRET, signIn)).toBe(true);
    const reopen = { id, ownerId: avery.id, now: minutes(4), unlessSyncedAfter: minutes(3) };
    expect(await store.claim(reopen)).toBe(false);
    expect(await store.claim({ id, ownerId: avery.id, now: minutes(4) })).toBe(true);
  });

  it("loads a connection with its owner's address and its calendars", async () => {
    const { id, own, family } = await addGoogle(avery.id);
    const loaded = await store.load(id);
    expect(loaded?.connection).toEqual({
      id,
      ownerId: avery.id,
      ownerEmail: 'avery.lin@example.com',
      workspaceId: null,
      kind: 'google',
      label: 'Google',
      account: 'avery.lin@example.com',
      secret: TEST_SEALED_SECRET,
      status: 'ok',
      lastError: null,
      failures: 0,
      lastSyncedAt: null,
    });
    expect(loaded?.calendars.map((c) => [c.id, c.shown])).toEqual([
      [own, true],
      [family, false],
    ]);
    expect(await store.load('6d7c1f0e-0d1c-4f62-9a55-3f1f2b8f4a10')).toBeUndefined();
  });

  it('follows the outside calendar list: new calendars come next, gone ones go', async () => {
    const { id, own, family } = await addGoogle(avery.id);
    await store.replaceEvents(own, [input('a', '2026-10-28T10:00:00.000Z')], null, NOW);
    const rota = 'rota@group.calendar.example.com';
    const saved = await store.saveCalendarList(id, [
      {
        remoteId: 'avery.lin@example.com',
        name: 'Avery Lin (work)',
        timeZone: 'America/New_York',
        shown: false,
      },
      { remoteId: rota, name: 'R'.repeat(250), shown: false },
    ]);

    expect(saved.map((c) => c.remoteId).sort()).toEqual(['avery.lin@example.com', rota]);
    expect(await calendarRow(own)).toMatchObject({
      name: 'Avery Lin (work)',
      timeZone: 'America/New_York',
      shown: true,
      color: 'blue',
      order: 100,
    });
    const added = saved.find((c) => c.remoteId === rota);
    expect(added?.name).toHaveLength(200);
    expect(await calendarRow(added!.id)).toMatchObject({
      shown: false,
      color: 'purple',
      order: 101,
    });
    expect(await calendarRow(family)).toBeUndefined();
    expect(await copies(own)).toHaveLength(1);
  });

  it("replaces a calendar's copies after a full read, keeping the ids of events still there", async () => {
    const { own } = await addGoogle(avery.id);
    const a1 = input('a', '2026-10-28T10:00:00.000Z', 'v1');
    const b1 = input('b', '2026-10-29T10:00:00.000Z', 'v1');
    expect(await store.replaceEvents(own, [a1, b1], { syncToken: 't1' }, NOW)).toEqual({
      changed: true,
    });
    const before = await copies(own);
    expect(await store.replaceEvents(own, [a1, b1], { syncToken: 't2' }, NOW)).toEqual({
      changed: false,
    });

    const a2 = input('a', '2026-10-28T11:00:00.000Z', 'v2');
    const c1 = input('c', '2026-10-30T10:00:00.000Z', 'v1');
    expect(await store.replaceEvents(own, [a2, c1], { syncToken: 't3' }, minutes(5))).toEqual({
      changed: true,
    });
    const after = await copies(own);
    expect(after.map((row) => [row.remoteId, row.version])).toEqual([
      ['a', 'v2'],
      ['c', 'v1'],
    ]);
    expect(after[0]?.id).toBe(before[0]?.id);
    const calendar = await calendarRow(own);
    expect(calendar).toMatchObject({ cursor: { syncToken: 't3' }, truncated: false });
    expect(calendar?.lastFullSyncAt?.toISOString()).toBe(minutes(5).toISOString());
  });

  it('writes nothing for a calendar that is not synced', async () => {
    const { family } = await addGoogle(avery.id);
    const one = input('a', '2026-10-28T10:00:00.000Z');
    expect(await store.replaceEvents(family, [one], { syncToken: 't1' }, NOW)).toEqual({
      changed: false,
    });
    expect(await store.applyChanges(family, { upserts: [one], removed: [] }, null, NOW)).toEqual({
      changed: false,
    });
    expect(await copies(family)).toEqual([]);
    expect((await calendarRow(family))?.cursor).toBeNull();
  });

  it(`keeps the ${MAX_EVENTS_PER_CALENDAR} events nearest to now`, async () => {
    const { own } = await addGoogle(avery.id);
    const many = Array.from({ length: MAX_EVENTS_PER_CALENDAR + 1 }, (_, i) =>
      input(`e${String(i).padStart(5, '0')}`, minutes((i + 1) * 60).toISOString()),
    );
    await store.replaceEvents(own, many, { syncToken: 't1' }, NOW);
    const rows = await copies(own);
    expect(rows).toHaveLength(MAX_EVENTS_PER_CALENDAR);
    expect(rows.at(-1)?.remoteId).toBe(`e${String(MAX_EVENTS_PER_CALENDAR - 1).padStart(5, '0')}`);
    expect((await calendarRow(own))?.truncated).toBe(true);

    // Over the limit after changes: the next run reads everything again.
    const extra = input('extra', minutes(30).toISOString());
    await store.applyChanges(own, { upserts: [extra], removed: [] }, { syncToken: 't2' }, NOW);
    expect((await calendarRow(own))?.cursor).toBeNull();
  });

  it('applies changes: new versions only, and a removed series takes its occurrences', async () => {
    const { own } = await addGoogle(avery.id);
    const series: SyncedEventInput = {
      remoteId: 'weekly',
      event: visit('weekly', '2026-10-05T15:00:00.000Z', { rrule: 'FREQ=WEEKLY' }),
      version: 'v1',
    };
    const moved: SyncedEventInput = {
      remoteId: 'weekly_20261102',
      event: visit('moved', '2026-11-03T15:00:00.000Z', {
        uid: 'weekly@example.com',
        recurrenceId: { kind: 'utc', instant: '2026-11-02T15:00:00.000Z' },
      }),
      version: 'v1',
    };
    const single = input('single', '2026-10-28T10:00:00.000Z', 'v1');
    await store.replaceEvents(own, [series, moved, single], { syncToken: 't1' }, NOW);
    const before = await copies(own);

    const same = { upserts: [single], removed: [] };
    expect(await store.applyChanges(own, same, { syncToken: 't2' }, NOW)).toEqual({
      changed: false,
    });
    const changes = {
      upserts: [
        input('single', '2026-10-28T12:00:00.000Z', 'v2'),
        input('new', '2026-10-30T10:00:00.000Z', 'v1'),
      ],
      removed: ['weekly'],
    };
    expect(await store.applyChanges(own, changes, { syncToken: 't3' }, NOW)).toEqual({
      changed: true,
    });
    const after = await copies(own);
    expect(after.map((row) => [row.remoteId, row.version])).toEqual([
      ['new', 'v1'],
      ['single', 'v2'],
    ]);
    const idOf = (rows: typeof after) => rows.find((row) => row.remoteId === 'single')?.id;
    expect(idOf(after)).toBe(idOf(before));
    expect((await calendarRow(own))?.cursor).toEqual({ syncToken: 't3' });
  });

  it('records how a run went, unless the person signed in again meanwhile', async () => {
    const { id } = await addGoogle(avery.id);
    await store.claim({ id, ownerId: avery.id, now: NOW });
    const outcome = {
      status: 'error',
      lastError: 'Google is busy. Care Hub will try again shortly.',
      failures: 3,
      nextSyncAt: minutes(10),
      secret: 'v1.new-access-token',
    } as const;
    expect(await store.finish(id, TEST_SEALED_SECRET, outcome)).toBe(true);
    const row = await connectionRow(id);
    expect(row).toMatchObject({
      status: 'error',
      lastError: outcome.lastError,
      failures: 3,
      secret: outcome.secret,
      leaseUntil: null,
      lastSyncedAt: null,
    });
    expect(row?.nextSyncAt.toISOString()).toBe(minutes(10).toISOString());

    await store.claim({ id, ownerId: avery.id, now: NOW });
    const ok = { status: 'ok', lastError: null, failures: 0, nextSyncAt: minutes(15) } as const;
    expect(await store.finish(id, TEST_SEALED_SECRET, { ...ok, syncedAt: NOW })).toBe(false);
    expect(await connectionRow(id)).toMatchObject({
      status: 'error',
      failures: 3,
      leaseUntil: null,
    });
  });
});
