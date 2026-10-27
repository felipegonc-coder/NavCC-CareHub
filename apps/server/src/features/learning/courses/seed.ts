import { sampleCourses } from '@carehub/learning';
import type { AreaSeed } from '../seed';
import { seedCourse } from './service';

/** The fictional sample courses, published by the trainer, so Studio, the catalog and the player have content. */
export const seedCourses: AreaSeed = async (ctx, learning) => {
  const actor = { userId: learning.trainer.id, workspaceId: ctx.workspaceId };
  let added = 0;
  for (const course of sampleCourses) if (await seedCourse(ctx.db, actor, course)) added += 1;
  ctx.log(`Learning: added ${added} sample courses.`);
};
