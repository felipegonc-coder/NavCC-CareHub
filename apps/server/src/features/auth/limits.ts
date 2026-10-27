import { createHash } from 'node:crypto';
import { and, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';
import type { Db, Tx } from '../../db';
import { signInLimits } from './schema';

/** Settings and members, Security: 10 wrong passwords in 15 minutes, then a 15-minute wait (fixed). */
export const SIGN_IN_LIMIT = { failures: 10, windowMinutes: 15, pauseMinutes: 15 } as const;

const minutesAgo = (count: number) => sql`now() - make_interval(mins => ${sql.raw(String(count))})`;
const minutesFromNow = (count: number) =>
  sql`now() + make_interval(mins => ${sql.raw(String(count))})`;

/** Rows key on a hash of the sign-in name, so the table never holds the names people typed. */
const nameHash = (email: string) => createHash('sha256').update(email).digest('hex');

/** While sign-in with this (normalized) name waits, the time it can be tried again; otherwise null. */
export async function signInPausedUntil(db: Db | Tx, email: string): Promise<Date | null> {
  const [row] = await db
    .select({ pausedUntil: signInLimits.pausedUntil })
    .from(signInLimits)
    .where(
      and(eq(signInLimits.nameHash, nameHash(email)), gt(signInLimits.pausedUntil, sql`now()`)),
    )
    .limit(1);
  return row?.pausedUntil ?? null;
}

/**
 * Counts a wrong password for this (normalized) sign-in name, whether or not it has an account. The
 * tenth within the window starts the wait.
 */
export async function recordWrongPassword(db: Db | Tx, email: string): Promise<void> {
  const key = nameHash(email);
  // Rows whose window (and wait) are over no longer count, for this name or any other.
  await db
    .delete(signInLimits)
    .where(
      and(
        lte(signInLimits.windowStartedAt, minutesAgo(SIGN_IN_LIMIT.windowMinutes)),
        or(isNull(signInLimits.pausedUntil), lte(signInLimits.pausedUntil, sql`now()`)),
      ),
    );
  await db.insert(signInLimits).values({ nameHash: key }).onConflictDoNothing();
  const [row] = await db
    .update(signInLimits)
    .set({ failures: sql`${signInLimits.failures} + 1` })
    .where(eq(signInLimits.nameHash, key))
    .returning({ failures: signInLimits.failures });
  if (row && row.failures >= SIGN_IN_LIMIT.failures) {
    await db
      .update(signInLimits)
      .set({
        failures: 0,
        windowStartedAt: sql`now()`,
        pausedUntil: minutesFromNow(SIGN_IN_LIMIT.pauseMinutes),
      })
      .where(eq(signInLimits.nameHash, key));
  }
}

/** After a correct password the count starts again. */
export async function clearWrongPasswords(db: Db | Tx, email: string): Promise<void> {
  await db.delete(signInLimits).where(eq(signInLimits.nameHash, nameHash(email)));
}
