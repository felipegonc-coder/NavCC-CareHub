// Google sign-ins in progress (CA-07): the state's hash and the sealed PKCE verifier, for 10
// minutes, tied to the person who started it.
import { createHash } from 'node:crypto';
import { and, eq, lt } from 'drizzle-orm';
import type { Db, Tx } from '../../../db';
import { calendarOAuthStates as oauthStates } from './schema';

type DbOrTx = Db | Tx;

export const OAUTH_STATE_TTL_MS = 10 * 60_000;
export const hashOAuthState = (state: string) => createHash('sha256').update(state).digest('hex');
export const oauthStateSecretContext = (state: string) =>
  `calendar-oauth-state:${hashOAuthState(state)}`;

/** Remembers a sign-in for 10 minutes. Only the state's hash is kept. */
export async function saveOAuthState(
  db: DbOrTx,
  input: {
    state: string;
    ownerId: string;
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
    workspaceId: input.workspaceId ?? null,
    codeVerifier: input.codeVerifier,
    connectionId: input.connectionId ?? null,
    expiresAt: new Date(now.getTime() + OAUTH_STATE_TTL_MS),
  });
}

/** Ends a sign-in in progress and returns it, unless it's unknown, someone else's or expired. */
export async function takeOAuthState(db: DbOrTx, state: string, ownerId: string, now = new Date()) {
  const [row] = await db
    .delete(oauthStates)
    .where(and(eq(oauthStates.stateHash, hashOAuthState(state)), eq(oauthStates.ownerId, ownerId)))
    .returning();
  return row && row.expiresAt > now ? row : undefined;
}
