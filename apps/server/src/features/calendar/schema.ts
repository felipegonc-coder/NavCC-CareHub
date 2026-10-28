import type { Reply } from '@carehub/team-calendar-api';
import type { OccurrenceKey, Override, RepeatRule } from '@carehub/team-repeat';
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type { EventFields } from './events/model';
import type { StoredReply } from './events/items';
import type { StoredKind } from './layers/model';

// Mirrors migrations/202610271200_calendar_events.sql, 202610271300_calendar_layers.sql and
// 202610271400_calendar_settings.sql, the source of truth. Foreign keys to users and
// workspaces are only in the SQL: other features' tables aren't imported (0007, section 2.2).

const at = (name: string) => timestamp(name, { withTimezone: true });

export const calEvents = pgTable('cal_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  organizerId: uuid('organizer_id').notNull(),
  title: text('title').notNull().default(''),
  description: text('description').notNull().default(''),
  location: text('location').notNull().default(''),
  videoUrl: text('video_url'),
  allDay: boolean('all_day').notNull(),
  timeZone: text('time_zone').notNull(),
  start: text('start_civil').notNull(),
  end: text('end_civil').notNull(),
  rule: jsonb('repeat_rule').$type<RepeatRule>(),
  exceptions: jsonb('exceptions').$type<OccurrenceKey[]>().notNull().default([]),
  overrides: jsonb('overrides')
    .$type<Record<OccurrenceKey, Override<EventFields>>>()
    .notNull()
    .default({}),
  rangeStart: at('range_start').notNull(),
  rangeEnd: at('range_end'),
  notesPageId: uuid('notes_page_id'),
  createdAt: at('created_at').notNull().defaultNow(),
  updatedAt: at('updated_at').notNull().defaultNow(),
  cancelledAt: at('cancelled_at'),
});

export const calEventPeople = pgTable(
  'cal_event_people',
  {
    eventId: uuid('event_id')
      .notNull()
      .references(() => calEvents.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    reply: text('reply').$type<Reply>(),
    note: text('note'),
    occurrenceReplies: jsonb('occurrence_replies')
      .$type<Record<OccurrenceKey, StoredReply>>()
      .notNull()
      .default({}),
    invitedAt: at('invited_at').notNull().defaultNow(),
    repliedAt: at('replied_at'),
  },
  (table) => [primaryKey({ columns: [table.eventId, table.userId] })],
);

export const calLayers = pgTable(
  'cal_layers',
  {
    workspaceId: uuid('workspace_id').notNull(),
    userId: uuid('user_id').notNull(),
    id: text('id').notNull(),
    kind: text('kind').$type<StoredKind>().notNull(),
    color: text('color').notNull(),
    on: boolean('is_on').notNull().default(true),
    order: integer('position').notNull(),
    databaseId: text('database_id'),
    propertyId: text('property_id'),
    viewId: text('view_id'),
    createdAt: at('created_at').notNull().defaultNow(),
    updatedAt: at('updated_at').notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.userId, table.id] })],
);

export const calSettings = pgTable(
  'cal_settings',
  {
    workspaceId: uuid('workspace_id').notNull(),
    userId: uuid('user_id').notNull(),
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    updatedAt: at('updated_at').notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.userId] })],
);
