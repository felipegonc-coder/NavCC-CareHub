// Sends one notification to every browser where a person turned notifications on, and tidies up
// after: subscriptions that expired or were turned off are deleted, the rest marked as used.
import { buildPushPayload, type PushNotice } from './payload';
import { sendPush, topicFor, type PushUrgency } from './sender';
import type { PushConfig } from './settings';
import type { PushStore } from './types';

export interface PushRuntime {
  store: PushStore;
  /** From `resolvePushConfig` (settings.ts). While push is off, nothing is sent. */
  config: PushConfig;
  fetch: typeof fetch;
  now?: () => Date;
  /** For sends that fail. Never given the payload, endpoint or keys. */
  log?: { warn: (details: Record<string, unknown>, message: string) => void };
}

export interface PushSummary {
  /** Browsers the push services took it for. */
  sent: number;
  /** Subscriptions deleted because they expired or were turned off. */
  removed: number;
  /** Browsers it couldn't be sent to this time. */
  failed: number;
}

export interface PushToUserOptions {
  /** "high" suits reminders. Default "normal". */
  urgency?: PushUrgency;
}

/**
 * Builds the notification with the person's "Show message text" setting and sends it to each of
 * their browsers at once. A newer notification with the same tag replaces one not yet delivered.
 */
export async function pushToUser(
  runtime: PushRuntime,
  userId: string,
  notice: PushNotice,
  options: PushToUserOptions = {},
): Promise<PushSummary> {
  const { config, store } = runtime;
  const summary: PushSummary = { sent: 0, removed: 0, failed: 0 };
  if (!config.enabled) return summary;
  const subscriptions = await store.listSubscriptions(userId);
  if (subscriptions.length === 0) return summary;

  const now = runtime.now?.() ?? new Date();
  const { showText } = await store.getPreferences(userId);
  const payload = buildPushPayload(notice, { showText });
  const sender = { fetch: runtime.fetch, vapid: config.vapid };
  const sendOptions = { urgency: options.urgency, topic: topicFor(notice.tag), now };
  const gone: string[] = [];
  const delivered: string[] = [];

  await Promise.all(
    subscriptions.map(async (subscription) => {
      if (subscription.expiresAt && subscription.expiresAt <= now) {
        gone.push(subscription.endpoint);
        return;
      }
      try {
        const outcome = await sendPush(sender, subscription, payload, sendOptions);
        if (outcome.result === 'delivered') delivered.push(subscription.id);
        else if (outcome.result === 'gone') gone.push(subscription.endpoint);
        else {
          summary.failed += 1;
          runtime.log?.warn(
            { subscriptionId: subscription.id, ...outcome },
            'A push notification was not sent.',
          );
        }
      } catch (error) {
        summary.failed += 1;
        runtime.log?.warn(
          { subscriptionId: subscription.id, err: error },
          'A push notification could not be sent.',
        );
      }
    }),
  );

  if (gone.length > 0) await store.forgetEndpoints(gone);
  if (delivered.length > 0) await store.markUsed(delivered, now);
  return { ...summary, sent: delivered.length, removed: gone.length };
}
