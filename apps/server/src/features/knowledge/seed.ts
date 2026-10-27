import type { SeedContext } from '../../seed';

/** Fictional knowledge base data for dev and the browser tests; safe to run twice. */
export async function seed(ctx: SeedContext): Promise<void> {
  ctx.log.debug('Knowledge base: no seed data yet');
}
