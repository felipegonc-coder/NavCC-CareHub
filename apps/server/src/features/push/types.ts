// Where push subscriptions and notification settings are kept: store.ts (Postgres) in the app,
// testing.ts (memory) in unit tests.
import type { NotificationPreferences } from './domain/preferences';
import type { PushSubscriptionKeys } from './protocol/encrypt';

/** One browser that gets a person's notifications when Care Hub isn't open. */
export interface PushSubscriptionRecord {
  id: string;
  userId: string;
  endpoint: string;
  keys: PushSubscriptionKeys;
  /** Such as "Chrome on Windows". */
  device: string;
  /** When the browser said the subscription ends, if it did. */
  expiresAt: Date | null;
  createdAt: Date;
  /** When the browser last sent it, or a notification last reached it. */
  lastUsedAt: Date;
}

export type NewPushSubscription = Pick<
  PushSubscriptionRecord,
  'userId' | 'endpoint' | 'keys' | 'device' | 'expiresAt'
> & {
  /** The endpoint this one replaces. Deleted when it's the same person's. */
  replaces?: string | undefined;
};

/** The most browsers per person. Saving one more drops the one used longest ago. */
export const MAX_SUBSCRIPTIONS_PER_PERSON = 20;

export interface PushStore {
  /**
   * Adds this browser, or refreshes it (keys, device, last used). An endpoint is one browser, so
   * it belongs to whoever saved it last.
   */
  saveSubscription(subscription: NewPushSubscription, now: Date): Promise<PushSubscriptionRecord>;
  /** Oldest first. */
  listSubscriptions(userId: string): Promise<PushSubscriptionRecord[]>;
  /** One of this person's subscriptions. False when there was no such one. */
  deleteSubscription(
    userId: string,
    which: { endpoint: string } | { id: string },
  ): Promise<boolean>;
  /** After a push service said these subscriptions are gone. */
  forgetEndpoints(endpoints: readonly string[]): Promise<void>;
  markUsed(subscriptionIds: readonly string[], now: Date): Promise<void>;
  /** The defaults until the person changes something. */
  getPreferences(userId: string): Promise<NotificationPreferences>;
  updatePreferences(
    userId: string,
    changes: Partial<NotificationPreferences>,
    now: Date,
  ): Promise<NotificationPreferences>;
  /** Whether a site admin locked the person's account (`users.locked_at`). */
  isLocked(userId: string): Promise<boolean>;
}
