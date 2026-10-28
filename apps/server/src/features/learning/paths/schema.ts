import { sql } from 'drizzle-orm';
import { index, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Mirrors migrations/202610271400_learning_paths.sql, which is the source of truth (schema.test.ts
// compares them).

const at = (name: string) => timestamp(name, { withTimezone: true }).notNull().defaultNow();

/** One learning path in a workspace: its courses in order, and whether that order is required. */
export const learningPaths = pgTable(
  'learning_paths',
  {
    workspaceId: uuid('workspace_id').notNull(),
    id: text('id').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    courseIds: text('course_ids')
      .array()
      .notNull()
      .default(sql`'{}'`),
    order: text('course_order').$type<'sequential' | 'free'>().notNull().default('sequential'),
    createdBy: uuid('created_by').notNull(),
    createdAt: at('created_at'),
    updatedBy: uuid('updated_by').notNull(),
    updatedAt: at('updated_at'),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.id] }),
    index('learning_paths_course_ids_idx').using('gin', table.courseIds),
  ],
);
