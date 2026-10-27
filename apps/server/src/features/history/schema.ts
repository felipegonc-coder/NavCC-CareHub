import { UPDATE_KINDS, VERSION_KINDS, type HistoryDoc } from '@carehub/extras/history';
import { integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { UpdateDetails } from './updates';

// Mirrors migrations/202610271345_history_versions.sql, 202610271400_history_restores.sql and
// 202610271700_history_updates.sql, which are the source of truth (a test compares them).

const at = (name: string) => timestamp(name, { withTimezone: true });

export const historyVersions = pgTable('history_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  pageId: uuid('page_id').notNull(),
  workspaceId: uuid('workspace_id').notNull(),
  kind: text('kind', { enum: VERSION_KINDS }).notNull(),
  name: text('name'),
  namedBy: uuid('named_by'),
  namedAt: at('named_at'),
  editorIds: uuid('editor_ids').array().notNull().default([]),
  createdBy: uuid('created_by'),
  createdAt: at('created_at').notNull().defaultNow(),
  title: text('title').notNull().default(''),
  icon: jsonb('icon'),
  cover: jsonb('cover'),
  style: jsonb('style').$type<Record<string, unknown>>().notNull().default({}),
  content: jsonb('content').$type<HistoryDoc>().notNull(),
  digest: text('digest').notNull(),
  size: integer('size').notNull(),
  restoredVersionId: uuid('restored_version_id'),
  restoredFrom: at('restored_from'),
});

export const historyEdits = pgTable('history_edits', {
  pageId: uuid('page_id').primaryKey(),
  firstAt: at('first_at'),
  lastAt: at('last_at'),
  editorIds: uuid('editor_ids').array().notNull().default([]),
  settledAt: at('settled_at'),
});

export const historyUpdates = pgTable('history_updates', {
  id: uuid('id').primaryKey().defaultRandom(),
  pageId: uuid('page_id').notNull(),
  workspaceId: uuid('workspace_id').notNull(),
  kind: text('kind', { enum: UPDATE_KINDS }).notNull(),
  actorId: uuid('actor_id'),
  details: jsonb('details').$type<UpdateDetails>().notNull().default({}),
  versionId: uuid('version_id'),
  createdAt: at('created_at').notNull().defaultNow(),
});
