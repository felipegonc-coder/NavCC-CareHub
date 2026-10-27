import { sampleMicrolearningCourse, sampleStandardCourse } from '@carehub/learning';
import type { AreaSeed } from '../seed';
import { completeProgress } from './service';

/** What the seeds write as the reason a course was marked complete. */
export const SEED_NOTE = 'Sample data';

/**
 * Fictional progress for the dev and browser-test database: the trainer has finished two sample
 * courses, marked complete by hand, so My learning, her learning record and the reports have
 * something to show. Marking a course complete again keeps the first date, so this is safe to run
 * twice.
 */
export const seedProgress: AreaSeed = async (ctx, learning) => {
  const trainer = learning.trainer.id;
  const actor = { userId: trainer, workspaceId: ctx.workspaceId };
  for (const course of [sampleStandardCourse, sampleMicrolearningCourse]) {
    await completeProgress(ctx.db, actor, trainer, course.id, SEED_NOTE);
  }
};
