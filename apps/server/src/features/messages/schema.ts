import type { SystemEvent } from '@carehub/team-chat';
import { sql } from 'drizzle-orm';
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

// Mirrors migrations/202610271023_messages_chats.sql, the source of truth (schema.test.ts compares
// them). Foreign keys, checks and indexes are in the SQL only.

const time = (name: string) => timestamp(name, { withTimezone: true });

export const msgChats = pgTable('msg_chats', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  type: text('type').$type<'direct' | 'group'>().notNull(),
  name: text('name'),
  directKey: text('direct_key'),
  membersKey: text('members_key'),
  startedBy: uuid('started_by'),
  createdAt: time('created_at').notNull().defaultNow(),
  lastSeq: integer('last_seq').notNull().default(0),
  lastMessageAt: time('last_message_at').notNull().defaultNow(),
});

export const msgMembers = pgTable(
  'msg_members',
  {
    chatId: uuid('chat_id').notNull(),
    userId: uuid('user_id').notNull(),
    joinedAt: time('joined_at').notNull().defaultNow(),
    canRemoveOthers: boolean('can_remove_others').notNull().default(false),
    lastReadSeq: integer('last_read_seq').notNull().default(0),
    muted: boolean('muted').notNull().default(false),
    leftAt: time('left_at'),
  },
  (table) => [primaryKey({ columns: [table.chatId, table.userId] })],
);

export const msgMessages = pgTable('msg_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  chatId: uuid('chat_id').notNull(),
  seq: integer('seq').notNull(),
  kind: text('kind').$type<'message' | 'system'>().notNull(),
  senderId: uuid('sender_id'),
  clientId: uuid('client_id'),
  text: text('text').notNull().default(''),
  mentions: uuid('mentions')
    .array()
    .notNull()
    .default(sql`'{}'`),
  pageIds: text('page_ids')
    .array()
    .notNull()
    .default(sql`'{}'`),
  system: jsonb('system').$type<SystemEvent>(),
  createdAt: time('created_at').notNull().defaultNow(),
  editedAt: time('edited_at'),
  deletedAt: time('deleted_at'),
});

export type ChatRow = typeof msgChats.$inferSelect;
export type MemberRow = typeof msgMembers.$inferSelect;
export type MessageRow = typeof msgMessages.$inferSelect;
