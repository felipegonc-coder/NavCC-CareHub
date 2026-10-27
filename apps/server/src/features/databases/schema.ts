// Drizzle tables for databases and forms (decision 0200; the SQL is in
// migrations/202610270600_databases_tables.sql and the files after it). Read and write them
// through store.ts where it has a helper, so the version rule and the page joins stay in one place.
import type {
  Id,
  Property,
  RichText,
  RowAccessRule,
  RowPageLayout,
  RowTemplate,
  View,
} from '@carehub/databases';
import { boolean, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type {
  DeletedProperty,
  DependencySettings,
  SubItemSettings,
  TypeChangeSettings,
} from './record';

const at = (name: string) => timestamp(name, { withTimezone: true });

// Indexes and foreign keys are in the migration only.
export const dbDatabases = pgTable('db_databases', {
  pageId: uuid('page_id').primaryKey(),
  workspaceId: uuid('workspace_id').notNull(),
  description: jsonb('description').$type<RichText>().notNull().default([]),
  properties: jsonb('properties').$type<Property[]>().notNull().default([]),
  views: jsonb('views').$type<View[]>().notNull().default([]),
  templates: jsonb('templates').$type<RowTemplate[]>().notNull().default([]),
  accessRules: jsonb('access_rules').$type<RowAccessRule[]>().notNull().default([]),
  defaultTemplateId: text('default_template_id'),
  locked: boolean('locked').notNull().default(false),
  rowPageLayout: jsonb('row_page_layout').$type<RowPageLayout>(),
  subItems: jsonb('sub_items').$type<SubItemSettings>(),
  dependencies: jsonb('dependencies').$type<DependencySettings>(),
  deletedProperties: jsonb('deleted_properties').$type<DeletedProperty[]>().notNull().default([]),
  nextUniqueNumber: integer('next_unique_number').notNull().default(1),
  version: integer('version').notNull().default(1),
  createdAt: at('created_at').notNull().defaultNow(),
  updatedAt: at('updated_at').notNull().defaultNow(),
});

/** Type changes kept 10 minutes for Undo (migrations/202610270700_databases_type_changes.sql). */
export const dbTypeChanges = pgTable('db_type_changes', {
  id: uuid('id').primaryKey().defaultRandom(),
  databaseId: uuid('database_id').notNull(),
  propertyId: text('property_id').notNull(),
  changedBy: uuid('changed_by').notNull(),
  changedAt: at('changed_at').notNull().defaultNow(),
  property: jsonb('property').$type<Property>().notNull(),
  values: jsonb('values').$type<Record<string, unknown>>().notNull().default({}),
  settings: jsonb('settings').$type<TypeChangeSettings>().notNull().default({}),
});

export const dbRows = pgTable('db_rows', {
  pageId: uuid('page_id').primaryKey(),
  databaseId: uuid('database_id').notNull(),
  workspaceId: uuid('workspace_id').notNull(),
  values: jsonb('values').$type<Partial<Record<Id, unknown>>>().notNull().default({}),
  uniqueNumber: integer('unique_number'),
  /** null: an anonymous form response. */
  createdBy: uuid('created_by'),
  createdAt: at('created_at').notNull().defaultNow(),
  editedBy: uuid('edited_by'),
  editedAt: at('edited_at').notNull().defaultNow(),
  formViewId: text('form_view_id'),
  importId: uuid('import_id'),
});

export const dbRowChanges = pgTable('db_row_changes', {
  id: uuid('id').primaryKey().defaultRandom(),
  rowId: uuid('row_id').notNull(),
  databaseId: uuid('database_id').notNull(),
  at: at('at').notNull().defaultNow(),
  by: uuid('by'),
  propertyId: text('property_id').notNull(),
  before: jsonb('before'),
  after: jsonb('after'),
});

export const dbImports = pgTable('db_imports', {
  id: uuid('id').primaryKey().defaultRandom(),
  databaseId: uuid('database_id').notNull(),
  by: uuid('by'),
  uploadId: uuid('upload_id'),
  status: text('status').notNull(),
  rowCount: integer('row_count').notNull().default(0),
  problems: jsonb('problems').$type<unknown[]>().notNull().default([]),
  createdAt: at('created_at').notNull().defaultNow(),
  undoneAt: at('undone_at'),
});

export const dbButtonRuns = pgTable('db_button_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  databaseId: uuid('database_id').notNull(),
  rowId: uuid('row_id'),
  propertyId: text('property_id').notNull(),
  by: uuid('by'),
  at: at('at').notNull().defaultNow(),
  outcome: text('outcome').notNull(),
  changes: jsonb('changes').$type<unknown[]>().notNull().default([]),
});

export const dbRepeatState = pgTable('db_repeat_state', {
  templateId: text('template_id').primaryKey(),
  databaseId: uuid('database_id').notNull(),
  nextRunAt: at('next_run_at'),
  lastRunAt: at('last_run_at'),
  pausedReason: text('paused_reason'),
});

export const dbReminders = pgTable('db_reminders', {
  id: uuid('id').primaryKey().defaultRandom(),
  rowId: uuid('row_id').notNull(),
  propertyId: text('property_id').notNull(),
  fireAt: at('fire_at').notNull(),
  sentAt: at('sent_at'),
});

export const formsLinks = pgTable('forms_links', {
  code: text('code').primaryKey(),
  databaseId: uuid('database_id').notNull(),
  viewId: text('view_id').notNull(),
  createdAt: at('created_at').notNull().defaultNow(),
  revokedAt: at('revoked_at'),
});
