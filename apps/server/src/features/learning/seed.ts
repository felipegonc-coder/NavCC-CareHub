import { seedAssignments } from './assignments/seed';
import { seedBanks } from './banks/seed';
import { seedCertificates } from './certificates/seed';
import { seedCourses } from './courses/seed';
import type { Db } from './db';
import { seedPaths } from './paths/seed';
import { seedProgress } from './progress/seed';
import { seedReviews } from './reviews/seed';

export type SeedPerson = { id: string };

/**
 * What core's seed passes to each feature (0007 section 2.5). A stand-in until apps/server/src/seed.ts exports
 * its own type; then this becomes a re-export.
 */
export type SeedContext = {
  db: Db;
  workspaceId: string;
  users: Record<'admin' | 'editor' | 'commenter' | 'viewer', SeedPerson>;
  teamSpaceId: string;
  log(message: string): void;
  createRole(role: { name: string; permissions: string[] }): Promise<{ id: string }>;
  createPerson(person: {
    key: string;
    name: string;
    email: string;
    roleId: string;
  }): Promise<SeedPerson>;
};

/** What Learning adds for its areas' seeds: the trainer, who builds, assigns and reads reports. */
export type LearningSeed = { trainer: SeedPerson & { roleId: string } };

/** One area's fictional data. Seeds run once, on an empty database. */
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

/** Browser tests sign in as her with `signInAs(page, 'tara.trainer@example.test')`. */
export const TRAINER = { key: 'trainer', name: 'Tara Trainer', email: 'tara.trainer@example.test' };

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

/** Learning's fictional seed data, called from apps/server/src/seed.ts. */
export async function seed(ctx: SeedContext): Promise<void> {
  const role = await ctx.createRole({ name: 'Trainer', permissions: [...TRAINER_PERMISSIONS] });
  const person = await ctx.createPerson({ ...TRAINER, roleId: role.id });
  const learning: LearningSeed = { trainer: { id: person.id, roleId: role.id } };
  for (const seedArea of AREA_SEEDS) await seedArea(ctx, learning);
  ctx.log(`Learning: added the Trainer role and ${TRAINER.name} (${TRAINER.email}).`);
}
