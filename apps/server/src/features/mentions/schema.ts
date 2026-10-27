import { MENTION_STATUSES } from '@carehub/shared';
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from '../auth/schema';
import { comments } from '../comments/schema';

// Mirrors migrations/202610270730_mentions_people.sql, which is the source of truth (a test
// compares them).

const at = (name: string) => timestamp(name, { withTimezone: true });

export const mentions = pgTable('mentions', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  pageId: uuid('page_id').notNull(),
  blockId: text('block_id'),
  commentId: uuid('comment_id').references(() => comments.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  mentionedBy: uuid('mentioned_by')
    .notNull()
    .references(() => users.id),
  snippet: text('snippet').notNull().default(''),
  status: text('status', { enum: MENTION_STATUSES }).notNull(),
  sendAt: at('send_at'),
  sentAt: at('sent_at'),
  noticeId: uuid('notice_id'),
  createdAt: at('created_at').notNull().defaultNow(),
});

export type Mention = typeof mentions.$inferSelect;
