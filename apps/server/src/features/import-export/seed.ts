import type { SeedContext } from '../../seed';

/** Fictional import and export data for dev and the browser tests; safe to run twice. */
export async function seed(ctx: SeedContext): Promise<void> {
  ctx.log.debug('Import and export: no seed data yet');
}
