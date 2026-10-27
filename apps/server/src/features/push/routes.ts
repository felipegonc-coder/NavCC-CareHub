// /api/push: the server's public key, the person's browsers and their notification settings.
// Every route needs a signed-in person; the auth plugin checks CSRF and Origin on changes.
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { httpError } from '../../core/errors';
import { changedPreferences, preferencesPatch } from './domain/preferences';
import {
  deviceName,
  subscriptionBody,
  subscriptionParams,
  unsubscribeBody,
} from './domain/subscription';
import {
  PUSH_OFF_MESSAGE,
  pushSettingsSchema,
  resolvePushConfig,
  type PushConfig,
} from './settings';
import { createPostgresPushStore } from './store';
import type { PushStore, PushSubscriptionRecord } from './types';

export interface PushRoutesOptions {
  /** The signed-in person's id, or null (401). Defaults to `request.user?.id`. */
  getUserId?: (request: FastifyRequest) => string | null | undefined;
  /** Defaults to Postgres on `app.db`. */
  store?: PushStore;
  /** Defaults to the PUSH_VAPID_* settings. */
  config?: PushConfig;
  now?: () => Date;
}

/** A browser in Settings → Notifications. Never the endpoint or keys. */
export interface PushDeviceView {
  id: string;
  device: string;
  createdAt: string;
  lastUsedAt: string;
}

const pushRoutes: FastifyPluginAsync<PushRoutesOptions> = async (app, options) => {
  const store = options.store ?? (app.hasDecorator('db') ? createPostgresPushStore(app.db) : null);
  if (!store) throw new Error('The push routes need a database or a store.');
  // From the environment until core/settings.ts (readSettings) is on main.
  const config = options.config ?? resolvePushConfig(pushSettingsSchema.parse(process.env));
  if (!config.enabled) app.log.info(config.message); // For site admins: it says what's missing.
  const getUserId = options.getUserId ?? ((request: FastifyRequest) => request.user?.id);
  const now = options.now ?? (() => new Date());

  function userOf(request: FastifyRequest): string {
    const userId = getUserId(request);
    if (!userId) throw httpError(401, 'signed_out');
    return userId;
  }

  app.get('/key', async (request) => {
    userOf(request);
    return { publicKey: config.enabled ? config.publicKey : null };
  });

  app.get('/subscriptions', async (request) => {
    const subscriptions = await store.listSubscriptions(userOf(request));
    return { subscriptions: subscriptions.map(toDeviceView) };
  });

  // Turning notifications on in this browser, and again at each start (push-client.ts).
  app.post('/subscriptions', async (request, reply) => {
    const userId = userOf(request);
    if (!config.enabled) throw httpError(409, 'conflict', PUSH_OFF_MESSAGE);
    const body = subscriptionBody.parse(request.body);
    const saved = await store.saveSubscription(
      {
        userId,
        endpoint: body.endpoint,
        keys: body.keys,
        device: deviceName(request.headers['user-agent']),
        expiresAt: body.expirationTime ? new Date(Math.round(body.expirationTime)) : null,
        replaces: body.replaces,
      },
      now(),
    );
    return reply.code(201).send({ subscription: toDeviceView(saved) });
  });

  // Turning notifications off in this browser.
  app.delete('/subscriptions', async (request, reply) => {
    const userId = userOf(request);
    const { endpoint } = unsubscribeBody.parse(request.body);
    await store.deleteSubscription(userId, { endpoint });
    return reply.code(204).send();
  });

  // Removing another of the person's browsers from Settings → Notifications.
  app.delete('/subscriptions/:subscriptionId', async (request, reply) => {
    const userId = userOf(request);
    const params = subscriptionParams.safeParse(request.params);
    const deleted =
      params.success &&
      (await store.deleteSubscription(userId, { id: params.data.subscriptionId }));
    if (!deleted) throw httpError(404, 'not_found');
    return reply.code(204).send();
  });

  app.get('/preferences', async (request) => ({
    preferences: await store.getPreferences(userOf(request)),
  }));

  app.patch('/preferences', async (request) => {
    const userId = userOf(request);
    const changes = changedPreferences(preferencesPatch.parse(request.body ?? {}));
    return { preferences: await store.updatePreferences(userId, changes, now()) };
  });
};

export default pushRoutes;

function toDeviceView({
  id,
  device,
  createdAt,
  lastUsedAt,
}: PushSubscriptionRecord): PushDeviceView {
  return { id, device, createdAt: createdAt.toISOString(), lastUsedAt: lastUsedAt.toISOString() };
}
