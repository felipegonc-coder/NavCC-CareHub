import type { Course } from '@carehub/learning';
import type { Db, Tx } from '../db';

/**
 * Publish hook (B9 fills it in). Copies each bank draw's questions from the workspace's banks into the course
 * (`bankDraws[].questions`), so a live version never changes when its bank does, and returns the course to
 * publish; publishing stores what it returns. When a bank is missing or too small it throws
 * `cannotPublish(problems)` from ../errors, listing every problem. The stub returns the course unchanged.
 */
export async function resolveBankDraws(
  db: Db | Tx,
  workspaceId: string,
  course: Course,
): Promise<Course> {
  return course;
}
