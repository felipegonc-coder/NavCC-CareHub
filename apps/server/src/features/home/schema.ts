// The Home settings table, as Drizzle sees it. The SQL is in the migration
// 202610270830_home_settings.sql, and routes.test.ts checks that the two agree.
import { sql } from 'drizzle-orm';
import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { HomeSectionId } from './types';

export const homeSettings = pgTable('home_settings', {
  userId: uuid('user_id').primaryKey(),
  hiddenSections: text('hidden_sections')
    .array()
    .$type<HomeSectionId[]>()
    .notNull()
    .default(sql`'{}'`),
  upcomingFolded: boolean('upcoming_folded').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
