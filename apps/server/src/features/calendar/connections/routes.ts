// /api/calendar connections (Calendar spec, Connections): Google calendars, read-only. Only the
// owner lists, changes, syncs or removes a connection (RP-D1), and no answer ever has a token, a
// password or a private link in it (CA-11). This also runs the sync: what's due every minute, the
// person's connections when Calendar opens, and one connection on Retry.
import {
  CALENDAR_CHANGED,
  type ConnectProblem as ProblemCode,
  connectionPatchSchema,
  googleConnectSchema,
} from '@carehub/team-calendar-api';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { httpError } from '../../../core/errors';
import { readSettings } from '../../../core/settings';
import { registerPeriodicTask } from '../../jobs';
import { publishToUsers } from '../../live';
import { sendNotice } from '../../notices';
import type { FetchLike } from '../sync/google/http';
import {
  GOOGLE_SIGN_IN_MESSAGES,
  createGoogleOAuth,
  googleRedirectUri,
  googleSettingsSchema,
} from '../sync/google/oauth';
import { type GoogleConnectDeps, finishGoogleConnect, startGoogleConnect } from './google-connect';
import { UUID, connectedLayerId } from './layers';
import { signInSessionKey } from './oauth-states';
import {
  CONNECTIONS_OFF_MESSAGE,
  calendarSecretSettingsSchema,
  connectionSecretContext,
  openJson,
  secretBoxFrom,
} from './secrets';
import {
  isAccountConnected,
  listConnections,
  removeConnection,
  renameConnection,
  setCalendarShown,
} from './store';
import { createCalendarSync } from './sync';
import { type ReadCalendarLink, googleTokensSchema } from './sync-rules';
import { pgSyncStore } from './sync-store';

/** Stand-in until accounts add `request.member`, as in reminders: everyone is in one workspace. */
const STAND_IN_WORKSPACE_ID = '00000000-0000-4000-8000-000000000000';
/** The Connect calendars screen, where Google sends the person back to. */
export const CONNECTIONS_SCREEN = '/calendar/connections';
/** How long Calendar open waits for fresh events before it answers anyway. */
const REFRESH_WAIT_MS = 8_000;

export interface ConnectionRoutesOptions {
  /** Where settings come from. Defaults to the environment. */
  env?: Record<string, string | undefined>;
  /** How Care Hub reaches Google. Tests pass a fake Google. */
  fetch?: FetchLike;
  /** The iCalendar reader for private links. */
  readLink?: ReadCalendarLink;
  /** Which signed-in session a request is in. Tests name theirs: injectAs starts a new one each time. */
  sessionKey?: (request: FastifyRequest) => string | undefined;
}

const publicUrlSchema = z.object({
  CAREHUB_PUBLIC_URL: z.url({ protocol: /^https?$/ }).optional(),
});
const callbackQuery = z.object({
  code: z.string().max(4096).optional(),
  state: z.string().max(512).optional(),
  error: z.string().max(256).optional(),
});

function viewerOf(request: FastifyRequest) {
  const { user } = request;
  if (!user) throw httpError(401, 'signed_out');
  const member = (request as { member?: { workspaceId: string } | null }).member;
  return { ownerId: user.id, workspaceId: member?.workspaceId ?? STAND_IN_WORKSPACE_ID };
}

/** The connection id in the path; anything that isn't one is not found. */
function idOf(params: unknown): string {
  const { id } = z.object({ id: z.string() }).parse(params);
  if (!UUID.test(id)) throw httpError(404, 'not_found');
  return id.toLowerCase();
}

const shownIds = (connection: { calendars: { id: string; shown: boolean }[] } | undefined) =>
  connection?.calendars.filter((calendar) => calendar.shown).map((calendar) => calendar.id) ?? [];

