import { customType, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Mirrors migrations/202610271015_search_entries.sql, which is the source of truth (a test
// compares them). Writes and searches use SQL (search.ts and indexer.ts).

const at = (name: string) => timestamp(name, { withTimezone: true });
const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

export const searchEntries = pgTable('search_entries', {
  pageId: uuid('page_id').primaryKey(),
  workspaceId: uuid('workspace_id').notNull(),
  spaceId: uuid('space_id'),
  parentId: uuid('parent_id'),
  ancestorIds: uuid('ancestor_ids').array().notNull().default([]),
  kind: text('kind', { enum: ['page', 'database', 'row'] }).notNull(),
  title: text('title').notNull().default(''),
  titleKey: text('title_key').notNull().default(''),
  icon: jsonb('icon'),
  body: text('body').notNull().default(''),
  extra: text('extra').notNull().default(''),
  docTsv: tsvector('doc_tsv').notNull(),
  createdBy: uuid('created_by'),
  createdAt: at('created_at').notNull(),
  updatedBy: uuid('updated_by'),
  updatedAt: at('updated_at').notNull(),
  archivedAt: at('archived_at'),
  trashedAt: at('trashed_at'),
  textSeenAt: at('text_seen_at'),
  indexedAt: at('indexed_at').notNull().defaultNow(),
});
