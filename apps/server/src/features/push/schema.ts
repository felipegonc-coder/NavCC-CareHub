import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { NOTIFY_ABOUT } from './domain/preferences';

// Mirrors migrations/202610270400_push_tables.sql and 202610271000_push_pause.sql, which are the
// source of truth (store.test.ts compares them). The foreign keys to `users` are only in the SQL:
// features don't import each other's tables.

const at = (name: string) => timestamp(name, { withTimezone: true });

/** One row per browser that gets a person's notifications when Care Hub isn't open. */
export const pushSubscriptions = pgTable('push_subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  /** Unique: an endpoint is one browser, so it belongs to whoever saved it last. */
  endpoint: text('endpoint').notNull(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  device: text('device').notNull(),
  expiresAt: at('expires_at'),
  createdAt: at('created_at').notNull().defaultNow(),
  lastUsedAt: at('last_used_at').notNull().defaultNow(),
});

/** Each person's notification settings. No row means the defaults. */
export const pushPreferences = pgTable('push_preferences', {
  userId: uuid('user_id').primaryKey(),
  notifyAbout: text('notify_about', { enum: NOTIFY_ABOUT }).notNull().default('all'),
  showText: boolean('show_text').notNull().default(true),
  updatedAt: at('updated_at').notNull().defaultNow(),
  /** When notifications were paused. Empty: not paused. */
  pausedAt: at('paused_at'),
  /** When the pause ends. Empty while paused: until the person turns them back on. */
  pausedUntil: at('paused_until'),
});
