import {
  changePasswordBodySchema,
  passwordProblem,
  signInBodySchema,
  type CurrentUser,
  type MeResponse,
} from '@carehub/shared';
import { eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { httpError } from '../../core/errors';
import type { Db } from '../../db';
import {
  getCurrentMember,
  getDefaultWorkspace,
  memberJson,
  type CurrentMember,
} from '../workspaces';
import { normalizeEmail } from './accounts';
import { sessionOf } from './cookies';
import { emitSessionsEnded } from './events';
import {
  SIGN_IN_LIMIT,
  clearWrongPasswords,
  recordWrongPassword,
  signInPausedUntil,
} from './limits';
import { hashPassword, passwordMatches } from './passwords';
import { users } from './schema';
import { createSession, currentUserColumns, deleteSession, deleteUserSessions } from './sessions';

const WRONG_DETAILS = "That email and password don't match. Try again.";
const PAUSED = `Too many wrong passwords. Wait ${SIGN_IN_LIMIT.pauseMinutes} minutes and try again.`;
const LOCKED = 'This account is locked. Ask a site admin to unlock it.';

function signedIn(request: FastifyRequest): CurrentUser {
  if (!request.user) throw httpError(401, 'signed_out');
  return request.user;
}

/** A 400 for one field of the body, shaped like the zod answers. */
const fieldError = (field: string, message: string) =>
  httpError(400, 'invalid', message, [{ code: 'custom', path: [field], message }]);

async function meResponse(
  db: Db,
  user: CurrentUser,
  member: CurrentMember | null,
): Promise<MeResponse> {
  const workspace = await getDefaultWorkspace(db);
  if (!workspace) throw new Error('The current workspace is missing.');
  return { user, member: member && memberJson(member), workspace };
}

/**
 * /api/auth: the current user, signing in and out, and changing the password (decision 0007, 3.1).
 * Everyone signed in may use them, in the workspace or not (`me` says which).
 */
const authRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/me',
    { config: { allowTemporaryPassword: true, allowNonMembers: true } },
    async (request): Promise<MeResponse> => meResponse(app.db, signedIn(request), request.member),
  );

  // Public, with the CSRF check every public change gets. Wrong passwords count per sign-in name
  // (limits.ts); while one waits, even the right password gets the same 429.
  app.post(
    '/sign-in',
    { config: { public: true } },
    async (request, reply): Promise<MeResponse> => {
      const body = signInBodySchema.parse(request.body);
      const email = normalizeEmail(body.email);
      if (await signInPausedUntil(app.db, email)) throw httpError(429, 'rate_limited', PAUSED);
      const [account] = await app.db
        .select({ id: users.id, passwordHash: users.passwordHash, lockedAt: users.lockedAt })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      // Unknown names take as long as known ones and get the same answer.
      if (!(await passwordMatches(account?.passwordHash ?? null, body.password)) || !account) {
        await recordWrongPassword(app.db, email);
        throw httpError(401, 'signed_out', WRONG_DETAILS);
      }
      await clearWrongPasswords(app.db, email);
      if (account.lockedAt) throw httpError(403, 'forbidden', LOCKED);

      // Always a new session; the one this browser had (if any) ends.
      const previous = sessionOf(request);
      const device = { userAgent: request.headers['user-agent'], ipAddress: request.ip };
      const { session, user, ended } = await app.db.transaction(async (tx) => {
        const ended = previous ? await deleteSession(tx, previous.id) : null;
        const session = await createSession(tx, account.id, device);
        const [user] = await tx
          .select(currentUserColumns)
          .from(users)
          .where(eq(users.id, account.id));
        if (!user) throw new Error('The account was not found.');
        return { session, user, ended };
      });
      if (ended) emitSessionsEnded(app, [ended]);
      app.sessionCookies.set(reply, session.token);
      return meResponse(app.db, user, await getCurrentMember(app.db, user.id));
    },
  );

  // Public, so it always clears the cookies, even for a session that has already ended.
  app.post('/sign-out', { config: { public: true } }, async (request, reply) => {
    const session = sessionOf(request);
    const ended = session ? await deleteSession(app.db, session.id) : null;
    app.sessionCookies.clear(reply);
    if (ended) emitSessionsEnded(app, [ended]);
    return { ok: true };
  });

  // Every session of this person ends, this one too.
  app.post(
    '/sign-out-everywhere',
    { config: { allowNonMembers: true } },
    async (request, reply) => {
      const ended = await deleteUserSessions(app.db, signedIn(request).id);
      app.sessionCookies.clear(reply);
      emitSessionsEnded(app, ended);
      return { ok: true };
    },
  );

  // Also how a temporary password is replaced. Every other session of this person ends.
  app.post(
    '/password',
    { config: { allowTemporaryPassword: true, allowNonMembers: true } },
    async (request): Promise<MeResponse> => {
      const user = signedIn(request);
      const body = changePasswordBodySchema.parse(request.body);
      if (await signInPausedUntil(app.db, user.email)) throw httpError(429, 'rate_limited', PAUSED);
      const [account] = await app.db
        .select({ passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.id, user.id));
      if (!(await passwordMatches(account?.passwordHash ?? null, body.currentPassword))) {
        await recordWrongPassword(app.db, user.email);
        throw fieldError('currentPassword', "That isn't your current password.");
      }
      const problem =
        body.newPassword === body.currentPassword
          ? 'Choose a new password, not the one you have now.'
          : passwordProblem(body.newPassword, user.email);
      if (problem) throw fieldError('newPassword', problem);

      const passwordHash = await hashPassword(body.newPassword);
      const ended = await app.db.transaction(async (tx) => {
        await tx
          .update(users)
          .set({ passwordHash, mustChangePassword: false, updatedAt: sql`now()` })
          .where(eq(users.id, user.id));
        return deleteUserSessions(tx, user.id, { except: request.sessionId ?? undefined });
      });
      await clearWrongPasswords(app.db, user.email);
      emitSessionsEnded(app, ended);
      return meResponse(app.db, { ...user, mustChangePassword: false }, request.member);
    },
  );
};

export default authRoutes;
