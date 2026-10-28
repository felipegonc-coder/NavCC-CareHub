import type { BuiltInRoleKey, MembershipKind, PermissionKey } from '@carehub/shared';
import { sql } from 'drizzle-orm';
import { boolean, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from '../auth/schema';

// Mirrors migrations/202610270035_workspaces_members-and-roles.sql, the source of truth (a test compares them).

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const roles = pgTable('roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  /** Set for the built-in roles only. */
  builtinKey: text('builtin_key').$type<BuiltInRoleKey>(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  permissions: text('permissions')
    .array()
    .$type<PermissionKey[]>()
    .notNull()
    .default(sql`'{}'`),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<MembershipKind>().notNull().default('member'),
    /** Null for guests. References roles (workspace_id, id), so the role is in the same workspace. */
    roleId: uuid('role_id'),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    removedAt: timestamp('removed_at', { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.userId] })],
);
