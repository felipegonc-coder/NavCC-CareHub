// Connected calendars as layers on the calendar, and their copied events for range reads
// (Calendar spec, Layers and Connections). The calendar's routes list these with the person's
// other layers and events and pass layer changes here. Only the owner sees or changes them;
// admins never do (RP-D1). The events are read-only.
import { and, asc, eq, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { Db, Tx } from '../../../db';
import type { ExternalEvent } from '../sync/types';
import {
  type ConnectionKind,
  type ConnectionStatus,
  type LayerColor,
  calendarConnectionCalendars as calendars,
  calendarConnections as connections,
  calendarSyncedEvents as syncedEvents,
} from './schema';

type DbOrTx = Db | Tx;

/** Layer ids for connected calendars: `connected:<calendar id>`. */
export const CONNECTED_LAYER_PREFIX = 'connected:';
export const connectedLayerId = (calendarId: string) => `${CONNECTED_LAYER_PREFIX}${calendarId}`;

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The calendar id in a connected layer's id, or undefined for any other id. */
export function calendarIdOfLayer(layerId: string): string | undefined {
  if (!layerId.startsWith(CONNECTED_LAYER_PREFIX)) return undefined;
  const id = layerId.slice(CONNECTED_LAYER_PREFIX.length);
  return UUID.test(id) ? id.toLowerCase() : undefined;
}

const layerColumns = {
  calendarId: calendars.id,
  connectionId: calendars.connectionId,
  connectionLabel: connections.label,
  kind: connections.kind,
  name: calendars.name,
  color: calendars.color,
  on: calendars.on,
  order: calendars.order,
  status: connections.status,
  lastError: connections.lastError,
  lastSyncedAt: connections.lastSyncedAt,
  truncated: calendars.truncated,
};

/**
 * A connected calendar the person syncs, as a layer. The connection's status shows on all its
 * calendars. Calendars that aren't synced (`shown` off, in Settings) aren't layers.
 */
export interface ConnectedLayer {
  id: string;
  calendarId: string;
  connectionId: string;
  connectionLabel: string;
  kind: ConnectionKind;
  name: string;
  color: LayerColor;
  /** The left panel's switch (CA-04): off only hides its items on screen. */
  on: boolean;
  /** Its place in the left panel, a whole number. Connected calendars start at 100. */
  order: number;
  status: ConnectionStatus;
  /** A plain sentence, never a link or a secret (CA-11). */
  lastError: string | null;
  /** ISO time of the last good sync, or null before the first. */
  lastSyncedAt: string | null;
  /** More events than Care Hub keeps (5,000): not all of them show. */
  truncated: boolean;
}

const toLayer = ({ lastSyncedAt, ...row }: LayerRow): ConnectedLayer => ({
  id: connectedLayerId(row.calendarId),
  ...row,
  lastSyncedAt: lastSyncedAt?.toISOString() ?? null,
});

const selectLayers = (db: DbOrTx) =>
  db
    .select(layerColumns)
    .from(calendars)
    .innerJoin(connections, eq(connections.id, calendars.connectionId));
type LayerRow = Awaited<ReturnType<typeof selectLayers>>[number];

const layerOf = (userId: string) => and(eq(connections.ownerId, userId), eq(calendars.shown, true));

/** The person's connected calendar layers, in their order. */
export async function listConnectedLayers(db: DbOrTx, userId: string): Promise<ConnectedLayer[]> {
  const rows = await selectLayers(db)
    .where(layerOf(userId))
    .orderBy(
      asc(calendars.order),
      asc(connections.createdAt),
      asc(calendars.name),
      asc(calendars.id),
    );
  return rows.map(toLayer);
}

/**
 * Changes a connected layer's colour, switch or place. Copies stay as they are and nothing syncs.
 * Null when the calendar isn't one of the person's layers.
 */
export async function setConnectedLayer(
  db: DbOrTx,
  userId: string,
  calendarId: string,
  changes: { color?: LayerColor | undefined; on?: boolean | undefined; order?: number | undefined },
): Promise<ConnectedLayer | null> {
  if (!UUID.test(calendarId)) return null;
  const { color, on, order } = changes;
  const set = {
    ...(color === undefined ? {} : { color }),
    ...(on === undefined ? {} : { on }),
    ...(order === undefined ? {} : { order }),
  };
  if (Object.keys(set).length > 0) {
    const theirs = db
      .select({ id: connections.id })
      .from(connections)
      .where(eq(connections.ownerId, userId));
    await db
      .update(calendars)
      .set(set)
      .where(
        and(
          eq(calendars.id, calendarId),
          eq(calendars.shown, true),
          inArray(calendars.connectionId, theirs),
        ),
      );
  }
  const [row] = await selectLayers(db).where(and(eq(calendars.id, calendarId), layerOf(userId)));
  return row ? toLayer(row) : null;
}

export interface SyncedEventRow {
  /** Care Hub's id for it (`synced:<id>`), kept while the outside event is there. */
  id: string;
  /**
   * On a changed or cancelled occurrence (`event.recurrenceId` set): its series' row in the same
   * calendar. Null otherwise, and when Care Hub can't see the series (an invitation to one
   * occurrence): show that one as a single event.
   */
  seriesId: string | null;
  layerId: string;
  calendarId: string;
  connectionId: string;
  remoteId: string;
  event: ExternalEvent;
  /** The event's page in Google Calendar (CA-17), or null. */
  htmlLink: string | null;
}

/**
 * Copied events on the person's connected layers (switched on or off) that may have occurrences
 * in [from, to): single events, series, and changed or cancelled occurrences of a series (same
 * uid, `recurrenceId` set). Expand series to occurrences with the reader's expandSeries.
 */
export async function listSyncedEvents(
  db: DbOrTx,
  input: { ownerId: string; from: Date; to: Date },
): Promise<SyncedEventRow[]> {
  const rows = await db
    .select({
      id: syncedEvents.id,
      calendarId: syncedEvents.calendarId,
      connectionId: calendars.connectionId,
      remoteId: syncedEvents.remoteId,
      uid: syncedEvents.uid,
      event: syncedEvents.event,
      htmlLink: syncedEvents.htmlLink,
    })
    .from(syncedEvents)
    .innerJoin(calendars, eq(calendars.id, syncedEvents.calendarId))
    .innerJoin(connections, eq(connections.id, calendars.connectionId))
    .where(
      and(
        layerOf(input.ownerId),
        lt(syncedEvents.startsAt, input.to),
        or(isNull(syncedEvents.endsAt), gt(syncedEvents.endsAt, input.from)),
      ),
    )
    .orderBy(asc(syncedEvents.startsAt), asc(syncedEvents.calendarId), asc(syncedEvents.remoteId));
  const occurrences = rows.filter((row) => row.event.recurrenceId);
  const series = new Map<string, string>();
  if (occurrences.length > 0) {
    const found = await db
      .select({ id: syncedEvents.id, calendarId: syncedEvents.calendarId, uid: syncedEvents.uid })
      .from(syncedEvents)
      .where(
        and(
          inArray(syncedEvents.calendarId, [...new Set(occurrences.map((row) => row.calendarId))]),
          inArray(syncedEvents.uid, [...new Set(occurrences.map((row) => row.uid))]),
          sql`${syncedEvents.event} -> 'recurrenceId' IS NULL`,
        ),
      );
    for (const row of found) series.set(`${row.calendarId} ${row.uid}`, row.id);
  }
  return rows.map(({ uid, ...row }) => ({
    ...row,
    seriesId: row.event.recurrenceId ? (series.get(`${row.calendarId} ${uid}`) ?? null) : null,
    layerId: connectedLayerId(row.calendarId),
  }));
}
