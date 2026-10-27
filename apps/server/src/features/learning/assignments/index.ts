import type { Db, Tx } from '../../../db';
import { learningToday } from '../day';
import { assignRecertification, syncPath, type Recertification } from './service';
import { postgresSources } from './sources';

// What the other Learning areas call in assignments.

export { RECERTIFICATION_ASSIGNER, type Recertification } from './service';

/**
 * Keeps the assignments of learning path `pathId` in step with its courses, in order (`syncPath`).
 * Call it in the same transaction whenever the path's published courses may have changed: courses
 * added, removed or reordered, or one of them published (path saves and `onCoursePublished`).
 */
export function syncPathAssignments(
  db: Db | Tx,
  workspaceId: string,
  pathId: string,
  courseIds: readonly string[],
): Promise<void> {
  return syncPath(postgresSources(db), workspaceId, pathId, courseIds, learningToday());
}

/**
 * Assigns a course again to one person whose certificate runs out on `dueDate` (the daily
 * certificate job; `assignRecertification`). Start their new run in the same transaction: the
 * assignment stays open until they finish the course again. Returns its id, or null when nothing
 * was assigned.
 */
export function assignForRecertification(
  db: Db | Tx,
  input: Recertification,
): Promise<string | null> {
  return assignRecertification(postgresSources(db), input);
}
