import type { SeedContext } from '../../seed';

/** Fictional history data for dev and the browser tests; safe to run twice. */
export async function seed(ctx: SeedContext): Promise<void> {
  ctx.log.debug('History: no seed data yet');
}
