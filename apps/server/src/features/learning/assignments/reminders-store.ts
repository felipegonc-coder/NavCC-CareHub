import { and, eq, inArray } from 'drizzle-orm';
import { date, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { sendNotice } from '../../notices';
import { canSeeCourse } from '../courses/access';
import type { Db, Tx } from '../../../db';
import type { ReminderSources } from './reminders';
import { learningAssignments } from './schema';
import { postgresSources } from './sources';

/**
 * Mirrors migrations/202610270900_learning_reminders.sql (reminders-store.test.ts compares them).
 */
export const learningRemindersSent = pgTable(
  'learning_reminders_sent',
  {
    workspaceId: uuid('workspace_id').notNull(),
    userId: uuid('user_id').notNull(),
    courseId: text('course_id').notNull(),
    kind: text('kind', { enum: ['assigned', 'due_soon', 'overdue'] }).notNull(),
    sentOn: date('sent_on', { mode: 'string' }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.workspaceId, table.userId, table.courseId, table.kind, table.sentOn],
    }),
  ],
);

const sent = learningRemindersSent;

/** What the reminders job uses on the server: the database, course access and notices. */
export function postgresReminderSources(db: Db | Tx, base = postgresSources(db)): ReminderSources {
  return {
    ...base,
    async workspaces() {
      const rows = await db
        .selectDistinct({ workspaceId: learningAssignments.workspaceId })
        .from(learningAssignments);
      return rows.map((row) => row.workspaceId);
    },
    async sentReminders(workspaceId, userIds) {
      if (userIds.length === 0) return [];
      return db
        .select()
        .from(sent)
        .where(and(eq(sent.workspaceId, workspaceId), inArray(sent.userId, [...userIds])));
    },
    async logReminder(row) {
      const added = await db
        .insert(sent)
        .values(row)
        .onConflictDoNothing()
        .returning({ userId: sent.userId });
      return added.length > 0;
    },
    async unlogReminder(row) {
      await db
        .delete(sent)
        .where(
          and(
            eq(sent.workspaceId, row.workspaceId),
            eq(sent.userId, row.userId),
            eq(sent.courseId, row.courseId),
            eq(sent.kind, row.kind),
            eq(sent.sentOn, row.sentOn),
          ),
        );
    },
    canOpen: (_workspaceId, userId, courseId) => canSeeCourse(userId, courseId),
    sendNotice: (notice) => sendNotice(notice),
  };
}
