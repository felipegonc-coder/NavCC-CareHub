// Connecting Google, read-only (Calendar spec, Connections; CA-07, CA-12). Starting remembers the
// sign-in for 10 minutes. Google sends the person back to the callback, which checks that the
// sign-in is theirs, seals the tokens for the connection's row and adds the connection, or
// reconnects the one the sign-in was for. The account's address stays on the server.
import { z } from 'zod';
import { httpError } from '../../../core/errors';
import type { Db } from '../../../db';
import {
  type GoogleCalendarInfo,
  accountEmail,
  createGoogleCalendarClient,
  directTransport,
} from '../sync/google/client';
import type { FetchLike } from '../sync/google/http';
import type {
  CallbackQuery,
  GoogleOAuth,
  NeedsReconnect,
  NotConfigured,
  TemporaryError,
} from '../sync/google/oauth';
import { oauthStateSecretContext, saveOAuthState, takeOAuthState } from './oauth-states';
import { type SecretBox, connectionSecretContext, openJson, sealJson } from './secrets';
import {
  CONNECTION_LIMIT_MESSAGE,
  ConnectionLimitError,
  MAX_CONNECTIONS,
  createConnection,
  findConnectionByAccount,
  isAccountConnected,
  listConnections,
  newConnectionId,
  reconnectConnection,
} from './store';

export interface GoogleConnectDeps {
  db: Db;
  box: SecretBox;
  google: GoogleOAuth;
  fetch: FetchLike;
  /** `googleRedirectUri(CAREHUB_PUBLIC_URL)`. */
  redirectUri: string;
}

/** Why connecting didn't work, for the screen to explain. */
export type ConnectProblem =
  | NeedsReconnect['reason']
  | NotConfigured['reason']
  | TemporaryError['reason']
  | 'limit'
  | 'other-account';

export type ConnectResult =
  { connectionId: string; reconnected: boolean } | { problem: ConnectProblem };

const verifierSchema = z.object({ verifier: z.string().min(43).max(128) });
export const GOOGLE_LABEL = 'Google Calendar';
/** A calendar's name as the table takes it, 1 to 200 characters, the way sync-store keeps them. */
const calendarName = (name: string) => [...name].slice(0, 200).join('') || 'Calendar';

/** Starts a sign-in, or a new sign-in for one of the person's Google connections. */
export async function startGoogleConnect(
  deps: GoogleConnectDeps,
  input: {
    ownerId: string;
    /** From signInSessionKey: the callback has to come back in this session. */
    sessionKey: string;
    workspaceId: string | null;
    connectionId?: string | undefined;
  },
): Promise<{ url: string }> {
  const mine = await listConnections(deps.db, input.ownerId);
  if (input.connectionId !== undefined) {
    const own = mine.find((connection) => connection.id === input.connectionId);
    if (own?.kind !== 'google') throw httpError(404, 'not_found');
  } else if (mine.length >= MAX_CONNECTIONS) {
    throw httpError(409, 'conflict', CONNECTION_LIMIT_MESSAGE);
  }
  const request = deps.google.createAuthorizationRequest({ redirectUri: deps.redirectUri });
  if (request.kind !== 'ready') throw httpError(409, 'conflict', request.message);
  const context = oauthStateSecretContext(request.state);
  await saveOAuthState(deps.db, {
    state: request.state,
    ownerId: input.ownerId,
    sessionKey: input.sessionKey,
    workspaceId: input.workspaceId,
    codeVerifier: sealJson(deps.box, { verifier: request.codeVerifier }, context),
    connectionId: input.connectionId ?? null,
  });
  return { url: request.url };
}

/** Finishes a sign-in from Google's callback, in the session of the person who started it. */
export async function finishGoogleConnect(
  deps: GoogleConnectDeps,
  input: { ownerId: string; sessionKey: string; query: CallbackQuery },
): Promise<ConnectResult> {
  const state = input.query.state ?? '';
  const saved = state ? await takeOAuthState(deps.db, state, input) : undefined;
  if (!saved) return { problem: 'state-mismatch' };
  let codeVerifier: string;
  try {
    const context = oauthStateSecretContext(state);
    codeVerifier = openJson(deps.box, saved.codeVerifier, context, verifierSchema).verifier;
  } catch {
    return { problem: 'state-mismatch' };
  }
  const outcome = await deps.google.exchangeCode({
    callback: input.query,
    expectedState: state,
    codeVerifier,
    redirectUri: deps.redirectUri,
  });
  if (outcome.kind !== 'connected') return { problem: outcome.reason };
  const { tokens } = outcome;

  let calendars: GoogleCalendarInfo[];
  try {
    const transport = directTransport({ fetch: deps.fetch, accessToken: tokens.accessToken });
    calendars = await createGoogleCalendarClient({ transport, maxAttempts: 2 }).listCalendars();
  } catch {
    // The address isn't known, so the grant stays: ending it might end someone else's too.
    return { problem: 'unavailable' };
  }
  const account = accountEmail(calendars) ?? null;
  /** Nothing is kept, so the grant ends too, unless a connection still uses the account. */
  const giveUp = async (problem: ConnectProblem): Promise<ConnectResult> => {
    if (account && !(await isAccountConnected(deps.db, 'google', account))) {
      await deps.google.revoke(tokens.refreshToken);
    }
    return { problem };
  };
  const sameAccount = account
    ? await findConnectionByAccount(deps.db, { ownerId: input.ownerId, kind: 'google', account })
    : undefined;
  if (saved.connectionId && sameAccount !== saved.connectionId) return giveUp('other-account');

  const sealFor = (id: string) => sealJson(deps.box, tokens, connectionSecretContext(id));
  if (sameAccount) {
    const update = { secret: sealFor(sameAccount), account };
    if (!(await reconnectConnection(deps.db, input.ownerId, sameAccount, update))) {
      return giveUp('state-mismatch');
    }
    return { connectionId: sameAccount, reconnected: true };
  }
  const id = newConnectionId();
  try {
    await createConnection(deps.db, {
      id,
      ownerId: input.ownerId,
      workspaceId: saved.workspaceId,
      kind: 'google',
      label: GOOGLE_LABEL,
      account,
      secret: sealFor(id),
      // The person picks the rest next; the main calendar is chosen to start with.
      calendars: calendars.map((calendar) => ({
        remoteId: calendar.id,
        name: calendarName(calendar.name),
        timeZone: calendar.timeZone ?? null,
        shown: calendar.primary,
      })),
    });
  } catch (error) {
    if (error instanceof ConnectionLimitError) return giveUp('limit');
    throw error;
  }
  return { connectionId: id, reconnected: false };
}
