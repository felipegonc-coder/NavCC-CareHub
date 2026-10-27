import type { Course, PublishNotify } from '@carehub/learning';
import {
  boolean,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

// Mirrors migrations/202610270312_learning_courses.sql, which is the source of truth (schema.test.ts compares
// them).

const at = (name: string) => timestamp(name, { withTimezone: true }).notNull().defaultNow();

/** Each course's draft, and which version is live. */
export const learningCourses = pgTable(
  'learning_courses',
  {
    workspaceId: uuid('workspace_id').notNull(),
    id: text('id').notNull(),
    draft: jsonb('draft').$type<Course>().notNull(),
    revision: integer('revision').notNull().default(1),
    liveVersion: integer('live_version'),
    publishedRevision: integer('published_revision'),
    archived: boolean('archived').notNull().default(false),
    createdBy: uuid('created_by').notNull(),
    createdAt: at('created_at'),
    updatedAt: at('updated_at'),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.id] })],
);

/** Every published version of a course, never changed once written. */
export const learningCourseVersions = pgTable(
  'learning_course_versions',
  {
    workspaceId: uuid('workspace_id').notNull(),
    courseId: text('course_id').notNull(),
    version: integer('version').notNull(),
    course: jsonb('course').$type<Course>().notNull(),
    publishedAt: at('published_at'),
    publishedBy: uuid('published_by').notNull(),
    notify: text('notify').$type<PublishNotify>().notNull(),
    note: text('note'),
    rolledBackFrom: integer('rolled_back_from'),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.courseId, table.version] }),
    foreignKey({
      columns: [table.workspaceId, table.courseId],
      foreignColumns: [learningCourses.workspaceId, learningCourses.id],
    }).onDelete('cascade'),
  ],
);
