// The databases feature's seed (decision 0007 section 2.5): Blue Pine Plumbing's jobs (seed-data.ts)
// at the top of the team space, made by the seed's admin. Safe to run twice: nothing is added when
// the workspace already has a database with that title.
import { sql } from 'drizzle-orm';
import type { Db } from '../../db';
import type { SeedContext as CoreSeedContext } from '../../seed';
import { seedDatabase } from './create';
import { SEED_TITLE, jobsDefinition } from './seed-data';

/**
 * Core's seed context with `db` as the database. Core types its `db` as unknown until its
 * database line lands.
 */
export type SeedContext = Omit<CoreSeedContext, 'db'> & { db: Db };

/** Adds the jobs database once per workspace. */
export async function seed(core: CoreSeedContext): Promise<void> {
  const ctx = core as SeedContext; // the same object, with `db` typed
  const today = new Date().toISOString().slice(0, 10);
  const made = await ctx.db.transaction(async (tx) => {
    const found = await tx.execute(sql`
      SELECT 1 FROM db_databases d JOIN pages p ON p.id = d.page_id
      WHERE d.workspace_id = ${ctx.workspaceId} AND p.title = ${SEED_TITLE}
        AND p.deleted_at IS NULL
      LIMIT 1`);
    if (found.rows.length > 0) return null;
    return seedDatabase(tx, {
      workspaceId: ctx.workspaceId,
      spaceId: ctx.teamSpaceId,
      definition: jobsDefinition(ctx.users, today),
    });
  });
  if (made === null) {
    ctx.log.info(`Databases: "${SEED_TITLE}" is already there.`);
    return;
  }
  ctx.log.info(`Databases: seeded "${SEED_TITLE}" with ${made.rowIds.length} jobs.`);
}
