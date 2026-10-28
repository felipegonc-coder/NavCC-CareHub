import { CLAUDE_ERROR_REASONS, CLAUDE_FEATURES } from '@carehub/extras/claude';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from '../auth/schema';

// Mirrors migrations/202610271330_claude_usage.sql, 202610271400_claude_settings.sql,
// 202610271600_claude_fields.sql and 202610271630_claude_field_queue.sql, which are the source of
// truth (the tests in server/ compare them).

/** 'ok', or why a request that was sent failed. */
export const CLAUDE_USAGE_STATUSES = ['ok', ...CLAUDE_ERROR_REASONS] as const;
export type ClaudeUsageStatus = (typeof CLAUDE_USAGE_STATUSES)[number];

/** One row per request sent to Claude. Never any prompt or answer text. */
export const claudeUsage = pgTable('claude_usage', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  feature: text('feature', { enum: CLAUDE_FEATURES }).notNull(),
  status: text('status', { enum: CLAUDE_USAGE_STATUSES }).notNull(),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** stand-in for workspace settings: claude.workspaceApproved, claude.<feature> and more. */
export const claudeSettings = pgTable(
  'claude_settings',
  {
    workspaceId: uuid('workspace_id').notNull(),
    key: text('key').notNull(),
    value: jsonb('value').notNull(),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.key] })],
);

/** A Claude field's request: answered, or sent and failed. */
export const CLAUDE_FIELD_FILL_STATUSES = ['ok', 'failed'] as const;

/** One row per request a Claude field sent, for each database's hourly cap. Never any text. */
export const claudeFieldFills = pgTable(
  'claude_field_fills',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull(),
    databaseId: uuid('database_id').notNull(),
    propertyId: text('property_id').notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    auto: boolean('auto').notNull(),
    status: text('status', { enum: CLAUDE_FIELD_FILL_STATUSES }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('claude_field_fills_database_idx').on(table.databaseId, table.createdAt)],
);

/** Rows waiting to fill: By hand for `requestedBy`, or automatically (`auto`) as the field's owner. */
export const claudeFieldQueue = pgTable(
  'claude_field_queue',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull(),
    databaseId: uuid('database_id').notNull(),
    propertyId: text('property_id').notNull(),
    rowId: uuid('row_id').notNull(),
    auto: boolean('auto').notNull(),
    requestedBy: uuid('requested_by').references(() => users.id, { onDelete: 'cascade' }),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    attempts: integer('attempts').notNull().default(0),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    uniqueIndex('claude_field_queue_row_idx').on(table.databaseId, table.propertyId, table.rowId),
    index('claude_field_queue_due_idx').on(table.dueAt),
    index('claude_field_queue_requested_idx').on(table.requestedBy),
  ],
);
