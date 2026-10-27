import type { SeedContext } from '../../seed';

/** Fictional search data for dev and the browser tests; safe to run twice. */
export async function seed(ctx: SeedContext): Promise<void> {
  ctx.log.debug('Search: no seed data yet');
}
