import { jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { PageIcon } from '@carehub/shared';

// Matches migrations/202610270100_workspaces_spaces.sql.
export const spaces = pgTable('spaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  name: text('name').notNull(),
  icon: jsonb('icon').$type<PageIcon>(),
  kind: text('kind', { enum: ['team', 'private'] }).notNull(),
  ownerId: uuid('owner_id'),
  visibility: text('visibility', { enum: ['workspace', 'members'] }),
  position: text('position').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const spaceMembers = pgTable(
  'space_members',
  {
    spaceId: uuid('space_id').notNull(),
    userId: uuid('user_id').notNull(),
    role: text('role', { enum: ['editor', 'commenter', 'viewer'] }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.spaceId, table.userId] })],
);

export type SpaceRow = typeof spaces.$inferSelect;
