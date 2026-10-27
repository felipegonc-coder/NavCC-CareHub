// Storage for calendar connections and their calendars (Calendar spec, Connections). Everything
// is scoped to the owner: no one else, admins included, reads or changes a connection (RP-D1).
// Views for screens never include the sealed secret.
import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Db, Tx } from '../../../db';
import {
  type ConnectionKind,
  type ConnectionStatus,
  type LayerColor,
  LAYER_COLORS,
  calendarConnectionCalendars as calendars,
  calendarConnections as connections,
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
export const connectionSecretContext = (connectionId: string) =>
  `calendar-connection:${connectionId}`;

/** New calendars take these in turn (the kit's colours from blue on, then gray to green). */
export const CALENDAR_COLORS: readonly LayerColor[] = [
  ...LAYER_COLORS.slice(6),
  ...LAYER_COLORS.slice(1, 6),
];

/** Colours for `count` new calendars of this person, continuing after their other calendars. */
export async function nextColors(db: DbOrTx, ownerId: string, count: number) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(calendars)
    .innerJoin(connections, eq(connections.id, calendars.connectionId))
    .where(eq(connections.ownerId, ownerId));
  const used = row?.n ?? 0;
  return Array.from(
    { length: count },
    (_, i) => CALENDAR_COLORS[(used + i) % CALENDAR_COLORS.length] ?? 'blue',
  );
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
    const colors = await nextColors(tx, input.ownerId, input.calendars.length);
    await tx.insert(calendars).values(
      input.calendars.map((calendar, i) => ({
        connectionId: input.id,
        remoteId: calendar.remoteId,
        name: calendar.name,
        color: calendar.color ?? colors[i] ?? 'blue',
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
    .where(
      inArray(
        calendars.connectionId,
        rows.map((row) => row.id),
      ),
    )
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

export type ConnectionRow = typeof connections.$inferSelect;
export type CalendarRow = typeof calendars.$inferSelect;

/** One connection with its sealed secret and calendars, or undefined (not theirs, or gone). */
export async function loadConnection(
  db: DbOrTx,
  id: string,
  ownerId?: string,
): Promise<{ connection: ConnectionRow; calendars: CalendarRow[] } | undefined> {
  const owned = ownerId === undefined ? undefined : eq(connections.ownerId, ownerId);
  const [connection] = await db
    .select()
    .from(connections)
    .where(and(eq(connections.id, id), owned));
  if (!connection) return undefined;
  const list = await db
    .select()
    .from(calendars)
    .where(eq(calendars.connectionId, id))
    .orderBy(asc(calendars.name), asc(calendars.id));
  return { connection, calendars: list };
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
