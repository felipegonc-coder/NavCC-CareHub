// Connected calendars as layers on the calendar, and their copied events for range reads
// (Calendar spec, Layers and Connections). The calendar's routes list these with the person's
// other layers and events and pass layer changes here. Only the owner sees or changes them;
// admins never do (RP-D1). The events are read-only.
import { and, asc, eq, gt, isNull, lt, or } from 'drizzle-orm';
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  shown: calendars.shown,
  status: connections.status,
  lastError: connections.lastError,
  lastSyncedAt: connections.lastSyncedAt,
  truncated: calendars.truncated,
};

/** A connected calendar as a layer. The connection's status shows on all its calendars. */
export interface ConnectedLayer {
  id: string;
  calendarId: string;
  connectionId: string;
  connectionLabel: string;
  kind: ConnectionKind;
  name: string;
  color: LayerColor;
  shown: boolean;
  status: ConnectionStatus;
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

/** The person's connected calendars: oldest connection first, then by name. */
export async function listConnectedLayers(db: DbOrTx, userId: string): Promise<ConnectedLayer[]> {
  const rows = await selectLayers(db)
    .where(eq(connections.ownerId, userId))
    .orderBy(
      asc(connections.createdAt),
      asc(connections.id),
      asc(calendars.name),
      asc(calendars.id),
    );
  return rows.map(toLayer);
}

/**
 * Changes a connected calendar's colour or whether it shows. Hiding it drops its copied events;
 * showing it again reads them in full on the next sync, which is due straight away. Null when the
 * calendar isn't the person's.
 */
export async function setConnectedLayer(
  db: DbOrTx,
  userId: string,
  calendarId: string,
  changes: { color?: LayerColor | undefined; shown?: boolean | undefined },
  now = new Date(),
): Promise<ConnectedLayer | null> {
  if (!UUID.test(calendarId)) return null;
  return db.transaction(async (tx) => {
    const [before] = await selectLayers(tx)
      .where(and(eq(calendars.id, calendarId), eq(connections.ownerId, userId)))
      .for('update');
    if (!before) return null;
    const color = changes.color ?? before.color;
    const shown = changes.shown ?? before.shown;
    const hide = before.shown && !shown;
    const fresh = hide ? { cursor: null, lastFullSyncAt: null, truncated: false } : {};
    await tx
      .update(calendars)
      .set({ color, shown, ...fresh })
      .where(eq(calendars.id, calendarId));
    if (hide) await tx.delete(syncedEvents).where(eq(syncedEvents.calendarId, calendarId));
    if (shown && !before.shown) {
      await tx
        .update(connections)
        .set({ nextSyncAt: now, updatedAt: now })
        .where(eq(connections.id, before.connectionId));
    }
    return toLayer({ ...before, color, shown, truncated: hide ? false : before.truncated });
  });
}

export interface SyncedEventRow {
  layerId: string;
  calendarId: string;
  connectionId: string;
  remoteId: string;
  event: ExternalEvent;
  /** The event's page in Google Calendar (CA-17), or null. */
  htmlLink: string | null;
}

/**
 * Copied events on the person's shown connected calendars that may have occurrences in
 * [from, to): single events, series, and changed or cancelled occurrences of a series (same uid,
 * `recurrenceId` set). Expand series to occurrences with the reader's expandSeries.
 */
export async function listSyncedEvents(
  db: DbOrTx,
  input: { ownerId: string; from: Date; to: Date },
): Promise<SyncedEventRow[]> {
  const rows = await db
    .select({
      calendarId: syncedEvents.calendarId,
      connectionId: calendars.connectionId,
      remoteId: syncedEvents.remoteId,
      event: syncedEvents.event,
      htmlLink: syncedEvents.htmlLink,
    })
    .from(syncedEvents)
    .innerJoin(calendars, eq(calendars.id, syncedEvents.calendarId))
    .innerJoin(connections, eq(connections.id, calendars.connectionId))
    .where(
      and(
        eq(connections.ownerId, input.ownerId),
        eq(calendars.shown, true),
        lt(syncedEvents.startsAt, input.to),
        or(isNull(syncedEvents.endsAt), gt(syncedEvents.endsAt, input.from)),
      ),
    )
    .orderBy(asc(syncedEvents.startsAt), asc(syncedEvents.calendarId), asc(syncedEvents.remoteId));
  return rows.map((row) => ({ layerId: connectedLayerId(row.calendarId), ...row }));
}
