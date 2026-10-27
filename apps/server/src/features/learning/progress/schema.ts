import type { CourseStatus, ProgressEvent } from '@carehub/learning';
import {
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

// Mirrors migrations/202610270600_learning_progress.sql, which is the source of truth
// (schema.test.ts compares them).

const at = (name: string) => timestamp(name, { withTimezone: true }).notNull().defaultNow();
const maybeAt = (name: string) => timestamp(name, { withTimezone: true });

/**
 * One learner in one course: which run counts now, the course version it is measured against, a
 * completion marked by hand, and the state worked out from the run's events.
 */
export const learningProgress = pgTable(
  'learning_progress',
  {
    workspaceId: uuid('workspace_id').notNull(),
    learnerId: uuid('learner_id').notNull(),
    courseId: text('course_id').notNull(),
    run: integer('run').notNull().default(1),
    runStartedAt: maybeAt('run_started_at'),
    version: integer('version').notNull(),
    markedCompleteAt: maybeAt('marked_complete_at'),
    status: text('status').$type<CourseStatus>().notNull().default('not_started'),
    percentComplete: integer('percent_complete').notNull().default(0),
    score: doublePrecision('score'),
    activeSeconds: integer('active_seconds').notNull().default(0),
    attempts: integer('attempts').notNull().default(0),
    startedAt: maybeAt('started_at'),
    completedAt: maybeAt('completed_at'),
    lastActivityAt: maybeAt('last_activity_at'),
    lastLessonId: text('last_lesson_id'),
    createdAt: at('created_at'),
    updatedAt: at('updated_at'),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.learnerId, table.courseId] }),
    index('learning_progress_course_idx').on(table.workspaceId, table.courseId),
  ],
);

/** Every event a learner's browser sent (and the server's own quiz starts), never changed. */
export const learningProgressEvents = pgTable(
  'learning_progress_events',
  {
    workspaceId: uuid('workspace_id').notNull(),
    learnerId: uuid('learner_id').notNull(),
    courseId: text('course_id').notNull(),
    eventId: text('event_id').notNull(),
    run: integer('run').notNull(),
    event: jsonb('event').$type<ProgressEvent>().notNull(),
    receivedAt: at('received_at'),
  },
  (table) => [
    primaryKey({
      columns: [table.workspaceId, table.learnerId, table.courseId, table.eventId],
    }),
    foreignKey({
      columns: [table.workspaceId, table.learnerId, table.courseId],
      foreignColumns: [
        learningProgress.workspaceId,
        learningProgress.learnerId,
        learningProgress.courseId,
      ],
    }).onDelete('cascade'),
    index('learning_progress_events_run_idx').on(
      table.workspaceId,
      table.learnerId,
      table.courseId,
      table.run,
    ),
  ],
);

/** What a progress change was: a reset or completion by hand, or a retake asked by publishing. */
export type ProgressChangeKind = 'reset' | 'complete' | 'retake';

/** Resets, completions and retakes, with who did them and their note. */
export const learningProgressChanges = pgTable(
  'learning_progress_changes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull(),
    learnerId: uuid('learner_id').notNull(),
    courseId: text('course_id').notNull(),
    kind: text('kind').$type<ProgressChangeKind>().notNull(),
    run: integer('run').notNull(),
    changedBy: uuid('changed_by'),
    note: text('note'),
    changedAt: at('changed_at'),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId, table.learnerId, table.courseId],
      foreignColumns: [
        learningProgress.workspaceId,
        learningProgress.learnerId,
        learningProgress.courseId,
      ],
    }).onDelete('cascade'),
    index('learning_progress_changes_learner_idx').on(
      table.workspaceId,
      table.learnerId,
      table.courseId,
      table.changedAt,
    ),
  ],
);
