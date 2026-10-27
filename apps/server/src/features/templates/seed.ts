import type { SeedContext } from '../../seed';

/** Fictional templates data for dev and the browser tests; safe to run twice. */
export async function seed(ctx: SeedContext): Promise<void> {
  ctx.log.debug('Templates: no seed data yet');
}
