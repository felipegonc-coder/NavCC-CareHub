// The notices tables, as Drizzle sees them. The SQL is in the migrations
// 202610270040_notices_notices.sql and 202610270440_notices_kinds-and-keys.sql, and
// store.test.ts checks that the two agree.
import { sql } from 'drizzle-orm';
import {
  bigserial,
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
  card: jsonb('card').$type<NoticeCard>(),
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
