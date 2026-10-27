import { createHash, randomBytes } from 'node:crypto';
import type { CurrentUser } from '@carehub/shared';
import { and, eq, gt, isNull, lte, sql } from 'drizzle-orm';
import type { Db, Tx } from '../../db';
import { sessions, users } from './schema';

/** The HttpOnly session cookie. Its value is the session token; the database keeps only its SHA-256 hash. */
export const SESSION_COOKIE = 'carehub_session';
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
/** An active session's last-seen time and 30-day expiry move forward at most this often. */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;
const expiresFromNow = () =>
  sql`now() + make_interval(secs => ${sql.raw(String(SESSION_TTL_SECONDS))})`;

/** The columns behind `request.user`. */
export const currentUserColumns = {
  id: users.id,
  email: users.email,
  name: users.name,
  avatarUrl: users.avatarUrl,
  isSiteAdmin: users.isSiteAdmin,
  timeZone: users.timeZone,
  use24h: users.use24h,
  weekStart: users.weekStart,
  mustChangePassword: users.mustChangePassword,
};

export const hashSessionToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** Starts a session and returns its secret token (for the cookie). Also removes the person's expired ones. */
export async function createSession(db: Db | Tx, userId: string, userAgent?: string) {
  const token = randomBytes(32).toString('base64url');
  const [row] = await db
    .insert(sessions)
    .values({
      tokenHash: hashSessionToken(token),
      userId,
      userAgent: userAgent?.slice(0, 512) ?? null,
      expiresAt: expiresFromNow(),
    })
    .returning({ id: sessions.id });
  if (!row) throw new Error('The session was not saved.');
  await db
    .delete(sessions)
    .where(and(eq(sessions.userId, userId), lte(sessions.expiresAt, sql`now()`)));
  return { id: row.id, token };
}

/** The live session for a token, or null (unknown or expired, or the account is turned off). */
export async function findSession(
  db: Db | Tx,
  token: string,
): Promise<{ id: string; lastSeenAt: Date; user: CurrentUser } | null> {
  if (!TOKEN_FORMAT.test(token)) return null;
  const [row] = await db
    .select({ sessionId: sessions.id, lastSeenAt: sessions.lastSeenAt, ...currentUserColumns })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, hashSessionToken(token)),
        gt(sessions.expiresAt, sql`now()`),
        isNull(users.disabledAt),
      ),
    )
    .limit(1);
  if (!row) return null;
  const { sessionId, lastSeenAt, ...user } = row;
  return { id: sessionId, lastSeenAt, user };
}

export const sessionNeedsTouch = (lastSeenAt: Date) =>
  Date.now() - lastSeenAt.getTime() >= TOUCH_INTERVAL_MS;

/** Sliding expiry: the session now lasts 30 days from this moment. */
export async function touchSession(db: Db | Tx, sessionId: string): Promise<void> {
  await db
    .update(sessions)
    .set({ lastSeenAt: sql`now()`, expiresAt: expiresFromNow() })
    .where(eq(sessions.id, sessionId));
}

export async function deleteSession(db: Db | Tx, sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

export async function deleteUserSessions(db: Db | Tx, userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

/**
 * For the live co-editing server: the person signed in with this session token (the carehub_session cookie
 * value), or null if it's unknown or expired, the account is turned off, or a new password must be chosen first.
 */
export async function getUserFromSessionToken(
  db: Db | Tx,
  token: string,
): Promise<CurrentUser | null> {
  const session = await findSession(db, token);
  return session && !session.user.mustChangePassword ? session.user : null;
}
