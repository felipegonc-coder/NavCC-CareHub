import { customType, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Postgres `bytea` as a Uint8Array (node-postgres reads it as a Buffer). */
const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => 'bytea',
  toDriver: (value) => Buffer.from(value.buffer, value.byteOffset, value.byteLength),
  fromDriver: (value) => new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
});

/** One row per page: its Y.Doc state and the copies other features read. */
export const pageDocs = pgTable('page_docs', {
  pageId: uuid('page_id').primaryKey(),
  state: bytea('state').notNull(),
  markdown: text('markdown').notNull().default(''),
  text: text('text').notNull().default(''),
  textUpdatedAt: timestamp('text_updated_at', { withTimezone: true }).notNull().defaultNow(),
  blockCount: integer('block_count').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by'),
});
