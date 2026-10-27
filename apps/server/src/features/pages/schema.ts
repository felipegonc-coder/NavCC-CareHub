// Drizzle tables for migrations/202610270030_pages_spaces_access.sql.
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { GrantLevel } from './levels';

const time = (name: string) => timestamp(name, { withTimezone: true });

export const accessGrants = pgTable('access_grants', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  spaceId: uuid('space_id'),
  pageId: uuid('page_id'),
  principalType: text('principal_type', { enum: ['user', 'role', 'group', 'everyone'] }).notNull(),
  principalId: uuid('principal_id'),
  level: text('level').$type<GrantLevel>().notNull(),
  grantedBy: uuid('granted_by'),
  createdAt: time('created_at').notNull().defaultNow(),
});
export type AccessGrant = typeof accessGrants.$inferSelect;

export const accessHistory = pgTable('access_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  changedBy: uuid('changed_by'),
  spaceId: uuid('space_id'),
  pageId: uuid('page_id'),
  principalType: text('principal_type').notNull(),
  principalId: uuid('principal_id'),
  beforeLevel: text('before_level').$type<GrantLevel>(),
  afterLevel: text('after_level').$type<GrantLevel>(),
  createdAt: time('created_at').notNull().defaultNow(),
});
