import {
  date,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { learningCourses } from '../courses/schema';

// Mirrors migrations/202610271100_learning_reviews.sql and 202610271130_learning_review_reminders.sql,
// which are the source of truth (schema.test.ts compares them).

const when = (name: string) => timestamp(name, { withTimezone: true });

/** Links that open a course's draft for review (decision 0309). Only the token's hash is kept. */
export const learningReviewLinks = pgTable(
  'learning_review_links',
  {
    workspaceId: uuid('workspace_id').notNull(),
    id: text('id').notNull(),
    courseId: text('course_id').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    createdBy: uuid('created_by').notNull(),
    createdAt: when('created_at').notNull().defaultNow(),
    expiresAt: when('expires_at').notNull(),
    stoppedAt: when('stopped_at'),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.id] }),
    foreignKey({
      columns: [table.workspaceId, table.courseId],
      foreignColumns: [learningCourses.workspaceId, learningCourses.id],
    }).onDelete('cascade'),
    index('learning_review_links_course').on(table.workspaceId, table.courseId),
  ],
);

/** What reviewers said about a lesson, or one block or quiz question in it. */
export const learningReviewComments = pgTable(
  'learning_review_comments',
  {
    workspaceId: uuid('workspace_id').notNull(),
    id: text('id').notNull(),
    courseId: text('course_id').notNull(),
    linkId: text('link_id').notNull(),
    lessonId: text('lesson_id').notNull(),
    blockId: text('block_id'),
    questionId: text('question_id'),
    body: text('body').notNull(),
    authorId: uuid('author_id').notNull(),
    createdAt: when('created_at').notNull().defaultNow(),
    resolvedAt: when('resolved_at'),
    resolvedBy: uuid('resolved_by'),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.id] }),
    foreignKey({
      columns: [table.workspaceId, table.courseId],
      foreignColumns: [learningCourses.workspaceId, learningCourses.id],
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.workspaceId, table.linkId],
      foreignColumns: [learningReviewLinks.workspaceId, learningReviewLinks.id],
    }).onDelete('cascade'),
    index('learning_review_comments_course').on(table.workspaceId, table.courseId, table.createdAt),
    index('learning_review_comments_link').on(table.workspaceId, table.linkId, table.createdAt),
  ],
);

/** Each review-due reminder sent to an author, so it goes out once. */
export const learningReviewReminders = pgTable(
  'learning_review_reminders',
  {
    workspaceId: uuid('workspace_id').notNull(),
    courseId: text('course_id').notNull(),
    dueOn: date('due_on', { mode: 'string' }).notNull(),
    sentOn: date('sent_on', { mode: 'string' }).notNull(),
    userId: uuid('user_id').notNull(),
    sentAt: when('sent_at').notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.courseId, table.dueOn] }),
    foreignKey({
      columns: [table.workspaceId, table.courseId],
      foreignColumns: [learningCourses.workspaceId, learningCourses.id],
    }).onDelete('cascade'),
  ],
);
