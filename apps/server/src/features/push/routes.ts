// /api/push: the server's public key, the person's browsers, a test notification and the
// notification settings. Every route needs a signed-in person; the auth plugin checks CSRF and
// Origin on changes. While push is on, new notices and messages are pushed (delivery.ts).
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { httpError } from '../../core/errors';
import { readSettings } from '../../core/settings';
import { NOTICE_CREATED_EVENT } from '../notices';
import { createPushDelivery, type DeliverySources } from './delivery';
import {
  activePause,
  canPause,
  changedPreferences,
  PAUSE_END_MESSAGE,
  preferencesPatch,
  type NotificationPreferences,
  type NotifyAbout,
} from './domain/preferences';
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
import type { PushNotice } from './payload';
import { pushToUser } from './service';
import { deliverySources } from './sources';
import { createPostgresPushStore } from './store';
import type { PushStore, PushSubscriptionRecord } from './types';

export interface PushRoutesOptions {
  /** The signed-in person's id, or null (401). Defaults to `request.user?.id`. */
  getUserId?: (request: FastifyRequest) => string | null | undefined;
  /** Defaults to Postgres on `app.db`. */
  store?: PushStore;
  /** Defaults to the PUSH_VAPID_* settings. */
  config?: PushConfig;
  fetch?: typeof fetch;
  now?: () => Date;
  /** Defaults to the live, notices and messages features on `app.db`. */
  sources?: DeliverySources;
}

/** A browser in Settings → Notifications. Never the endpoint or keys. */
export interface PushDeviceView {
  id: string;
  device: string;
  createdAt: string;
  lastUsedAt: string;
}

/** Settings → Notifications. A pause that has ended reads as none. */
export interface PreferencesView {
  notifyAbout: NotifyAbout;
  showText: boolean;
  /** `until` is an ISO instant, or null: until the person turns notifications back on. */
  pause: { until: string | null } | null;
}

/** One test notification per person per this long. */
export const TEST_COOLDOWN_MS = 10_000;

const TEST_NOTICE: PushNotice = {
  kind: 'notice',
  from: 'Care Hub',
  what: 'Test notification',
  text: 'Notifications work on this device.',
  url: '/settings/notifications',
  tag: 'push-test',
};

const pushRoutes: FastifyPluginAsync<PushRoutesOptions> = async (app, options) => {
  const store = options.store ?? (app.hasDecorator('db') ? createPostgresPushStore(app.db) : null);
  if (!store) throw new Error('The push routes need a database or a store.');
  // The PUSH_VAPID_* settings. While any is missing, push is off and the routes say so.
  const config =
    options.config ?? resolvePushConfig(readSettings(pushSettingsSchema, { log: app.log }));
  if (!config.enabled) app.log.info(config.message); // For site admins: it says what's missing.
  const getUserId = options.getUserId ?? ((request: FastifyRequest) => request.user?.id);
  const now = options.now ?? (() => new Date());
  const lastTests = new Map<string, number>();

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

  // "Send a test notification" in Settings → Notifications: to all of the person's browsers.
  app.post('/test', async (request) => {
    const userId = userOf(request);
    if (!config.enabled) throw httpError(409, 'conflict', PUSH_OFF_MESSAGE);
    const time = now().getTime();
    const last = lastTests.get(userId);
    if (last !== undefined && time - last < TEST_COOLDOWN_MS) {
      throw httpError(429, 'rate_limited', 'A test notification was just sent. Wait a moment.');
    }
    for (const [id, at] of lastTests) if (time - at >= TEST_COOLDOWN_MS) lastTests.delete(id);
    lastTests.set(userId, time);
    const runtime = { store, config, fetch: options.fetch ?? fetch, now, log: request.log };
    return pushToUser(runtime, userId, TEST_NOTICE, { urgency: 'high' });
  });

  app.get('/preferences', async (request) => {
    const preferences = await store.getPreferences(userOf(request));
    return { preferences: toPreferencesView(preferences, now()) };
  });

  app.patch('/preferences', async (request) => {
    const userId = userOf(request);
    const changes = changedPreferences(preferencesPatch.parse(request.body ?? {}));
    const time = now();
    if (changes.pause && !canPause(changes.pause, time)) {
      throw httpError(400, 'invalid', PAUSE_END_MESSAGE);
    }
    const preferences = await store.updatePreferences(userId, changes, time);
    return { preferences: toPreferencesView(preferences, time) };
  });

  // New notices and messages: a push to each person who should hear about them.
  const sources = options.sources ?? (app.hasDecorator('db') ? deliverySources(app.db) : null);
  if (config.enabled && sources && app.hasDecorator('events')) {
    const runtime = { store, config, fetch: options.fetch ?? fetch, now, log: app.log };
    const delivery = createPushDelivery(runtime, sources);
    app.events.on(NOTICE_CREATED_EVENT, async (event) => {
      await delivery.noticeCreated(event);
    });
    app.events.on('messages.message.created', async (event) => {
      await delivery.messageCreated(event);
    });
  }
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

function toPreferencesView(
  { pause, ...settings }: NotificationPreferences,
  now: Date,
): PreferencesView {
  const active = activePause(pause, now);
  return { ...settings, pause: active && { until: active.until?.toISOString() ?? null } };
}
