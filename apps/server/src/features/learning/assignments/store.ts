import { and, arrayContains, asc, eq, inArray, or, sql } from 'drizzle-orm';
import type { Db, Tx } from '../../../db';
import {
  learningAssignmentLearners as learners,
  learningAssignments as assignments,
} from './schema';

/** A learning_assignments row. */
export type AssignmentRow = {
  id: string;
  workspaceId: string;
  courseId: string;
  pathId: string | null;
  userIds: string[];
  groupIds: string[];
  dueDate: string | null;
  dueInDays: number | null;
  required: boolean;
  createdBy: string;
  createdAt: Date;
};
export type NewAssignmentRow = Omit<AssignmentRow, 'id' | 'createdAt'>;

/** A learning_assignment_learners row: the day `userId` got an assignment due some days later. */
export type LearnerRow = { assignmentId: string; userId: string; since: string };

/** The assignment tables. Lists and removals stay in one workspace; learners go by assignment. */
export type AssignmentStore = {
  insert(rows: readonly NewAssignmentRow[]): Promise<AssignmentRow[]>;
  /** Oldest first. `userId` keeps that person's own assignments and every group assignment. */
  list(
    workspaceId: string,
    filter?: { courseId?: string; userId?: string },
  ): Promise<AssignmentRow[]>;
  /** False when the workspace has no such assignment. */
  remove(workspaceId: string, id: string): Promise<boolean>;
  learners(assignmentIds: readonly string[]): Promise<LearnerRow[]>;
  /** Keeps the rows already there. */
  addLearners(rows: readonly LearnerRow[]): Promise<void>;
};

/** The assignment tables on Postgres. */
export function assignmentStore(db: Db | Tx): AssignmentStore {
  return {
    async insert(rows) {
      if (rows.length === 0) return [];
      return db
        .insert(assignments)
        .values([...rows])
        .returning();
    },
    async list(workspaceId, filter = {}) {
      const { courseId, userId } = filter;
      return db
        .select()
        .from(assignments)
        .where(
          and(
            eq(assignments.workspaceId, workspaceId),
            courseId === undefined ? undefined : eq(assignments.courseId, courseId),
            userId === undefined
              ? undefined
              : or(
                  arrayContains(assignments.userIds, [userId]),
                  sql`cardinality(${assignments.groupIds}) > 0`,
                ),
          ),
        )
        .orderBy(asc(assignments.createdAt), asc(assignments.id));
    },
    async remove(workspaceId, id) {
      const removed = await db
        .delete(assignments)
        .where(and(eq(assignments.workspaceId, workspaceId), eq(assignments.id, id)))
        .returning({ id: assignments.id });
      return removed.length > 0;
    },
    async learners(assignmentIds) {
      if (assignmentIds.length === 0) return [];
      return db
        .select()
        .from(learners)
        .where(inArray(learners.assignmentId, [...assignmentIds]));
    },
    async addLearners(rows) {
      if (rows.length === 0) return;
      await db
        .insert(learners)
        .values([...rows])
        .onConflictDoNothing();
    },
  };
}
