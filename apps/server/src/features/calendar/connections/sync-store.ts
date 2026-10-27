// What a sync run reads and writes (Calendar spec, Connections). pgSyncStore keeps it in
// Postgres; the engine's tests use a memory store. A run leases its connection, so two runs never
// read the same calendars at once, and a run that crashed lets go when the lease runs out.
import { and, asc, eq, inArray, isNull, lt, lte, ne, notInArray, or, sql } from 'drizzle-orm';
import type { Db, Tx } from '../../../db';
import { type SyncedEventInput, eventRows } from './event-rows';
import {
  type ConnectionKind,
  type ConnectionStatus,
  type SyncCursor,
  calendarConnectionCalendars as calendars,
  calendarConnections as connections,
  calendarSyncedEvents as syncedEvents,
} from './schema';
import { nextLayers } from './store';

/** Per calendar (Calendar spec, Limits). The events nearest to now are kept. */
export const MAX_EVENTS_PER_CALENDAR = 5_000;
export const SYNC_LEASE_MS = 10 * 60_000;
const INSERT_CHUNK = 500;

export type { SyncedEventInput } from './event-rows';

/** A connection as a run sees it, with its sealed secret. */
export interface SyncConnection {
  id: string;
  ownerId: string;
  workspaceId: string | null;
  kind: ConnectionKind;
  label: string;
  account: string | null;
  secret: string;
  status: ConnectionStatus;
  lastError: string | null;
  failures: number;
  lastSyncedAt: Date | null;
}

export interface SyncCalendar {
  id: string;
  remoteId: string;
  name: string;
  shown: boolean;
  timeZone: string | null;
  cursor: SyncCursor | null;
  lastFullSyncAt: Date | null;
}

export interface RemoteCalendar {
  remoteId: string;
  name: string;
  timeZone?: string | undefined;
  /** Whether it shows when Care Hub first sees it. */
  shown: boolean;
}

export interface SyncOutcome {
  status: ConnectionStatus;
  lastError: string | null;
  failures: number;
  nextSyncAt: Date;
  /** Set when the outside calendar was read, even if nothing changed. */
  syncedAt?: Date | undefined;
  /** A new sealed secret, such as a Google sign-in with a fresh access token. */
  secret?: string | undefined;
}

export interface SyncStore {
  /** Leases up to `limit` connections that are due, most overdue first. */
  claimDue(now: Date, limit: number): Promise<string[]>;
  /**
   * Leases one of the person's connections now, unless it's held. With `unlessSyncedAfter`
   * (Calendar open), only when it's due, or fine and not read since then; never while it waits
   * for a sign-in.
   */
  claim(input: {
    id: string;
    ownerId: string;
    now: Date;
    unlessSyncedAfter?: Date | undefined;
  }): Promise<boolean>;
  load(id: string): Promise<{ connection: SyncConnection; calendars: SyncCalendar[] } | undefined>;
  /**
   * Matches the connection's calendars to the outside list: new ones get the next colours, names
   * and zones follow the outside calendar, and calendars no longer there go with their events.
   */
  saveCalendarList(connectionId: string, remote: RemoteCalendar[]): Promise<SyncCalendar[]>;
  /** After reading everything: the calendar's copies become these. Skipped if it was hidden. */
  replaceEvents(
    calendarId: string,
    events: SyncedEventInput[],
    cursor: SyncCursor | null,
    now: Date,
  ): Promise<{ changed: boolean }>;
  /** After reading changes: changed events replace their copies and removed ones go. */
  applyChanges(
    calendarId: string,
    changes: { upserts: SyncedEventInput[]; removed: string[] },
    cursor: SyncCursor | null,
    now: Date,
  ): Promise<{ changed: boolean }>;
  /**
   * Records how the run went and lets go. When the secret changed during the run (the person
   * signed in again), only lets go, and returns false: the next run uses the new sign-in.
   */
  finish(id: string, startedWith: string, outcome: SyncOutcome): Promise<boolean>;
}

const calendarColumns = {
  id: calendars.id,
  remoteId: calendars.remoteId,
  name: calendars.name,
  shown: calendars.shown,
  timeZone: calendars.timeZone,
  cursor: calendars.cursor,
  lastFullSyncAt: calendars.lastFullSyncAt,
};

