import { sampleLearningPath } from '@carehub/learning';
import type { AreaSeed } from '../seed';
import { learningPaths } from './schema';

/**
 * Fictional learning paths for the dev and browser-test database: the sample new-starter path
 * through three of the sample courses, made by the trainer. A path already there is kept, so this
 * is safe to run twice. Nobody has it assigned (assignments come from their own seed).
 */
export const seedPaths: AreaSeed = async (ctx, learning) => {
  const path = sampleLearningPath;
  await ctx.db
    .insert(learningPaths)
    .values({
      workspaceId: ctx.workspaceId,
      id: path.id,
      title: path.title,
      description: path.description ?? null,
      courseIds: [...path.courseIds],
      order: path.order,
      createdBy: learning.trainer.id,
      updatedBy: learning.trainer.id,
    })
    .onConflictDoNothing();
};