const connectionRoutes: FastifyPluginAsync<ConnectionRoutesOptions> = async (app, options) => {
  const env = options.env ?? process.env;
  const log = { warn: (message: string) => app.log.warn(message) };
  const { CALENDAR_SECRET_KEY: key } = readSettings(calendarSecretSettingsSchema, { env, log });
  const box = secretBoxFrom(key);
  if (key && !box) log.warn("CALENDAR_SECRET_KEY isn't 32 bytes in base64, so it counts as unset.");
  const fetch = options.fetch ?? globalThis.fetch;
  const google = createGoogleOAuth(readSettings(googleSettingsSchema, { env, log }), { fetch });
  const publicUrl = readSettings(publicUrlSchema, { env, log }).CAREHUB_PUBLIC_URL;
  if (google.configured && !publicUrl) log.warn('Google sign-in needs CAREHUB_PUBLIC_URL.');
  const connect: GoogleConnectDeps | undefined =
    box && google.configured && publicUrl
      ? { db: app.db, box, google, fetch, redirectUri: googleRedirectUri(publicUrl) }
      : undefined;
  const googleOff = !box
    ? CONNECTIONS_OFF_MESSAGE
    : connect
      ? undefined
      : GOOGLE_SIGN_IN_MESSAGES['missing-settings'];

  const changed = (ownerId: string, calendarIds: readonly string[]) => {
    for (const id of new Set(calendarIds)) {
      publishToUsers([ownerId], {
        type: CALENDAR_CHANGED,
        data: { layerId: connectedLayerId(id) },
      });
    }
  };
  const sync = createCalendarSync({
    store: pgSyncStore(app.db),
    box,
    google: google.configured ? google : undefined,
    fetch,
    readLink: options.readLink,
    notify: sendNotice,
    changed,
    log: (message, error) => app.log.warn({ err: error }, message),
  });
  let open = true;
  app.addHook('onClose', async () => {
    open = false;
  });
  registerPeriodicTask('calendar.sync', 60_000, async () => {
    if (open) await sync.runDue();
  });

  const findMine = async (ownerId: string, id: string) =>
    (await listConnections(app.db, ownerId)).find((connection) => connection.id === id);

  /** The person's connections, and a plain sentence for a way of connecting that's off here. */
  const answer = async (ownerId: string) => ({
    connections: await listConnections(app.db, ownerId),
    unavailable: { google: googleOff ?? null },
  });

  app.get('/connections', async (request) => answer(viewerOf(request).ownerId));

  const sessionKeyOf = options.sessionKey ?? signInSessionKey;

  app.post('/connections/google', async (request) => {
    const viewer = viewerOf(request);
    const sessionKey = sessionKeyOf(request);
    if (!sessionKey) throw httpError(401, 'signed_out');
    const { connectionId } = googleConnectSchema.parse(request.body ?? {});
    if (!connect) throw httpError(409, 'conflict', googleOff);
    return startGoogleConnect(connect, { ...viewer, sessionKey, connectionId });
  });

  // Google sends the person here after its sign-in screen, as a page load.
  app.get('/google/callback', { config: { public: true } }, async (request, reply) => {
    // Every problem code has a sentence for the screen in the package (CONNECT_PROBLEMS).
    const back = (query: { problem: ProblemCode } | { connected: string }) =>
      reply.redirect(`${CONNECTIONS_SCREEN}?${new URLSearchParams(query).toString()}`);
    const { user } = request;
    const sessionKey = sessionKeyOf(request);
    if (!user || !sessionKey) return back({ problem: 'signed-out' });
    if (!connect) return back({ problem: 'missing-settings' });
    const query = callbackQuery.safeParse(request.query);
    if (!query.success) return back({ problem: 'sign-in-failed' });
    const result = await finishGoogleConnect(connect, {
      ownerId: user.id,
      sessionKey,
      query: query.data,
    });
    if ('problem' in result) return back({ problem: result.problem });
    changed(user.id, shownIds(await findMine(user.id, result.connectionId)));
    return back({ connected: result.connectionId });
  });

  app.patch('/connections/:id', async (request) => {
    const { ownerId } = viewerOf(request);
    const id = idOf(request.params);
    const body = connectionPatchSchema.parse(request.body);
    const before = await findMine(ownerId, id);
    if (!before) throw httpError(404, 'not_found');
    const choices = (body.calendars ?? []).map((choice) => {
      const calendar = before.calendars.find((one) => one.id === choice.id.toLowerCase());
      if (!calendar) throw httpError(404, 'not_found');
      return { calendar, shown: choice.shown };
    });
    if (body.label !== undefined) await renameConnection(app.db, ownerId, id, body.label);
    for (const { calendar, shown } of choices) {
      if (calendar.shown !== shown) await setCalendarShown(app.db, ownerId, calendar.id, shown);
    }
    const after = await findMine(ownerId, id);
    const touched = choices.map((choice) => choice.calendar.id);
    changed(ownerId, body.label === undefined ? touched : [...touched, ...shownIds(after)]);
    return { connection: after };
  });

  app.delete('/connections/:id', async (request, reply) => {
    const { ownerId } = viewerOf(request);
    const id = idOf(request.params);
    const before = await findMine(ownerId, id);
    const removed = before && (await removeConnection(app.db, ownerId, id));
    if (!removed) throw httpError(404, 'not_found');
    changed(ownerId, shownIds(before));
    if (removed.kind === 'google') await endGrant(removed);
    return reply.code(204).send();
  });

  /** Retry, or "Sync now": reads one connection at once. */
  app.post('/connections/:id/sync', async (request) => {
    const { ownerId } = viewerOf(request);
    const id = idOf(request.params);
    if (!(await findMine(ownerId, id))) throw httpError(404, 'not_found');
    if (!box) throw httpError(409, 'conflict', CONNECTIONS_OFF_MESSAGE);
    if (!(await sync.syncNow(ownerId, id))) {
      throw httpError(409, 'conflict', 'This calendar is being read right now. Try again shortly.');
    }
    return { connection: await findMine(ownerId, id) };
  });

  /** Calendar opened: reads what wasn't read in the last minute, waiting up to 8 seconds. */
  app.post('/connections/refresh', async (request) => {
    const { ownerId } = viewerOf(request);
    const ids = (await listConnections(app.db, ownerId)).map((connection) => connection.id);
    const run = sync.refresh(ownerId, ids).catch((error: unknown) => {
      app.log.warn({ err: error }, 'Reading calendars on Calendar open failed.');
    });
    let timer: NodeJS.Timeout | undefined;
    const waited = new Promise((resolve) => {
      timer = setTimeout(resolve, REFRESH_WAIT_MS);
    });
    await Promise.race([run, waited]);
    clearTimeout(timer);
    return answer(ownerId);
  });

  /** After Remove: ends the Google grant too, unless another connection uses that account. */
  async function endGrant(removed: { id: string; account: string | null; secret: string }) {
    if (!box) return;
    try {
      if (removed.account && (await isAccountConnected(app.db, 'google', removed.account))) return;
      const context = connectionSecretContext(removed.id);
      const tokens = openJson(box, removed.secret, context, googleTokensSchema);
      await google.revoke(tokens.refreshToken);
    } catch (error) {
      app.log.warn({ err: error }, "Couldn't end a removed connection's Google sign-in.");
    }
  }
};

export default connectionRoutes;