const eventKey = [syncedEvents.calendarId, syncedEvents.remoteId];
const eventUpdate = {
  uid: sql`excluded.uid`,
  version: sql`excluded.version`,
  event: sql`excluded.event`,
  htmlLink: sql`excluded.html_link`,
  startsAt: sql`excluded.starts_at`,
  endsAt: sql`excluded.ends_at`,
  readAt: sql`excluded.read_at`,
};

const leaseFree = (now: Date) =>
  or(isNull(connections.leaseUntil), lt(connections.leaseUntil, now));
const leaseEnd = (now: Date) => new Date(now.getTime() + SYNC_LEASE_MS);

/** Locks the calendar for writing its copies. False when it's gone or hidden. */
async function lockShown(tx: Tx, calendarId: string) {
  const [row] = await tx
    .select({ shown: calendars.shown })
    .from(calendars)
    .where(eq(calendars.id, calendarId))
    .for('update');
  return row?.shown === true;
}

export function pgSyncStore(db: Db): SyncStore {
  const listCalendars = (q: Db | Tx, connectionId: string) =>
    q
      .select(calendarColumns)
      .from(calendars)
      .where(eq(calendars.connectionId, connectionId))
      .orderBy(asc(calendars.name), asc(calendars.id));

  return {
    async claimDue(now, limit) {
      const due = db
        .select({ id: connections.id })
        .from(connections)
        .where(
          and(
            lte(connections.nextSyncAt, now),
            ne(connections.status, 'needs-reconnect'),
            leaseFree(now),
          ),
        )
        .orderBy(asc(connections.nextSyncAt))
        .limit(limit)
        .for('update', { skipLocked: true });
      const rows = await db
        .update(connections)
        .set({ leaseUntil: leaseEnd(now) })
        .where(inArray(connections.id, due))
        .returning({ id: connections.id });
      return rows.map((row) => row.id);
    },

    async claim({ id, ownerId, now, unlessSyncedAfter: fresh }) {
      const rows = await db
        .update(connections)
        .set({ leaseUntil: leaseEnd(now) })
        .where(
          and(
            eq(connections.id, id),
            eq(connections.ownerId, ownerId),
            leaseFree(now),
            fresh
              ? and(
                  ne(connections.status, 'needs-reconnect'),
                  or(
                    lte(connections.nextSyncAt, now),
                    and(
                      eq(connections.status, 'ok'),
                      or(isNull(connections.lastSyncedAt), lt(connections.lastSyncedAt, fresh)),
                    ),
                  ),
                )
              : undefined,
          ),
        )
        .returning({ id: connections.id });
      return rows.length > 0;
    },

    async load(id) {
      const [connection] = await db
        .select({
          id: connections.id,
          ownerId: connections.ownerId,
          workspaceId: connections.workspaceId,
          kind: connections.kind,
          label: connections.label,
          account: connections.account,
          secret: connections.secret,
          status: connections.status,
          lastError: connections.lastError,
          failures: connections.failures,
          lastSyncedAt: connections.lastSyncedAt,
        })
        .from(connections)
        .where(eq(connections.id, id));
      return connection && { connection, calendars: await listCalendars(db, id) };
    },

    saveCalendarList: (connectionId, remote) =>
      db.transaction(async (tx) => {
        const [owner] = await tx
          .select({ id: connections.ownerId })
          .from(connections)
          .where(eq(connections.id, connectionId));
        if (!owner) return [];
        const wanted = remote.map((calendar) => calendar.remoteId);
        const mine = eq(calendars.connectionId, connectionId);
        await tx
          .delete(calendars)
          .where(wanted.length > 0 ? and(mine, notInArray(calendars.remoteId, wanted)) : mine);
        const known = new Set((await listCalendars(tx, connectionId)).map((c) => c.remoteId));
        const added = remote.filter((calendar) => !known.has(calendar.remoteId));
        const layers = await nextLayers(tx, owner.id, added.length);
        for (const calendar of remote) {
          const layer = layers[added.indexOf(calendar)];
          await tx
            .insert(calendars)
            .values({
              connectionId,
              remoteId: calendar.remoteId,
              name: [...calendar.name].slice(0, 200).join('') || 'Calendar',
              color: layer?.color ?? 'blue',
              order: layer?.order ?? 100,
              shown: calendar.shown,
              timeZone: calendar.timeZone ?? null,
            })
            .onConflictDoUpdate({
              target: [calendars.connectionId, calendars.remoteId],
              set: { name: sql`excluded.name`, timeZone: sql`excluded.time_zone` },
            });
        }
        return listCalendars(tx, connectionId);
      }),

    replaceEvents: (calendarId, events, cursor, now) =>
      db.transaction(async (tx) => {
        if (!(await lockShown(tx, calendarId))) return { changed: false };
        const rows = eventRows(calendarId, events, now);
        const kept = rows.slice(0, MAX_EVENTS_PER_CALENDAR);
        const before = await tx
          .select({ remoteId: syncedEvents.remoteId, version: syncedEvents.version })
          .from(syncedEvents)
          .where(eq(syncedEvents.calendarId, calendarId));
        const versions = new Map(before.map((row) => [row.remoteId, row.version]));
        const keep = new Set(kept.map((row) => row.remoteId));
        // Rows are updated in place, so an event keeps its id from one read to the next.
        const gone = before.filter((row) => !keep.has(row.remoteId)).map((row) => row.remoteId);
        const fresh = kept.filter((row) => versions.get(row.remoteId) !== row.version);
        for (let i = 0; i < gone.length; i += INSERT_CHUNK) {
          const ids = gone.slice(i, i + INSERT_CHUNK);
          await tx
            .delete(syncedEvents)
            .where(
              and(eq(syncedEvents.calendarId, calendarId), inArray(syncedEvents.remoteId, ids)),
            );
        }
        for (let i = 0; i < fresh.length; i += INSERT_CHUNK) {
          await tx
            .insert(syncedEvents)
            .values(fresh.slice(i, i + INSERT_CHUNK))
            .onConflictDoUpdate({ target: eventKey, set: eventUpdate });
        }
        await tx
          .update(calendars)
          .set({ cursor, lastFullSyncAt: now, truncated: rows.length > kept.length })
          .where(eq(calendars.id, calendarId));
        return { changed: gone.length + fresh.length > 0 };
      }),

    applyChanges: (calendarId, { upserts, removed }, cursor, now) =>
      db.transaction(async (tx) => {
        if (!(await lockShown(tx, calendarId))) return { changed: false };
        const inCalendar = eq(syncedEvents.calendarId, calendarId);
        let changed = false;
        if (removed.length > 0) {
          // A removed series takes its changed and cancelled occurrences with it.
          const series = tx
            .select({ uid: syncedEvents.uid })
            .from(syncedEvents)
            .where(
              and(
                inCalendar,
                inArray(syncedEvents.remoteId, removed),
                sql`${syncedEvents.event} -> 'recurrenceId' IS NULL`,
              ),
            );
          const gone = await tx
            .delete(syncedEvents)
            .where(
              and(
                inCalendar,
                or(inArray(syncedEvents.remoteId, removed), inArray(syncedEvents.uid, series)),
              ),
            )
            .returning({ remoteId: syncedEvents.remoteId });
          changed = gone.length > 0;
        }
        const rows = eventRows(calendarId, upserts, now);
        for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
          const saved = await tx
            .insert(syncedEvents)
            .values(rows.slice(i, i + INSERT_CHUNK))
            .onConflictDoUpdate({
              target: eventKey,
              set: eventUpdate,
              setWhere: sql`${syncedEvents.version} IS DISTINCT FROM excluded.version`,
            })
            .returning({ remoteId: syncedEvents.remoteId });
          changed ||= saved.length > 0;
        }
        const [count] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(syncedEvents)
          .where(inCalendar);
        // Too many after the changes: the next run reads everything again and keeps the nearest.
        const full = (count?.n ?? 0) > MAX_EVENTS_PER_CALENDAR;
        await tx
          .update(calendars)
          .set({ cursor: full ? null : cursor })
          .where(eq(calendars.id, calendarId));
        return { changed };
      }),

    async finish(id, startedWith, outcome) {
      const now = new Date();
      const recorded = await db
        .update(connections)
        .set({
          status: outcome.status,
          lastError: outcome.lastError,
          failures: outcome.failures,
          nextSyncAt: outcome.nextSyncAt,
          leaseUntil: null,
          updatedAt: now,
          ...(outcome.syncedAt ? { lastSyncedAt: outcome.syncedAt } : {}),
          ...(outcome.secret ? { secret: outcome.secret } : {}),
        })
        .where(and(eq(connections.id, id), eq(connections.secret, startedWith)))
        .returning({ id: connections.id });
      if (recorded.length > 0) return true;
      await db.update(connections).set({ leaseUntil: null }).where(eq(connections.id, id));
      return false;
    },
  };
}
