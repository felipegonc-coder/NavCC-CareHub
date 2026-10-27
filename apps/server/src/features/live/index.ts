import { createLiveHub, type CanSubscribe } from './domain/hub';
import type { LiveEvent } from './domain/frames';

export type { LiveEvent } from './domain/frames';
export type { CanSubscribe } from './domain/hub';

/** The app-wide hub: one per server process, in memory, best effort, no replay. */
export const liveHub = createLiveHub();

/** Sends `event` to every open tab of these users. Call it after the database commit. */
export function publishToUsers(userIds: readonly string[], event: LiveEvent): void {
  liveHub.publishToUsers(userIds, event);
}

/** Sends `event` to every tab subscribed to `topic`, for example `chat:<conversationId>`. */
export function publishTopic(topic: string, event: LiveEvent): void {
  liveHub.publishTopic(topic, event);
}

/** Makes `prefix` (such as `chat`) yours; `canSubscribe` decides who may hear `<prefix>:<id>`. */
export function registerTopic(prefix: string, canSubscribe: CanSubscribe): void {
  liveHub.registerTopic(prefix, canSubscribe);
}

/**
 * Checks this user's topics again now (every user's when omitted). Call it after an access
 * change; topics they lost end with `unsubscribed`.
 */
export function recheckSubscriptions(userId?: string): Promise<void> {
  return liveHub.recheckSubscriptions(userId);
}

/** True while this user has at least one tab connected to this server, so push can skip them. */
export function hasOpenTabs(userId: string): boolean {
  return liveHub.hasOpenTabs(userId);
}
