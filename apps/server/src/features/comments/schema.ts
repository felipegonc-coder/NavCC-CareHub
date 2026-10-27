import { COMMENT_SPOTS } from '@carehub/shared';
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from '../auth/schema';

// Mirrors migrations/202610270625_comments_threads.sql, which is the source of truth (a test
// compares them).

const at = (name: string) => timestamp(name, { withTimezone: true });

export const commentThreads = pgTable('comment_threads', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  pageId: uuid('page_id').notNull(),
  spot: text('spot', { enum: COMMENT_SPOTS }).notNull(),
  blockId: text('block_id'),
  propertyId: text('property_id'),
  quote: text('quote'),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: at('created_at').notNull().defaultNow(),
  lastCommentAt: at('last_comment_at').notNull().defaultNow(),
  resolvedAt: at('resolved_at'),
  resolvedBy: uuid('resolved_by').references(() => users.id),
});

export const comments = pgTable('comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  threadId: uuid('thread_id')
    .notNull()
    .references(() => commentThreads.id, { onDelete: 'cascade' }),
  authorId: uuid('author_id')
    .notNull()
    .references(() => users.id),
  body: text('body').notNull(),
  createdAt: at('created_at').notNull().defaultNow(),
  editedAt: at('edited_at'),
  deletedAt: at('deleted_at'),
  deletedBy: uuid('deleted_by').references(() => users.id),
});

export type CommentThread = typeof commentThreads.$inferSelect;
export type Comment = typeof comments.$inferSelect;
