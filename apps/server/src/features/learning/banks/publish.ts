import type { Course } from '@carehub/learning';
import type { Db, Tx } from '../db';

/**
 * Publish hook (B9 fills it in). Copies each bank draw's questions into the course (`bankDraws[].questions`),
 * so a live version never changes when its bank does, and returns the course to publish. The stub returns the
 * course unchanged.
 */
export async function resolveBankDraws(db: Db | Tx, course: Course): Promise<Course> {
  return course;
}
