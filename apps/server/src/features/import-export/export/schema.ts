import {
  bigint,
  customType,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from '../../auth/schema';

// Mirrors migrations/202610271300_import-export_exports.sql, which is the source of truth (a test
// compares them).

const at = (name: string) => timestamp(name, { withTimezone: true });

/** Postgres `bytea` as a Buffer. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

export const EXPORT_FORMATS = ['markdown', 'html'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
export const EXPORT_STATUSES = ['running', 'ready', 'failed', 'expired'] as const;
export type ExportStatus = (typeof EXPORT_STATUSES)[number];

export interface ExportOptions {
  includeSubpages: boolean;
  includeFiles: boolean;
  databases: 'view' | 'all';
  viewId?: string;
  /** Where Care Hub links in the files point, such as `https://care.example.org`. */
  origin: string;
}

export const ieExports = pgTable('ie_exports', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  pageId: uuid('page_id').notNull(),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  format: text('format', { enum: EXPORT_FORMATS }).notNull(),
  options: jsonb('options').$type<ExportOptions>().notNull(),
  status: text('status', { enum: EXPORT_STATUSES }).notNull().default('running'),
  jobId: text('job_id'),
  progressDone: integer('progress_done').notNull().default(0),
  progressTotal: integer('progress_total'),
  pageCount: integer('page_count'),
  skippedCount: integer('skipped_count'),
  fileName: text('file_name'),
  file: bytea('file'),
  sizeBytes: bigint('size_bytes', { mode: 'number' }),
  error: text('error'),
  createdAt: at('created_at').notNull().defaultNow(),
  finishedAt: at('finished_at'),
  expiresAt: at('expires_at'),
  downloadedAt: at('downloaded_at'),
  downloadCount: integer('download_count').notNull().default(0),
});

export type ExportRow = typeof ieExports.$inferSelect;
