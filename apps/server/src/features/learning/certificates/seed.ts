import { sampleCertificationCourse } from '@carehub/learning';
import { completeProgress } from '../progress/service';
import { SEED_NOTE } from '../progress/seed';
import type { AreaSeed } from '../seed';

/**
 * Fictional certificates for the dev and browser-test database: the trainer holds the sample
 * certification (valid for 12 months from today), so My certificates, the certificate page and
 * the reports show one. Completing a course with certificates on issues its certificate
 * (`completeProgress`); doing it again issues none, so this is safe to run twice.
 */
export const seedCertificates: AreaSeed = async (ctx, learning) => {
  const trainer = learning.trainer.id;
  const actor = { userId: trainer, workspaceId: ctx.workspaceId };
  await completeProgress(ctx.db, actor, trainer, sampleCertificationCourse.id, SEED_NOTE);
};
