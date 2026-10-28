import {
  IMPORT_SOURCE_IDS,
  type ImportCounts,
  type ImportProblem,
  type ImportStatus,
} from '@carehub/extras/import-export/import/index';
import {
  bigint,
  boolean,
  customType,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

// Mirrors migrations/202610271700_import-export_imports.sql, which is the source of truth (a test
// compares them).

const at = (name: string) => timestamp(name, { withTimezone: true });
/** Postgres `bytea` as a Uint8Array (node-postgres reads it as a Buffer). */
const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => 'bytea',
  toDriver: (value) => Buffer.from(value.buffer, value.byteOffset, value.byteLength),
  fromDriver: (value) => new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
});

export const IMPORT_STATUSES = [
  'uploading',
  'waiting',
  'running',
  'done',
  'failed',
  'cancelled',
  'undone',
] as const satisfies readonly ImportStatus[];

export const ITEM_KINDS = ['page', 'database', 'row'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export const ieImports = pgTable('ie_imports', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  userId: uuid('user_id').notNull(),
  source: text('source', { enum: IMPORT_SOURCE_IDS }).notNull(),
  fileName: text('file_name').notNull(),
  fileSize: bigint('file_size', { mode: 'number' }).notNull(),
  pageId: uuid('page_id'),
  spaceId: uuid('space_id'),
  planned: boolean('planned').notNull().default(false),
  status: text('status', { enum: IMPORT_STATUSES }).notNull().default('uploading'),
  jobId: text('job_id'),
  counts: jsonb('counts').$type<ImportCounts>(),
  problems: jsonb('problems').$type<ImportProblem[]>().notNull().default([]),
  problemCount: integer('problem_count').notNull().default(0),
  error: text('error'),
  createdAt: at('created_at').notNull().defaultNow(),
  startedAt: at('started_at'),
  finishedAt: at('finished_at'),
  undoneAt: at('undone_at'),
});

export const ieImportUploads = pgTable('ie_import_uploads', {
  importId: uuid('import_id').primaryKey(),
  bytes: bytea('bytes').notNull(),
  createdAt: at('created_at').notNull().defaultNow(),
});

export const ieImportItems = pgTable(
  'ie_import_items',
  {
    importId: uuid('import_id').notNull(),
    pageId: uuid('page_id').notNull(),
    parentId: uuid('parent_id'),
    kind: text('kind', { enum: ITEM_KINDS }).notNull(),
    title: text('title').notNull().default(''),
    position: integer('position').notNull(),
  },
  (table) => [primaryKey({ columns: [table.importId, table.pageId] })],
);
