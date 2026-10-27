// Google sign-ins in progress (CA-07): the state's hash and the sealed PKCE verifier, for 10
// minutes, tied to the person and the signed-in session that started it (security review).
import { createHash } from 'node:crypto';
import { and, eq, lt } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { Db, Tx } from '../../../db';
import { SESSION_COOKIE } from '../../auth';
import { calendarOAuthStates as oauthStates } from './schema';

type DbOrTx = Db | Tx;

export const OAUTH_STATE_TTL_MS = 10 * 60_000;
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
export const hashOAuthState = (state: string) => sha256(state);
export const oauthStateSecretContext = (state: string) =>
  `calendar-oauth-state:${hashOAuthState(state)}`;

/**
 * The signed-in session behind a request, as a hash that can't be turned back into the token:
 * from `request.sessionId` once accounts add it (decision 0007, 3.1), the session cookie until then.
 */
export function signInSessionKey(request: FastifyRequest): string | undefined {
  const id = (request as { sessionId?: unknown }).sessionId;
  if (typeof id === 'string' && id) return sha256(`calendar-sign-in:session:${id}`);
  const token = request.cookies[SESSION_COOKIE];
  return token ? sha256(`calendar-sign-in:cookie:${token}`) : undefined;
}

/** Remembers a sign-in for 10 minutes. Only the state's hash is kept. */
export async function saveOAuthState(
  db: DbOrTx,
  input: {
    state: string;
    ownerId: string;
    /** From signInSessionKey. */
    sessionKey: string;
    workspaceId?: string | null | undefined;
    /** Sealed with oauthStateSecretContext(state). */
    codeVerifier: string;
    connectionId?: string | null | undefined;
  },
  now = new Date(),
) {
  await db.delete(oauthStates).where(lt(oauthStates.expiresAt, now));
  await db.insert(oauthStates).values({
    stateHash: hashOAuthState(input.state),
    ownerId: input.ownerId,
    sessionKey: input.sessionKey,
    workspaceId: input.workspaceId ?? null,
    codeVerifier: input.codeVerifier,
    connectionId: input.connectionId ?? null,
    expiresAt: new Date(now.getTime() + OAUTH_STATE_TTL_MS),
  });
}

/**
 * Ends a sign-in in progress and returns it. Nothing comes back when it's unknown or expired, or
 * when another person or another session started it.
 */
export async function takeOAuthState(
  db: DbOrTx,
  state: string,
  by: { ownerId: string; sessionKey: string },
  now = new Date(),
) {
  const [row] = await db
    .delete(oauthStates)
    .where(
      and(eq(oauthStates.stateHash, hashOAuthState(state)), eq(oauthStates.ownerId, by.ownerId)),
    )
    .returning();
  return row && row.expiresAt > now && row.sessionKey === by.sessionKey ? row : undefined;
}
