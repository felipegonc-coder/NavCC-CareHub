import { sql } from 'drizzle-orm';
import { boolean, date, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from '../auth/schema';

// Mirrors migrations/202610271140_knowledge_pages.sql, which is the source of truth (a test
// compares them).

const at = (name: string) => timestamp(name, { withTimezone: true });

export const kbBases = pgTable('kb_bases', {
  databaseId: uuid('database_id').primaryKey(),
  workspaceId: uuid('workspace_id').notNull(),
  defaultPeriod: text('default_period', { enum: ['1w', '30d', '90d', '6m', '1y', 'none'] })
    .notNull()
    .default('90d'),
  editingRemovesVerification: boolean('editing_removes_verification').notNull().default(false),
  createdAt: at('created_at').notNull().defaultNow(),
  updatedAt: at('updated_at').notNull().defaultNow(),
  updatedBy: uuid('updated_by').references(() => users.id),
});

export const kbPages = pgTable('kb_pages', {
  pageId: uuid('page_id').primaryKey(),
  databaseId: uuid('database_id')
    .notNull()
    .references(() => kbBases.databaseId, { onDelete: 'cascade' }),
  workspaceId: uuid('workspace_id').notNull(),
  status: text('status', { enum: ['draft', 'published'] })
    .notNull()
    .default('draft'),
  publishedBy: uuid('published_by').references(() => users.id),
  publishedAt: at('published_at'),
  owners: uuid('owners')
    .array()
    .notNull()
    .default(sql`'{}'`),
  verification: text('verification', { enum: ['verified', 'expired'] }),
  verifiedUntil: date('verified_until', { mode: 'string' }),
  expiredAt: at('expired_at'),
  updatedAt: at('updated_at').notNull().defaultNow(),
});

export type KbBase = typeof kbBases.$inferSelect;
export type KbPage = typeof kbPages.$inferSelect;
