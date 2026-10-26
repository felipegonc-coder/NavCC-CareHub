// Who can do what with spaces and pages: docs/decisions/0005-spaces-and-page-access.md.
// Every route, live co-editing and comments use these, so the rules live in one place.
import { sql, type SQL } from 'drizzle-orm';
import type { PageAccessLevel, SpaceRole, VisibleAccessLevel } from '@carehub/shared';
import type { SpaceRow } from '../workspaces/schema';
import { can, isAdminRole, isUuid, type Executor } from './common';

export type SpaceAccess = {
  level: VisibleAccessLevel;
  canCreatePages: boolean;
  canManage: boolean;
};
/** A space as the access checks load it (without timestamps). */
export type SpaceInfo = Omit<SpaceRow, 'createdAt' | 'updatedAt'>;
export type SpaceWithAccess = { space: SpaceInfo; access: SpaceAccess };

const RANK: Record<PageAccessLevel, number> = { none: 0, view: 1, comment: 2, edit: 3 };
const SPACE_ROLE_LEVEL: Record<SpaceRole, VisibleAccessLevel> = {
  editor: 'edit',
  commenter: 'comment',
  viewer: 'view',
};

export const atLeast = (level: PageAccessLevel, min: PageAccessLevel): boolean =>
  RANK[level] >= RANK[min];

export type AccessFacts = Pick<SpaceRow, 'kind' | 'visibility' | 'ownerId'> & {
  /** The person's role in the space's workspace; null if they aren't in it. */
  workspaceRole: string | null;
  /** Their role in space_members, if listed. */
  spaceRole: SpaceRole | null;
};

/** The access rules. Returns null when the space is hidden from the person. */
export function resolveSpaceAccess(userId: string, facts: AccessFacts): SpaceAccess | null {
  const role = facts.workspaceRole;
  if (role === null) return null;
  const roleLevel: VisibleAccessLevel = can(role, 'pages.edit')
    ? 'edit'
    : can(role, 'pages.comment')
      ? 'comment'
      : 'view';
  const roleCreates = can(role, 'pages.create');
  if (facts.kind === 'private') {
    // Only the owner sees a private space; admins included.
    if (facts.ownerId !== userId) return null;
    return { level: roleLevel, canCreatePages: roleCreates, canManage: true };
  }
  if (isAdminRole(role)) return { level: 'edit', canCreatePages: true, canManage: true };
  if (facts.visibility === 'workspace') {
    return { level: roleLevel, canCreatePages: roleCreates, canManage: false };
  }
  if (facts.spaceRole === null) return null;
  const spaceLevel = SPACE_ROLE_LEVEL[facts.spaceRole];
  return {
    level: RANK[spaceLevel] < RANK[roleLevel] ? spaceLevel : roleLevel,
    canCreatePages: roleCreates && facts.spaceRole === 'editor',
    canManage: false,
  };
}

type SpaceFactsRow = SpaceInfo & Pick<AccessFacts, 'workspaceRole' | 'spaceRole'>;

/** Spaces matching `where` (on alias `s`) that the person can see, in sidebar order. */
async function spacesWhere(db: Executor, userId: string, where: SQL): Promise<SpaceWithAccess[]> {
  const { rows } = await db.execute<SpaceFactsRow>(sql`
    SELECT s.id, s.workspace_id AS "workspaceId", s.name, s.icon, s.kind, s.visibility,
      s.owner_id AS "ownerId", s.position, wm.role AS "workspaceRole", sm.role AS "spaceRole"
    FROM spaces s
    LEFT JOIN workspace_members wm ON wm.workspace_id = s.workspace_id AND wm.user_id = ${userId}
    LEFT JOIN space_members sm ON sm.space_id = s.id AND sm.user_id = ${userId}
    WHERE ${where}
    ORDER BY s.kind = 'private', s.position, s.id`);
  return rows.flatMap(({ workspaceRole, spaceRole, ...space }) => {
    const access = resolveSpaceAccess(userId, { ...space, workspaceRole, spaceRole });
    return access ? [{ space, access }] : [];
  });
}

/** Every space in the workspace the person can see. */
export const listSpaces = (db: Executor, userId: string, workspaceId: string) =>
  spacesWhere(
    db,
    userId,
    sql`s.workspace_id = ${workspaceId} AND (s.kind = 'team' OR s.owner_id = ${userId})`,
  );

/** One space and the person's access to it; null if it doesn't exist or is hidden. */
export async function getSpace(db: Executor, userId: string, spaceId: string) {
  if (!isUuid(spaceId)) return null;
  const [found] = await spacesWhere(db, userId, sql`s.id = ${spaceId}`);
  return found ?? null;
}
