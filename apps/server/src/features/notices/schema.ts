// The notices tables, as Drizzle sees them. The SQL is in the migrations
// 202610270040_notices_notices.sql, 202610270440_notices_kinds-and-keys.sql,
// 202610271400_notices_extra-cards.sql and 202610271430_notices_settings.sql, and store.test.ts
// checks that the two agree.
import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type { NoticeButton, NoticeCard, NoticeKind } from './types';

export const notices = pgTable('notices_notices', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  userId: uuid('user_id').notNull(),
  /** Order in the chat; a grouped notice takes the next value again. */
  position: bigserial('position', { mode: 'number' }).notNull(),
  kind: text('kind').$type<NoticeKind>().notNull(),
  sender: text('sender').notNull(),
  actorUserId: uuid('actor_user_id'),
  icon: text('icon'),
  title: text('title').notNull(),
  body: text('body'),
  /** The first card; `extraCards` has the second and third. */
  card: jsonb('card').$type<NoticeCard>(),
  extraCards: jsonb('extra_cards')
    .$type<NoticeCard[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  buttons: jsonb('buttons')
    .$type<NoticeButton[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  groupKey: text('group_key'),
  groupCount: integer('group_count').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  latestAt: timestamp('latest_at', { withTimezone: true }).notNull().defaultNow(),
  readAt: timestamp('read_at', { withTimezone: true }),
});

export const noticeIdempotencyKeys = pgTable(
  'notices_idempotency_keys',
  {
    userId: uuid('user_id').notNull(),
    workspaceId: uuid('workspace_id').notNull(),
    key: text('key').notNull(),
    noticeId: uuid('notice_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.workspaceId, table.key] })],
);

/** Each person's notice settings in each workspace (Settings → Notifications). No row: all on. */
export const noticeSettings = pgTable(
  'notices_settings',
  {
    userId: uuid('user_id').notNull(),
    workspaceId: uuid('workspace_id').notNull(),
    comments: boolean('comments').notNull().default(true),
    edits: boolean('edits').notNull().default(true),
    formResponses: boolean('form_responses').notNull().default(true),
    automations: boolean('automations').notNull().default(true),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.workspaceId] })],
);
