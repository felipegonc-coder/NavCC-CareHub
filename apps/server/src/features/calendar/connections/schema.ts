import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import type { ExternalEvent } from '../sync/types';

// Mirrors migrations/202610271455_calendar_connections.sql, which is the source of truth. The
// foreign key to `users` is only in the SQL: features don't import each other's tables.

export const CONNECTION_KINDS = ['google', 'google-bridge', 'icloud', 'link'] as const;
export type ConnectionKind = (typeof CONNECTION_KINDS)[number];
export const CONNECTION_STATUSES = ['ok', 'needs-reconnect', 'error'] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];
/** The design kit's colour names, as `colorNames` in @carehub/ui. */
export const LAYER_COLORS = [
  'default',
  'gray',
  'brown',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'red',
] as const;
export type LayerColor = (typeof LAYER_COLORS)[number];
/** Where a calendar's next sync starts. Google: `{ syncToken }`; links: the reader's cursor. */
export type SyncCursor = Record<string, unknown>;

const at = (name: string) => timestamp(name, { withTimezone: true });

export const calendarConnections = pgTable(
  'cal_connections',
  {
    id: uuid('id').primaryKey(),
    ownerId: uuid('owner_id').notNull(),
    workspaceId: uuid('workspace_id'),
    kind: text('kind', { enum: CONNECTION_KINDS }).notNull(),
    label: text('label').notNull(),
    account: text('account'),
    /** Sealed (secrets.ts). Never sent to the browser. */
    secret: text('secret').notNull(),
    status: text('status', { enum: CONNECTION_STATUSES }).notNull().default('ok'),
    lastError: text('last_error'),
    lastSyncedAt: at('last_synced_at'),
    nextSyncAt: at('next_sync_at').notNull().defaultNow(),
    leaseUntil: at('lease_until'),
    failures: integer('failures').notNull().default(0),
    createdAt: at('created_at').notNull().defaultNow(),
    updatedAt: at('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('cal_connections_owner_idx').on(table.ownerId),
    index('cal_connections_due_idx').on(table.nextSyncAt),
  ],
);

export const calendarConnectionCalendars = pgTable(
  'cal_connection_calendars',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => calendarConnections.id, { onDelete: 'cascade' }),
    remoteId: text('remote_id').notNull(),
    name: text('name').notNull(),
    color: text('color', { enum: LAYER_COLORS }).notNull(),
    shown: boolean('shown').notNull().default(true),
    on: boolean('layer_on').notNull().default(true),
    order: integer('layer_order').notNull().default(100),
    timeZone: text('time_zone'),
    cursor: jsonb('cursor').$type<SyncCursor>(),
    lastFullSyncAt: at('last_full_sync_at'),
    truncated: boolean('truncated').notNull().default(false),
  },
  (table) => [unique('cal_connection_calendars_remote_key').on(table.connectionId, table.remoteId)],
);

export const calendarSyncedEvents = pgTable(
  'cal_synced_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    calendarId: uuid('calendar_id')
      .notNull()
      .references(() => calendarConnectionCalendars.id, { onDelete: 'cascade' }),
    remoteId: text('remote_id').notNull(),
    uid: text('uid').notNull(),
    version: text('version'),
    event: jsonb('event').$type<ExternalEvent>().notNull(),
    htmlLink: text('html_link'),
    startsAt: at('starts_at').notNull(),
    endsAt: at('ends_at'),
    readAt: at('read_at').notNull().defaultNow(),
  },
  (table) => [
    unique('cal_synced_events_remote_key').on(table.calendarId, table.remoteId),
    index('cal_synced_events_range_idx').on(table.calendarId, table.startsAt),
    index('cal_synced_events_uid_idx').on(table.calendarId, table.uid),
  ],
);

/**
 * Google sign-ins in progress (oauth-states.ts). Mirrors
 * migrations/202610271545_calendar_oauth_states.sql, which also keeps its foreign key to `users`.
 */
export const calendarOAuthStates = pgTable(
  'cal_oauth_states',
  {
    stateHash: text('state_hash').primaryKey(),
    ownerId: uuid('owner_id').notNull(),
    /** Hash of the signed-in session that started it. */
    sessionKey: text('session_key').notNull(),
    workspaceId: uuid('workspace_id'),
    /** Sealed. */
    codeVerifier: text('code_verifier').notNull(),
    connectionId: uuid('connection_id').references(() => calendarConnections.id, {
      onDelete: 'cascade',
    }),
    expiresAt: at('expires_at').notNull(),
  },
  (table) => [index('cal_oauth_states_expires_idx').on(table.expiresAt)],
);
