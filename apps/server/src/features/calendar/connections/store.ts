// Storage for calendar connections and their calendars (Calendar spec, Connections). Everything
// is scoped to the owner: no one else, admins included, reads or changes a connection (RP-D1).
// Views for screens never include the sealed secret.
import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Db, Tx } from '../../../db';
import { UUID } from './layers';
import {
  type ConnectionKind,
  type ConnectionStatus,
  type LayerColor,
  LAYER_COLORS,
  calendarConnectionCalendars as calendars,
  calendarConnections as connections,
  calendarSyncedEvents as syncedEvents,
} from './schema';

/** Per person (Calendar spec, Limits). */
export const MAX_CONNECTIONS = 10;
export const CONNECTION_LIMIT_MESSAGE = `You can connect up to ${MAX_CONNECTIONS} calendars. Remove one to add another.`;

type DbOrTx = Db | Tx;

export class ConnectionLimitError extends Error {
  constructor() {
    super(CONNECTION_LIMIT_MESSAGE);
    this.name = 'ConnectionLimitError';
  }
}

/** A connection's id is made before its secret is sealed, because the secret is sealed for it. */
export const newConnectionId = (): string => randomUUID();

/** New calendars take these in turn (the kit's colours from blue on, then gray to green). */
export const CALENDAR_COLORS: readonly LayerColor[] = [
  ...LAYER_COLORS.slice(6),
  ...LAYER_COLORS.slice(1, 6),
];

/** Connected calendars sit after Care Hub's own layers in the left panel. */
export const FIRST_CONNECTED_ORDER = 100;

