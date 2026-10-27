import type { SeedContext as CoreSeedContext } from '../../seed';
import { seedAssignments } from './assignments/seed';
import { seedBanks } from './banks/seed';
import { seedCertificates } from './certificates/seed';
import { seedCourses } from './courses/seed';
import type { Db } from './db';
import { seedPaths } from './paths/seed';
import { seedProgress } from './progress/seed';
import { seedReviews } from './reviews/seed';

/**
 * What each area's seed gets: core's seed context (0007 section 2.5) with `db` as Learning's database. Core
 * types its `db` as unknown until its database line lands.
 */
export type SeedContext = Omit<CoreSeedContext, 'db'> & { db: Db };

/** Someone the Learning seed adds, with their role. */
export type SeedPerson = { id: string; roleId: string };

/** Learning's own test people, for the areas' seeds: the trainer builds, assigns and reads reports. */
export type LearningSeed = { trainer: SeedPerson; reportViewer: SeedPerson };

/** One area's fictional data. Seeds must be safe to run twice. */
export type AreaSeed = (ctx: SeedContext, learning: LearningSeed) => Promise<void>;

/** The Trainer role: Editor's keys plus the three Learning keys (0007 section 3.2). */
export const TRAINER_PERMISSIONS = [
  'pages.edit',
  'pages.create',
  'pages.comment',
  'pages.share',
  'templates.manage',
  'claude.use',
  'guests.add',
  'pages.shareLinks',
  'learning.build',
  'learning.assign',
  'learning.analytics',
] as const;

/** The Report viewer role: Learning's reports and nothing else, for the report-only checks (LN-11). */
export const REPORT_VIEWER_PERMISSIONS = ['learning.analytics'] as const;

/** Browser tests sign in as her with `signInAs(page, 'tara.trainer@example.test')`. */
export const TRAINER = { key: 'trainer', name: 'Tara Trainer', email: 'tara.trainer@example.test' };

/** Sees Learning's reports only: `signInAs(page, 'remy.reports@example.test')`. */
export const REPORT_VIEWER = {
  key: 'reports',
  name: 'Remy Reports',
  email: 'remy.reports@example.test',
};

// Banks first (quizzes draw from them), then courses, then what refers to courses. Media (B10) adds its seed
// with its routes (#70).
const AREA_SEEDS: readonly AreaSeed[] = [
  seedBanks,
  seedCourses,
  seedPaths,
  seedAssignments,
  seedProgress,
  seedCertificates,
  seedReviews,
];

/** Adds Learning's two roles, each with its person. */
export async function seedPeople(
  ctx: Pick<SeedContext, 'createRole' | 'createPerson'>,
): Promise<LearningSeed> {
  const person = async (
    who: typeof TRAINER,
    role: Parameters<SeedContext['createRole']>[0],
  ): Promise<SeedPerson> => {
    const { id: roleId } = await ctx.createRole(role);
    const { id } = await ctx.createPerson({ ...who, roleId });
    return { id, roleId };
  };
  return {
    trainer: await person(TRAINER, { name: 'Trainer', permissions: TRAINER_PERMISSIONS }),
    reportViewer: await person(REPORT_VIEWER, {
      name: 'Report viewer',
      permissions: REPORT_VIEWER_PERMISSIONS,
    }),
  };
}

/** Learning's fictional seed data, called from apps/server/src/seed.ts. */
export async function seed(core: CoreSeedContext): Promise<void> {
  const ctx = core as SeedContext; // the same object, with `db` typed
  const learning = await seedPeople(ctx);
  for (const seedArea of AREA_SEEDS) await seedArea(ctx, learning);
  ctx.log.info(
    `Learning: seeded the Trainer role with ${TRAINER.name} and the Report viewer role with ${REPORT_VIEWER.name}.`,
  );
}
