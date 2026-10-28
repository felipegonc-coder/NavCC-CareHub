import {
  customType,
  date,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

// Mirrors migrations/202610271015_search_entries.sql and 202610271415_search_recent.sql, which are
// the source of truth (tests compare them). Reads and writes use SQL.

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

/** Postgres `bytea`. */
const bytea = customType<{ data: Uint8Array }>({ dataType: () => 'bytea' });

export const searchRecent = pgTable('search_recent', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  workspaceId: uuid('workspace_id').notNull(),
  text: text('text').notNull(),
  filters: jsonb('filters').notNull().default({}),
  searchedAt: at('searched_at').notNull().defaultNow(),
});

export const searchVisits = pgTable(
  'search_visits',
  {
    userId: uuid('user_id').notNull(),
    pageId: uuid('page_id').notNull(),
    workspaceId: uuid('workspace_id').notNull(),
    openedAt: at('opened_at').notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.pageId] })],
);

export const searchTerms = pgTable(
  'search_terms',
  {
    workspaceId: uuid('workspace_id').notNull(),
    day: date('day').notNull(),
    term: text('term').notNull(),
    searches: integer('searches').notNull().default(0),
    people: integer('people').notNull().default(0),
    noResults: integer('no_results').notNull().default(0),
    opened: integer('opened').notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.day, table.term] })],
);

export const searchTermKeys = pgTable('search_term_keys', {
  day: date('day').primaryKey(),
  key: bytea('key').notNull(),
});

export const searchTermPeople = pgTable(
  'search_term_people',
  { day: date('day').notNull(), personHash: bytea('person_hash').notNull() },
  (table) => [primaryKey({ columns: [table.day, table.personHash] })],
);
