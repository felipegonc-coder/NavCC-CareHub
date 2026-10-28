import { boolean, integer, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Mirrors migrations/202610262300_auth_accounts.sql and the later *_auth_*.sql files, which are the
// source of truth (a test compares them).

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  avatarUrl: text('avatar_url'),
  /** Null until the person sets a password (invited accounts). */
  passwordHash: text('password_hash'),
  mustChangePassword: boolean('must_change_password').notNull().default(false),
  isSiteAdmin: boolean('is_site_admin').notNull().default(false),
  jobTitle: text('job_title'),
  timeZone: text('time_zone').notNull().default('America/Denver'),
  use24h: boolean('use_24h').notNull().default(false),
  weekStart: smallint('week_start').notNull().default(0),
  /** Locked by a site admin: no sign-in, and sessions stop working. */
  lockedAt: timestamp('locked_at', { withTimezone: true }),
  lastActiveAt: timestamp('last_active_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tokenHash: text('token_hash').notNull(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  userAgent: text('user_agent'),
  ipAddress: text('ip_address'),
});

/** Wrong passwords per sign-in name, known or not (see limits.ts). */
export const signInLimits = pgTable('sign_in_limits', {
  nameHash: text('name_hash').primaryKey(),
  failures: integer('failures').notNull().default(0),
  windowStartedAt: timestamp('window_started_at', { withTimezone: true }).notNull().defaultNow(),
  pausedUntil: timestamp('paused_until', { withTimezone: true }),
});
