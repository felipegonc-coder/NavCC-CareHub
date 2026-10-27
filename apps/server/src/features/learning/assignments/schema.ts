import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

// Mirrors migrations/202610270455_learning_assignments.sql, the source of truth (store.test.ts
// compares them).

/** Which people and groups must take a course, and by when. */
export const learningAssignments = pgTable('learning_assignments', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  courseId: text('course_id').notNull(),
  pathId: text('path_id'),
  userIds: uuid('user_ids')
    .array()
    .notNull()
    .default(sql`'{}'`),
  groupIds: text('group_ids')
    .array()
    .notNull()
    .default(sql`'{}'`),
  dueDate: date('due_date', { mode: 'string' }),
  dueInDays: integer('due_in_days'),
  required: boolean('required').notNull().default(true),
  createdBy: uuid('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** The day each person got an assignment that is due a number of days later. */
export const learningAssignmentLearners = pgTable(
  'learning_assignment_learners',
  {
    assignmentId: uuid('assignment_id')
      .notNull()
      .references(() => learningAssignments.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    since: date('since', { mode: 'string' }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.assignmentId, table.userId] })],
);
