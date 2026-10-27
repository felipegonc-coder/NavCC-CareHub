// Push subscriptions and notification settings in Postgres (schema.ts). testing.ts has the same
// store in memory for unit tests; store.test.ts runs the same checks on both.
import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm';
import type { Db } from '../../db';
import { DEFAULT_PREFERENCES } from './domain/preferences';
import { pushPreferences, pushSubscriptions } from './schema';
import { MAX_SUBSCRIPTIONS_PER_PERSON, type PushStore, type PushSubscriptionRecord } from './types';

const subscriptions = pushSubscriptions;
type Row = typeof pushSubscriptions.$inferSelect;
const preferenceColumns = {
  notifyAbout: pushPreferences.notifyAbout,
  showText: pushPreferences.showText,
};

export function createPostgresPushStore(db: Db): PushStore {
  return {
    saveSubscription: ({ replaces, ...subscription }, now) =>
      db.transaction(async (tx) => {
        const { userId, endpoint, keys, device, expiresAt } = subscription;
        // A browser someone else saved before, such as a shared computer, stops being theirs.
        await tx
          .delete(subscriptions)
          .where(and(eq(subscriptions.endpoint, endpoint), ne(subscriptions.userId, userId)));
        if (replaces && replaces !== endpoint) {
          await tx
            .delete(subscriptions)
            .where(and(eq(subscriptions.userId, userId), eq(subscriptions.endpoint, replaces)));
        }
        const changes = { userId, p256dh: keys.p256dh, auth: keys.auth, device, expiresAt };
        const [row] = await tx
          .insert(subscriptions)
          .values({ ...changes, endpoint, createdAt: now, lastUsedAt: now })
          .onConflictDoUpdate({
            target: subscriptions.endpoint,
            set: { ...changes, lastUsedAt: now },
          })
          .returning();
        if (!row) throw new Error('The push subscription was not saved.');
        const older = await tx
          .select({ id: subscriptions.id })
          .from(subscriptions)
          .where(and(eq(subscriptions.userId, userId), ne(subscriptions.id, row.id)))
          .orderBy(desc(subscriptions.lastUsedAt), desc(subscriptions.createdAt))
          .offset(MAX_SUBSCRIPTIONS_PER_PERSON - 1);
        if (older.length > 0) {
          const ids = older.map(({ id }) => id);
          await tx.delete(subscriptions).where(inArray(subscriptions.id, ids));
        }
        return toRecord(row);
      }),

    async listSubscriptions(userId) {
      const rows = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.userId, userId))
        .orderBy(asc(subscriptions.createdAt), asc(subscriptions.id));
      return rows.map(toRecord);
    },

    async deleteSubscription(userId, which) {
      const match =
        'id' in which ? eq(subscriptions.id, which.id) : eq(subscriptions.endpoint, which.endpoint);
      const deleted = await db
        .delete(subscriptions)
        .where(and(eq(subscriptions.userId, userId), match))
        .returning({ id: subscriptions.id });
      return deleted.length > 0;
    },

    async forgetEndpoints(endpoints) {
      if (endpoints.length === 0) return;
      await db.delete(subscriptions).where(inArray(subscriptions.endpoint, [...endpoints]));
    },

    async markUsed(subscriptionIds, now) {
      if (subscriptionIds.length === 0) return;
      await db
        .update(subscriptions)
        .set({ lastUsedAt: now })
        .where(inArray(subscriptions.id, [...subscriptionIds]));
    },

    async getPreferences(userId) {
      const [row] = await db
        .select(preferenceColumns)
        .from(pushPreferences)
        .where(eq(pushPreferences.userId, userId));
      return row ?? { ...DEFAULT_PREFERENCES };
    },

    async updatePreferences(userId, changes, now) {
      const [row] = await db
        .insert(pushPreferences)
        .values({ ...DEFAULT_PREFERENCES, ...changes, userId, updatedAt: now })
        .onConflictDoUpdate({ target: pushPreferences.userId, set: { ...changes, updatedAt: now } })
        .returning(preferenceColumns);
      if (!row) throw new Error('The notification settings were not saved.');
      return row;
    },
  };
}

function toRecord({ p256dh, auth, ...row }: Row): PushSubscriptionRecord {
  return { ...row, keys: { p256dh, auth } };
}
