import { createHash, randomBytes } from 'node:crypto';
import type { CurrentUser } from '@carehub/shared';
import { and, eq, gt, isNull, lte, ne, sql } from 'drizzle-orm';
import type { Db, Tx } from '../../db';
import type { EndedSession } from './events';
import { sessions, users } from './schema';

/**
 * The HttpOnly session cookie (`__Host-carehub_session` when cookies are Secure; see authCookieNames). Its
 * value is the session token; the database keeps only its SHA-256 hash.
 */
export const SESSION_COOKIE = 'carehub_session';
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
/** However often it's used, a session ends this long after sign-in. */
export const SESSION_MAX_AGE_DAYS = 90;
/** An active session's last-seen time and 30-day expiry move forward at most this often. */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;
const expiresFromNow = () =>
  sql`now() + make_interval(secs => ${sql.raw(String(SESSION_TTL_SECONDS))})`;
const maxAge = () => sql`make_interval(days => ${sql.raw(String(SESSION_MAX_AGE_DAYS))})`;

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

const markActive = (db: Db | Tx, userId: string) =>
  db
    .update(users)
    .set({ lastActiveAt: sql`now()` })
    .where(eq(users.id, userId));

export interface SessionDevice {
  userAgent?: string;
  ipAddress?: string;
}

/** Starts a session and returns its secret token (for the cookie). Also removes the person's expired ones. */
export async function createSession(db: Db | Tx, userId: string, device: SessionDevice = {}) {
  const token = randomBytes(32).toString('base64url');
  const [row] = await db
    .insert(sessions)
    .values({
      tokenHash: hashSessionToken(token),
      userId,
      userAgent: device.userAgent?.slice(0, 512) ?? null,
      ipAddress: device.ipAddress?.slice(0, 64) ?? null,
      expiresAt: expiresFromNow(),
    })
    .returning({ id: sessions.id });
  if (!row) throw new Error('The session was not saved.');
  await markActive(db, userId);
  await db
    .delete(sessions)
    .where(and(eq(sessions.userId, userId), lte(sessions.expiresAt, sql`now()`)));
  return { id: row.id, token };
}

/** The live session for a token, or null (unknown, expired or over 90 days old, or the account is locked). */
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
        gt(sessions.createdAt, sql`now() - ${maxAge()}`),
        isNull(users.lockedAt),
      ),
    )
    .limit(1);
  if (!row) return null;
  const { sessionId, lastSeenAt, ...user } = row;
  return { id: sessionId, lastSeenAt, user };
}

export const sessionNeedsTouch = (lastSeenAt: Date) =>
  Date.now() - lastSeenAt.getTime() >= TOUCH_INTERVAL_MS;

/**
 * Sliding expiry: the session now lasts 30 days from this moment, but never past 90 days after sign-in.
 * Also updates the person's last active time.
 */
export async function touchSession(db: Db | Tx, sessionId: string): Promise<void> {
  const [row] = await db
    .update(sessions)
    .set({
      lastSeenAt: sql`now()`,
      expiresAt: sql`LEAST(${expiresFromNow()}, ${sessions.createdAt} + ${maxAge()})`,
    })
    .where(eq(sessions.id, sessionId))
    .returning({ userId: sessions.userId });
  if (row) await markActive(db, row.userId);
}

const ended = { sessionId: sessions.id, userId: sessions.userId };

/** Ends one session. Returns it, for `session.ended`, or null if it had already ended. */
export async function deleteSession(db: Db | Tx, sessionId: string): Promise<EndedSession | null> {
  const [row] = await db.delete(sessions).where(eq(sessions.id, sessionId)).returning(ended);
  return row ?? null;
}

/** Ends all of a person's sessions, or all but `except` (the one in use), and returns them. */
export async function deleteUserSessions(
  db: Db | Tx,
  userId: string,
  options: { except?: string } = {},
): Promise<EndedSession[]> {
  const others = options.except === undefined ? undefined : ne(sessions.id, options.except);
  return db
    .delete(sessions)
    .where(and(eq(sessions.userId, userId), others))
    .returning(ended);
}

/**
 * For the live co-editing server: the person signed in with this session token (the value of the cookie
 * named `app.sessionCookies.names.session`, or `app.sessionCookies.sessionToken(request)`), or null if it's
 * unknown or expired, the account is locked, or a new password must be chosen first.
 */
export async function getUserFromSessionToken(
  db: Db | Tx,
  token: string,
): Promise<CurrentUser | null> {
  const session = await findSession(db, token);
  return session && !session.user.mustChangePassword ? session.user : null;
}
