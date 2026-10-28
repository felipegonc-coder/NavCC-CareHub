import { ASSISTANT_SCOPES, type AssistantPageLink } from '@carehub/extras/claude/assistant';
import { integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { users } from '../../auth/schema';

// Mirrors migrations/202610271600_claude_chats.sql, which is the source of truth (assistant.test.ts
// compares them).

export const claudeChats = pgTable('claude_chats', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  questions: integer('questions').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const CLAUDE_MESSAGE_ROLES = ['question', 'answer'] as const;

export const claudeMessages = pgTable(
  'claude_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chatId: uuid('chat_id')
      .notNull()
      .references(() => claudeChats.id, { onDelete: 'cascade' }),
    turn: integer('turn').notNull(),
    role: text('role', { enum: CLAUDE_MESSAGE_ROLES }).notNull(),
    text: text('text').notNull(),
    scope: text('scope', { enum: ASSISTANT_SCOPES }),
    pages: jsonb('pages').$type<AssistantPageLink[]>().notNull().default([]),
    sources: jsonb('sources').$type<AssistantPageLink[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique().on(table.chatId, table.turn, table.role)],
);
