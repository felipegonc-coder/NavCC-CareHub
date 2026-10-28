import { createHash } from 'node:crypto';
import { and, eq, isNull, lte, or, sql } from 'drizzle-orm';
import type { Db, Tx } from '../../db';
import { signInLimits } from './schema';

/** Settings and members, Security: 10 wrong passwords in 15 minutes, then a 15-minute wait (fixed). */
export const SIGN_IN_LIMIT = { failures: 10, windowMinutes: 15, pauseMinutes: 15 } as const;

const minutes = (count: number) => sql`make_interval(mins => ${count}::int)`;

/** Rows key on a hash of the sign-in name, so the table never holds the names people typed. */
const nameHash = (email: string) => createHash('sha256').update(email).digest('hex');

/**
 * Counts a password try for this (normalized) sign-in name, whether or not it has an account, before
 * the password is checked. One statement does it, so tries sent at the same time each get their own
 * number and can't get past the limit. False while the name waits: answer 429 without checking the
 * password. The tenth try within the window is still checked, and starts the wait. A right password
 * clears the count (`clearPasswordTries`), so only wrong ones add up.
 */
export async function takePasswordTry(db: Db | Tx, email: string): Promise<boolean> {
  const { failures, windowStartedAt, pausedUntil } = signInLimits;
  const windowStart = sql`now() - ${minutes(SIGN_IN_LIMIT.windowMinutes)}`;
  // Rows whose window (and wait) are over no longer count, for this name or any other.
  await db
    .delete(signInLimits)
    .where(
      and(lte(windowStartedAt, windowStart), or(isNull(pausedUntil), lte(pausedUntil, sql`now()`))),
    );
  // A row the delete above missed starts again: its wait is over or, without one, its window.
  const over = sql`coalesce(${pausedUntil} <= now(), ${windowStartedAt} <= ${windowStart})`;
  const [row] = await db
    .insert(signInLimits)
    .values({ nameHash: nameHash(email), failures: 1 })
    .onConflictDoUpdate({
      target: signInLimits.nameHash,
      set: {
        // Stops one past the limit: every try after the tenth gets the same answer.
        failures: sql`CASE WHEN ${over} THEN 1
          ELSE least(${failures} + 1, ${SIGN_IN_LIMIT.failures + 1}::int) END`,
        windowStartedAt: sql`CASE WHEN ${over} THEN now() ELSE ${windowStartedAt} END`,
        pausedUntil: sql`CASE WHEN ${over} THEN NULL
          WHEN ${pausedUntil} IS NULL AND ${failures} + 1 >= ${SIGN_IN_LIMIT.failures}::int
            THEN now() + ${minutes(SIGN_IN_LIMIT.pauseMinutes)}
          ELSE ${pausedUntil} END`,
      },
    })
    .returning({ failures });
  return row !== undefined && row.failures <= SIGN_IN_LIMIT.failures;
}

/** After a right password the count starts again. */
export async function clearPasswordTries(db: Db | Tx, email: string): Promise<void> {
  await db.delete(signInLimits).where(eq(signInLimits.nameHash, nameHash(email)));
}
