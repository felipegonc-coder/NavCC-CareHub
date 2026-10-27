import {
  BUILT_IN_ROLES,
  BUILT_IN_ROLE_KEYS,
  MAX_CUSTOM_ROLES,
  permissionKeySchema,
  roleNameSchema,
  type BuiltInRoleKey,
  type PermissionKey,
} from '@carehub/shared';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { httpError } from '../../core/errors';
import { isUniqueViolation, type Db, type Tx } from '../../db';
import { roles } from '../workspaces/schema';

export interface Role {
  id: string;
  workspaceId: string;
  /** Set for the built-in roles only. */
  builtinKey: BuiltInRoleKey | null;
  name: string;
  description: string;
  permissions: PermissionKey[];
}

const roleColumns = {
  id: roles.id,
  workspaceId: roles.workspaceId,
  builtinKey: roles.builtinKey,
  name: roles.name,
  description: roles.description,
  permissions: roles.permissions,
};

/** Creates the workspace's built-in roles, or brings them back in line with BUILT_IN_ROLES. */
export async function syncBuiltInRoles(db: Db | Tx, workspaceId: string): Promise<void> {
  await db
    .insert(roles)
    .values(
      BUILT_IN_ROLE_KEYS.map((key) => ({
        workspaceId,
        builtinKey: key,
        name: BUILT_IN_ROLES[key].name,
        description: BUILT_IN_ROLES[key].description,
        permissions: [...BUILT_IN_ROLES[key].permissions],
      })),
    )
    .onConflictDoUpdate({
      target: [roles.workspaceId, roles.builtinKey],
      set: {
        name: sql`excluded.name`,
        description: sql`excluded.description`,
        permissions: sql`excluded.permissions`,
        updatedAt: sql`now()`,
      },
      setWhere: sql`(roles.name, roles.description, roles.permissions)
        IS DISTINCT FROM (excluded.name, excluded.description, excluded.permissions)`,
    });
}

export async function getBuiltInRoleId(
  db: Db | Tx,
  workspaceId: string,
  key: BuiltInRoleKey,
): Promise<string> {
  const [role] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.workspaceId, workspaceId), eq(roles.builtinKey, key)))
    .limit(1);
  if (!role) throw new Error(`The built-in role ${key} is missing.`);
  return role.id;
}

const customRoleSchema = z.object({
  workspaceId: z.uuid(),
  name: roleNameSchema,
  description: z.string().trim().max(200).default(''),
  permissions: z.array(permissionKeySchema).refine((keys) => !keys.includes('workspace.admin'), {
    message: 'Admin settings belong to the built-in Admin role only.',
  }),
});

/**
 * A custom role: any mix of permissions except `workspace.admin`, a unique name of up to 40 characters,
 * and at most 20 per workspace. For Settings → Roles, seeds and tests.
 */
export async function createRole(
  db: Db | Tx,
  input: {
    workspaceId: string;
    name: string;
    permissions: readonly PermissionKey[];
    description?: string;
  },
): Promise<Role> {
  const { workspaceId, name, description, permissions } = customRoleSchema.parse(input);
  const taken = () =>
    httpError(409, 'conflict', `There's already a role called ${name}. Choose another name.`);
  const [counts] = await db
    .select({
      custom: sql<number>`(count(*) FILTER (WHERE ${roles.builtinKey} IS NULL))::int`,
      sameName: sql<number>`(count(*) FILTER (WHERE lower(${roles.name}) = lower(${name})))::int`,
    })
    .from(roles)
    .where(eq(roles.workspaceId, workspaceId));
  if (counts && counts.sameName > 0) throw taken();
  if (counts && counts.custom >= MAX_CUSTOM_ROLES) {
    throw httpError(
      413,
      'too_large',
      `A workspace can have up to ${MAX_CUSTOM_ROLES} custom roles.`,
    );
  }
  try {
    const [role] = await db
      .insert(roles)
      .values({ workspaceId, name, description, permissions: [...new Set(permissions)] })
      .returning(roleColumns);
    if (!role) throw new Error('The role was not saved.');
    return role;
  } catch (error) {
    if (isUniqueViolation(error, 'roles_workspace_name_key')) throw taken();
    throw error;
  }
}
