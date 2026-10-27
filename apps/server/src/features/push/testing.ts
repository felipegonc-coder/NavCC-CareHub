// A push store in memory for unit tests, with the same rules as store.ts (store.test.ts checks
// both). Never imported by shipped code.
import { randomUUID } from 'node:crypto';
import { DEFAULT_PREFERENCES, type NotificationPreferences } from './domain/preferences';
import { MAX_SUBSCRIPTIONS_PER_PERSON, type PushStore, type PushSubscriptionRecord } from './types';

export interface MemoryPushStore extends PushStore {
  /** Every saved subscription, for checks in tests. */
  readonly subscriptions: PushSubscriptionRecord[];
}

export function createMemoryPushStore(): MemoryPushStore {
  const subscriptions: PushSubscriptionRecord[] = [];
  const preferences = new Map<string, NotificationPreferences>();
  /** Deletes the subscriptions that match and says how many there were. */
  const remove = (matches: (subscription: PushSubscriptionRecord) => boolean): number => {
    const kept = subscriptions.filter((subscription) => !matches(subscription));
    const removed = subscriptions.length - kept.length;
    subscriptions.splice(0, subscriptions.length, ...kept);
    return removed;
  };
  const copy = (saved: PushSubscriptionRecord) => ({ ...saved, keys: { ...saved.keys } });

  return {
    subscriptions,

    async saveSubscription({ replaces, ...subscription }, now) {
      const { userId, endpoint } = subscription;
      remove((other) => other.endpoint === endpoint && other.userId !== userId);
      if (replaces && replaces !== endpoint) {
        remove((other) => other.userId === userId && other.endpoint === replaces);
      }
      const keys = { ...subscription.keys };
      let saved = subscriptions.find((other) => other.endpoint === endpoint);
      if (saved) {
        Object.assign(saved, { ...subscription, keys, lastUsedAt: now });
      } else {
        saved = { id: randomUUID(), ...subscription, keys, createdAt: now, lastUsedAt: now };
        subscriptions.push(saved);
      }
      const current = saved;
      const older = subscriptions
        .filter((other) => other.userId === userId && other !== current)
        .sort((a, b) => b.lastUsedAt.getTime() - a.lastUsedAt.getTime())
        .slice(MAX_SUBSCRIPTIONS_PER_PERSON - 1);
      remove((other) => older.includes(other));
      return copy(current);
    },

    async listSubscriptions(userId) {
      return subscriptions
        .filter((subscription) => subscription.userId === userId)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map(copy);
    },

    async deleteSubscription(userId, which) {
      const matches = (subscription: PushSubscriptionRecord) =>
        'id' in which ? subscription.id === which.id : subscription.endpoint === which.endpoint;
      return remove((subscription) => subscription.userId === userId && matches(subscription)) > 0;
    },

    async forgetEndpoints(endpoints) {
      remove((subscription) => endpoints.includes(subscription.endpoint));
    },

    async markUsed(subscriptionIds, now) {
      for (const subscription of subscriptions) {
        if (subscriptionIds.includes(subscription.id)) subscription.lastUsedAt = now;
      }
    },

    async getPreferences(userId) {
      return { ...(preferences.get(userId) ?? DEFAULT_PREFERENCES) };
    },

    async updatePreferences(userId, changes) {
      const updated = { ...DEFAULT_PREFERENCES, ...preferences.get(userId), ...changes };
      preferences.set(userId, updated);
      return { ...updated };
    },
  };
}
