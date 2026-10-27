// Test support only; no production code imports this. A SyncStore in memory for the sync
// engine's tests, with the same rules as pgSyncStore (its own tests run against Postgres).
import type { ConnectionKind, ConnectionStatus, LayerColor, SyncCursor } from './schema';
import type { SyncCalendar, SyncConnection, SyncStore, SyncedEventInput } from './sync-store';

const LEASE_MS = 10 * 60_000;
const COLORS: LayerColor[] = ['blue', 'green', 'orange', 'purple', 'pink', 'yellow', 'red'];

export interface MemoryConnection extends SyncConnection {
  nextSyncAt: Date;
  leaseUntil: Date | null;
}
export interface MemoryCalendar extends SyncCalendar {
  connectionId: string;
  color: LayerColor;
}
export interface MemoryEvent extends SyncedEventInput {
  version: string;
}

export function createMemorySyncStore() {
  const connections = new Map<string, MemoryConnection>();
  const calendars = new Map<string, MemoryCalendar>();
  const events = new Map<string, Map<string, MemoryEvent>>();
  let ids = 0;
  const newId = (prefix: string) => `${prefix}-${(ids += 1)}`;

  const calendarsOf = (connectionId: string) =>
    [...calendars.values()]
      .filter((calendar) => calendar.connectionId === connectionId)
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const view = (c: MemoryCalendar): SyncCalendar => ({
    id: c.id,
    remoteId: c.remoteId,
    name: c.name,
    shown: c.shown,
    timeZone: c.timeZone,
    cursor: c.cursor,
    lastFullSyncAt: c.lastFullSyncAt,
  });
  const eventsOf = (calendarId: string) => {
    const map = events.get(calendarId) ?? new Map<string, MemoryEvent>();
    events.set(calendarId, map);
    return map;
  };
  const leaseFree = (connection: MemoryConnection, now: Date) =>
    !connection.leaseUntil || connection.leaseUntil < now;
  const shown = (calendarId: string) => calendars.get(calendarId)?.shown === true;
  const withVersion = (input: SyncedEventInput): MemoryEvent => ({
    ...structuredClone(input),
    version: input.version ?? JSON.stringify(input.event),
  });

  const store: SyncStore = {
    async claimDue(now, limit) {
      const due = [...connections.values()]
        .filter((c) => c.nextSyncAt <= now && c.status !== 'needs-reconnect' && leaseFree(c, now))
        .sort((a, b) => a.nextSyncAt.getTime() - b.nextSyncAt.getTime())
        .slice(0, limit);
      for (const connection of due) connection.leaseUntil = new Date(now.getTime() + LEASE_MS);
      return due.map((connection) => connection.id);
    },
    async claim({ id, ownerId, now, unlessSyncedAfter: fresh }) {
      const connection = connections.get(id);
      if (!connection || connection.ownerId !== ownerId || !leaseFree(connection, now))
        return false;
      if (fresh) {
        if (connection.status === 'needs-reconnect') return false;
        const stale =
          connection.status === 'ok' &&
          (!connection.lastSyncedAt || connection.lastSyncedAt < fresh);
        if (connection.nextSyncAt > now && !stale) return false;
      }
      connection.leaseUntil = new Date(now.getTime() + LEASE_MS);
      return true;
    },
    async load(id) {
      const connection = connections.get(id);
      if (!connection) return undefined;
      const { ownerId, ownerEmail, workspaceId, kind, label, account, secret } = connection;
      const { status, lastError, failures, lastSyncedAt } = connection;
      return {
        connection: {
          id,
          ownerId,
          ownerEmail,
          workspaceId,
          kind,
          label,
          account,
          secret,
          status,
          lastError,
          failures,
          lastSyncedAt,
        },
        calendars: calendarsOf(id).map(view),
      };
    },
    async saveCalendarList(connectionId, remote) {
      if (!connections.has(connectionId)) return [];
      const wanted = new Set(remote.map((calendar) => calendar.remoteId));
      for (const calendar of calendarsOf(connectionId)) {
        if (!wanted.has(calendar.remoteId)) {
          calendars.delete(calendar.id);
          events.delete(calendar.id);
        }
      }
      const mine = calendarsOf(connectionId);
      for (const outside of remote) {
        const known = mine.find((calendar) => calendar.remoteId === outside.remoteId);
        const name = [...outside.name].slice(0, 200).join('') || 'Calendar';
        if (known) Object.assign(known, { name, timeZone: outside.timeZone ?? null });
        else {
          const id = newId('calendar');
          const color = COLORS[calendars.size % COLORS.length] ?? 'blue';
          calendars.set(id, {
            id,
            connectionId,
            remoteId: outside.remoteId,
            name,
            color,
            shown: outside.shown,
            timeZone: outside.timeZone ?? null,
            cursor: null,
            lastFullSyncAt: null,
          });
        }
      }
      return calendarsOf(connectionId).map(view);
    },
    async replaceEvents(calendarId, inputs, cursor, now) {
      if (!shown(calendarId)) return { changed: false };
      const before = eventsOf(calendarId);
      const after = new Map(inputs.map((input) => [input.remoteId, withVersion(input)]));
      const changed =
        before.size !== after.size ||
        [...after.values()].some((row) => before.get(row.remoteId)?.version !== row.version);
      if (changed) events.set(calendarId, after);
      Object.assign(calendars.get(calendarId) ?? {}, { cursor, lastFullSyncAt: now });
      return { changed };
    },
    async applyChanges(calendarId, { upserts, removed }, cursor) {
      if (!shown(calendarId)) return { changed: false };
      const rows = eventsOf(calendarId);
      let changed = false;
      const series = new Set(
        removed.flatMap((id) => {
          const row = rows.get(id);
          return row && !row.event.recurrenceId ? [row.event.uid] : [];
        }),
      );
      for (const [remoteId, row] of rows) {
        if (removed.includes(remoteId) || series.has(row.event.uid)) {
          rows.delete(remoteId);
          changed = true;
        }
      }
      for (const input of upserts) {
        const row = withVersion(input);
        if (rows.get(row.remoteId)?.version === row.version) continue;
        rows.set(row.remoteId, row);
        changed = true;
      }
      Object.assign(calendars.get(calendarId) ?? {}, { cursor });
      return { changed };
    },
    async finish(id, startedWith, outcome) {
      const connection = connections.get(id);
      if (!connection) return false;
      connection.leaseUntil = null;
      if (connection.secret !== startedWith) return false;
      Object.assign(connection, {
        status: outcome.status,
        lastError: outcome.lastError,
        failures: outcome.failures,
        nextSyncAt: outcome.nextSyncAt,
        ...(outcome.syncedAt ? { lastSyncedAt: outcome.syncedAt } : {}),
        ...(outcome.secret ? { secret: outcome.secret } : {}),
      });
      return true;
    },
  };

  return {
    store,
    /** A connection that is due now. Calendars come from the first sync unless given. */
    addConnection(input: {
      id?: string;
      ownerId: string;
      ownerEmail?: string;
      workspaceId?: string | null;
      kind: ConnectionKind;
      label?: string;
      account?: string | null;
      secret: string;
      status?: ConnectionStatus;
      nextSyncAt?: Date;
      calendars?: { remoteId: string; name: string; shown: boolean; cursor?: SyncCursor }[];
    }) {
      const id = input.id ?? newId('connection');
      connections.set(id, {
        id,
        ownerId: input.ownerId,
        ownerEmail: input.ownerEmail ?? 'avery.lin@example.com',
        workspaceId: input.workspaceId === undefined ? 'workspace-1' : input.workspaceId,
        kind: input.kind,
        label: input.label ?? (input.kind === 'link' ? 'School' : 'Google'),
        account: input.account ?? null,
        secret: input.secret,
        status: input.status ?? 'ok',
        failures: 0,
        lastSyncedAt: null,
        nextSyncAt: input.nextSyncAt ?? new Date(0),
        leaseUntil: null,
        lastError: null,
      });
      for (const calendar of input.calendars ?? []) {
        const calendarId = newId('calendar');
        calendars.set(calendarId, {
          id: calendarId,
          connectionId: id,
          remoteId: calendar.remoteId,
          name: calendar.name,
          color: 'blue',
          shown: calendar.shown,
          timeZone: null,
          cursor: calendar.cursor ?? null,
          lastFullSyncAt: null,
        });
      }
      return id;
    },
    connection: (id: string) => connections.get(id),
    /** Changes a connection as another request would (a new sign-in, a lease, a due time). */
    update(id: string, changes: Partial<MemoryConnection>) {
      Object.assign(connections.get(id) ?? {}, changes);
    },
    calendarsOf,
    /** The person shows or hides a calendar. Hiding drops its copies and where to start from. */
    setShown(calendarId: string, value: boolean) {
      const calendar = calendars.get(calendarId);
      if (!calendar) return;
      calendar.shown = value;
      if (!value) {
        events.delete(calendarId);
        Object.assign(calendar, { cursor: null, lastFullSyncAt: null });
      }
    },
    eventsOf: (calendarId: string) => [...eventsOf(calendarId).values()],
  };
}
export type MemorySyncStore = ReturnType<typeof createMemorySyncStore>;
