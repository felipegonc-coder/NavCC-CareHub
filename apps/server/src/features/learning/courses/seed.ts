import { sampleCourses } from '@carehub/learning';
import type { AreaSeed } from '../seed';
import { seedCourse } from './service';

/** The fictional sample courses, published by the trainer, so Studio, the catalog and the player have content. */
export const seedCourses: AreaSeed = async (ctx, learning) => {
  const actor = { userId: learning.trainer.id, workspaceId: ctx.workspaceId };
  for (const course of sampleCourses) await seedCourse(ctx.db, actor, course);
};