/** Colours and places for `count` new calendars of this person, after their other calendars. */
export async function nextLayers(db: DbOrTx, ownerId: string, count: number) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int`, last: sql<number | null>`max(${calendars.order})` })
    .from(calendars)
    .innerJoin(connections, eq(connections.id, calendars.connectionId))
    .where(eq(connections.ownerId, ownerId));
  const used = row?.n ?? 0;
  const first = Math.max(FIRST_CONNECTED_ORDER, (row?.last ?? 0) + 1);
  return Array.from({ length: count }, (_, i) => ({
    color: CALENDAR_COLORS[(used + i) % CALENDAR_COLORS.length] ?? 'blue',
    order: first + i,
  }));
}

/** "avery.lin@example.com" → "a…@example.com" (Calendar spec: "Connected as a…@icloud.com"). */
export function maskAccount(account: string | null): string | null {
  if (!account) return null;
  const at = account.lastIndexOf('@');
  return at > 0 ? `${account.slice(0, 1)}…${account.slice(at)}` : `${account.slice(0, 1)}…`;
}

export interface NewCalendar {
  remoteId: string;
  name: string;
  shown: boolean;
  /** Picked in turn (CALENDAR_COLORS) when not given. */
  color?: LayerColor | undefined;
  timeZone?: string | null | undefined;
}

export interface NewConnection {
  id: string;
  ownerId: string;
  workspaceId?: string | null | undefined;
  kind: ConnectionKind;
  label: string;
  account?: string | null | undefined;
  /** Sealed with connectionSecretContext(id). */
  secret: string;
  calendars: NewCalendar[];
}

/** Adds a connection and its calendars. Throws ConnectionLimitError when the person has 10. */
export async function createConnection(db: DbOrTx, input: NewConnection, now = new Date()) {
  await db.transaction(async (tx) => {
    // One at a time per person, so two quick connects can't both slip under the limit.
    const lockKey = `cal-connections:${input.ownerId}`;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
    const [count] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(connections)
      .where(eq(connections.ownerId, input.ownerId));
    if ((count?.n ?? 0) >= MAX_CONNECTIONS) throw new ConnectionLimitError();
    await tx.insert(connections).values({
      id: input.id,
      ownerId: input.ownerId,
      workspaceId: input.workspaceId ?? null,
      kind: input.kind,
      label: input.label,
      account: input.account ?? null,
      secret: input.secret,
      nextSyncAt: now,
      createdAt: now,
      updatedAt: now,
    });
    if (input.calendars.length === 0) return;
    const layers = await nextLayers(tx, input.ownerId, input.calendars.length);
    await tx.insert(calendars).values(
      input.calendars.map((calendar, i) => ({
        connectionId: input.id,
        remoteId: calendar.remoteId,
        name: calendar.name,
        color: calendar.color ?? layers[i]?.color ?? 'blue',
        order: layers[i]?.order ?? FIRST_CONNECTED_ORDER,
        shown: calendar.shown,
        timeZone: calendar.timeZone ?? null,
      })),
    );
  });
}

export interface CalendarView {
  id: string;
  name: string;
  color: LayerColor;
  shown: boolean;
  /** More events than Care Hub keeps: not all of them show. */
  truncated: boolean;
}

/** What screens get: never the secret, and the account masked. */
export interface ConnectionView {
  id: string;
  kind: ConnectionKind;
  label: string;
  account: string | null;
  status: ConnectionStatus;
  lastError: string | null;
  lastSyncedAt: Date | null;
  calendars: CalendarView[];
}

/** The person's connections, oldest first, each with its calendars by name. */
export async function listConnections(db: DbOrTx, ownerId: string): Promise<ConnectionView[]> {
  const rows = await db
    .select({
      id: connections.id,
      kind: connections.kind,
      label: connections.label,
      account: connections.account,
      status: connections.status,
      lastError: connections.lastError,
      lastSyncedAt: connections.lastSyncedAt,
    })
    .from(connections)
    .where(eq(connections.ownerId, ownerId))
    .orderBy(asc(connections.createdAt), asc(connections.id));
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const list = await db
    .select({
      connectionId: calendars.connectionId,
      id: calendars.id,
      name: calendars.name,
      color: calendars.color,
      shown: calendars.shown,
      truncated: calendars.truncated,
    })
    .from(calendars)
    .where(inArray(calendars.connectionId, ids))
    .orderBy(asc(calendars.name), asc(calendars.id));
  const byConnection = new Map<string, CalendarView[]>();
  for (const { connectionId, ...calendar } of list) {
    byConnection.set(connectionId, [...(byConnection.get(connectionId) ?? []), calendar]);
  }
  return rows.map((row) => ({
    ...row,
    account: maskAccount(row.account),
    calendars: byConnection.get(row.id) ?? [],
  }));
}

/** Removes a connection with its calendars and events. Returns what was removed, for revoking. */
export async function removeConnection(db: DbOrTx, ownerId: string, id: string) {
  const [removed] = await db
    .delete(connections)
    .where(and(eq(connections.id, id), eq(connections.ownerId, ownerId)))
    .returning({
      id: connections.id,
      kind: connections.kind,
      account: connections.account,
      secret: connections.secret,
    });
  return removed;
}

/** Renames a connection. False when it isn't the person's. */
export async function renameConnection(db: DbOrTx, ownerId: string, id: string, label: string) {
  if (!UUID.test(id)) return false;
  const rows = await db
    .update(connections)
    .set({ label, updatedAt: new Date() })
    .where(and(eq(connections.id, id), eq(connections.ownerId, ownerId)))
    .returning({ id: connections.id });
  return rows.length > 0;
}

/** After a new sign-in: the new secret, no problem shown, and a sync straight away. */
export async function reconnectConnection(
  db: DbOrTx,
  ownerId: string,
  id: string,
  update: { secret: string; account: string | null },
  now = new Date(),
) {
  const rows = await db
    .update(connections)
    .set({
      secret: update.secret,
      account: update.account,
      status: 'ok',
      lastError: null,
      failures: 0,
      nextSyncAt: now,
      updatedAt: now,
    })
    .where(and(eq(connections.id, id), eq(connections.ownerId, ownerId)))
    .returning({ id: connections.id });
  return rows.length > 0;
}

/**
 * Whether Care Hub syncs one of the person's connected calendars (chosen when connecting, and in
 * Settings). Hiding it drops its copies; showing it reads it in full, straight away. Returns the
 * calendar's connection, or undefined when the calendar isn't theirs.
 */
export async function setCalendarShown(
  db: Db,
  ownerId: string,
  calendarId: string,
  shown: boolean,
  now = new Date(),
): Promise<string | undefined> {
  if (!UUID.test(calendarId)) return undefined;
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select({ shown: calendars.shown, connectionId: calendars.connectionId })
      .from(calendars)
      .innerJoin(connections, eq(connections.id, calendars.connectionId))
      .where(and(eq(calendars.id, calendarId), eq(connections.ownerId, ownerId)))
      .for('update', { of: calendars });
    if (!before) return undefined;
    if (before.shown === shown) return before.connectionId;
    const reset = { cursor: null, lastFullSyncAt: null, truncated: false };
    await tx
      .update(calendars)
      .set({ shown, ...reset })
      .where(eq(calendars.id, calendarId));
    if (shown) {
      await tx
        .update(connections)
        .set({ nextSyncAt: now, updatedAt: now })
        .where(eq(connections.id, before.connectionId));
    } else await tx.delete(syncedEvents).where(eq(syncedEvents.calendarId, calendarId));
    return before.connectionId;
  });
}

/** The person's connection of this kind for this account, so signing in again reconnects it. */
export async function findConnectionByAccount(
  db: DbOrTx,
  input: { ownerId: string; kind: ConnectionKind; account: string },
): Promise<string | undefined> {
  const [row] = await db
    .select({ id: connections.id })
    .from(connections)
    .where(
      and(
        eq(connections.ownerId, input.ownerId),
        eq(connections.kind, input.kind),
        sql`lower(${connections.account}) = lower(${input.account})`,
      ),
    )
    .orderBy(asc(connections.createdAt))
    .limit(1);
  return row?.id;
}

/**
 * Whether any connection, anyone's, still uses this account. Ending a Google grant ends it for
 * every connection to that account, so it only ends when none is left.
 */
export async function isAccountConnected(db: DbOrTx, kind: ConnectionKind, account: string) {
  const [row] = await db
    .select({ id: connections.id })
    .from(connections)
    .where(and(eq(connections.kind, kind), sql`lower(${connections.account}) = lower(${account})`))
    .limit(1);
  return row !== undefined;
}
