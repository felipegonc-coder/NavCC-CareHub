import {
  PERMISSION_KEYS,
  type BuiltInRoleKey,
  type CurrentMemberJson,
  type MembershipKind,
  type PermissionKey,
  type WorkspaceSummary,
} from '@carehub/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Db, Tx } from '../../db';
import { getBuiltInRoleId, syncBuiltInRoles } from '../roles/service';
import { roles, workspaceMembers, workspaces } from './schema';

export const DEFAULT_WORKSPACE_NAME = 'Care Hub';

/**
 * `request.member`: the signed-in person's place in the current workspace. Guests have no role and no
 * permissions (`hasPermission` is false for them); the pages they're given decide what they can do.
 */
export type CurrentMember =
  | {
      kind: 'member';
      workspaceId: string;
      roleId: string;
      roleName: string;
      permissions: ReadonlySet<PermissionKey>;
      /** The role has `workspace.admin`. */
      isAdmin: boolean;
    }
  | {
      kind: 'guest';
      workspaceId: string;
      roleId: null;
      roleName: null;
      permissions: ReadonlySet<PermissionKey>;
      isAdmin: false;
    };

const isPermissionKey = (key: string): key is PermissionKey =>
  (PERMISSION_KEYS as readonly string[]).includes(key);

/**
 * Makes sure the current workspace exists and its built-in roles match BUILT_IN_ROLES. Runs at start-up.
 * Each step is idempotent, so it's safe when several servers start at once.
 */
export async function syncDefaultWorkspace(db: Db | Tx): Promise<WorkspaceSummary> {
  await db.execute(
    sql`INSERT INTO workspaces (name, is_default) VALUES (${DEFAULT_WORKSPACE_NAME}, true)
        ON CONFLICT (is_default) WHERE is_default DO NOTHING`,
  );
  const workspace = await getDefaultWorkspace(db);
  if (!workspace) throw new Error('The default workspace could not be created.');
  await syncBuiltInRoles(db, workspace.id);
  return workspace;
}

/** The current workspace (Care Hub has one for now). */
export async function getDefaultWorkspace(db: Db | Tx): Promise<WorkspaceSummary | null> {
  const [row] = await db
    .select({ id: workspaces.id, name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.isDefault, true))
    .limit(1);
  return row ?? null;
}

/** The person's membership of the current workspace, or null (not in it, or removed). */
export async function getCurrentMember(db: Db | Tx, userId: string): Promise<CurrentMember | null> {
  const [row] = await db
    .select({
      workspaceId: workspaceMembers.workspaceId,
      kind: workspaceMembers.kind,
      roleId: roles.id,
      roleName: roles.name,
      permissions: roles.permissions,
    })
    .from(workspaceMembers)
    .innerJoin(
      workspaces,
      and(eq(workspaces.id, workspaceMembers.workspaceId), eq(workspaces.isDefault, true)),
    )
    .leftJoin(roles, eq(roles.id, workspaceMembers.roleId))
    .where(and(eq(workspaceMembers.userId, userId), isNull(workspaceMembers.removedAt)))
    .limit(1);
  if (!row) return null;
  const { workspaceId } = row;
  if (row.kind === 'guest') {
    const permissions = new Set<PermissionKey>();
    return {
      kind: 'guest',
      workspaceId,
      roleId: null,
      roleName: null,
      permissions,
      isAdmin: false,
    };
  }
  if (row.roleId === null || row.roleName === null || row.permissions === null) return null;
  const permissions = new Set(row.permissions.filter(isPermissionKey));
  return {
    kind: 'member',
    workspaceId,
    roleId: row.roleId,
    roleName: row.roleName,
    permissions,
    isAdmin: permissions.has('workspace.admin'),
  };
}

/** `member` in GET /api/auth/me. */
export const memberJson = (member: CurrentMember): CurrentMemberJson => ({
  ...member,
  permissions: [...member.permissions],
});

export type AddMemberInput =
  | { userId: string; kind?: 'member'; role?: BuiltInRoleKey; roleId?: undefined }
  | { userId: string; kind?: 'member'; roleId: string; role?: undefined }
  | { userId: string; kind: 'guest' };

/**
 * Puts the person in the current workspace: as a member with a built-in role (default Editor) or a role
 * of the workspace (`roleId`), or as a guest. Also brings back someone who was removed.
 */
export async function addMember(
  db: Db | Tx,
  input: AddMemberInput,
): Promise<{ workspaceId: string; roleId: string | null }> {
  const workspace = (await getDefaultWorkspace(db)) ?? (await syncDefaultWorkspace(db));
  const kind: MembershipKind = input.kind ?? 'member';
  let roleId: string | null = null;
  if (input.kind !== 'guest') {
    roleId = input.roleId ?? (await getBuiltInRoleId(db, workspace.id, input.role ?? 'editor'));
  }
  await db
    .insert(workspaceMembers)
    .values({ workspaceId: workspace.id, userId: input.userId, kind, roleId })
    .onConflictDoUpdate({
      target: [workspaceMembers.workspaceId, workspaceMembers.userId],
      set: { kind, roleId, removedAt: null, updatedAt: sql`now()` },
    });
  return { workspaceId: workspace.id, roleId };
}
