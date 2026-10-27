import type { SeedContext } from '../../seed';

/** Fictional claude data for dev and the browser tests; safe to run twice. */
export async function seed(ctx: SeedContext): Promise<void> {
  ctx.log.debug('Claude: no seed data yet');
}
