import { CLAUDE_ERROR_REASONS, CLAUDE_FEATURES } from '@carehub/extras/claude';
import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from '../auth/schema';

// Mirrors migrations/202610271330_claude_usage.sql, which is the source of truth (schema.test.ts
// compares them).

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
