import type { Course } from '@carehub/learning';
import type { Db, Tx } from '../../../db';
import { withBankQuestions } from './service';
import { bankStore } from './store';

/**
 * Publish hook for courses/service.ts. Copies each bank draw's questions from the workspace's banks into the
 * course (`bankDraws[].questions`), so a live version never changes when its bank does, and returns the course
 * to publish. Throws 422 with every publish problem when a drawn bank is gone or has too few questions.
 */
export async function resolveBankDraws(
  db: Db | Tx,
  workspaceId: string,
  course: Course,
): Promise<Course> {
  return withBankQuestions(bankStore(db), workspaceId, course);
}
