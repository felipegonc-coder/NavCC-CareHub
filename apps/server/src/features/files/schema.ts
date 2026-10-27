import { bigint, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Mirrors migrations/202610270130_files_files.sql, which is the source of truth (a test compares them).

export const files = pgTable('files', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  /** The feature that decides who may open the file (registerFileScope), and its own ID there. */
  scopeFeature: text('scope_feature').notNull(),
  scopeId: text('scope_id').notNull(),
  /** Null once the person's account is deleted. */
  uploadedBy: uuid('uploaded_by'),
  name: text('name').notNull(),
  /** Found from the contents. */
  mimeType: text('mime_type').notNull(),
  size: bigint('size', { mode: 'number' }).notNull(),
  /** Pictures only: pixels as shown. */
  width: integer('width'),
  height: integer('height'),
  /** Hex SHA-256 of the stored bytes; also the ETag. */
  sha256: text('sha256').notNull(),
  /** The bytes are at FILES_DIR/<first 2>/<next 2>/<storageKey>. */
  storageKey: uuid('storage_key').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});
