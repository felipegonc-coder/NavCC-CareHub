// Team spaces, their members and owners, default spaces and each person's Private section (Sidebar
// spec 3.3; decisions 0007, section 4.1, and 0012). Like every service function here, these take
// Db | Tx and never emit events: the caller knows when its transaction commits.
import type {
  CreateSpaceInput,
  SpaceJson,
  SpaceMemberJson,
  SpaceRole,
  UpdateSpaceInput,
} from '@carehub/shared';
import { sql, type SQL } from 'drizzle-orm';
import { isUniqueViolation } from '../../db';
import { getDefaultWorkspace } from '../workspaces';
import { memberOf, type Executor, type Viewer } from './access';
import { conflict, invalid, isUuid, notFound, uuidArray } from './http';

/** The person asking, in the workspace they're signed in to. */
export type SpaceViewer = { viewer: Viewer; workspaceId: string; isAdmin: boolean };
export type SpaceScope = 'mine' | 'browse' | 'all';
type SpaceRow = Omit<SpaceJson, 'canManage'>;

export const GENERAL_SPACE = 'General';

const iso = (column: string) =>
  sql.raw(`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);
const json = (value: unknown) => (value == null ? null : JSON.stringify(value));
const nameTaken = () => conflict('There is already a space with that name. Choose another one.');

/** Space members (alias `m`) who are still in the workspace of their space (alias `s`). */
const STILL_IN = sql`m.principal_type = 'user' AND EXISTS (SELECT 1 FROM workspace_members w
  WHERE w.workspace_id = s.workspace_id AND w.user_id = m.principal_id AND w.removed_at IS NULL)`;

function selectSpaces(who: SpaceViewer, where: SQL): SQL {
  return sql`
    SELECT s.id, s.name, s.icon, s.description, s.kind, s.default_access AS "defaultAccess",
      s.owners_only_top_level AS "ownersOnlyTopLevel", s.allow_share_links AS "allowShareLinks",
      s.allow_guests AS "allowGuests", s.allow_export AS "allowExport",
      s.allow_move_out AS "allowMoveOut", s.is_default AS "isDefault",
      ${iso('s.archived_at')} AS "archivedAt", ${iso('s.created_at')} AS "createdAt",
      (SELECT count(*)::int FROM space_members m WHERE m.space_id = s.id AND ${STILL_IN})
        AS "memberCount",
      (SELECT CASE WHEN bool_or(m.role = 'owner') THEN 'owner' ELSE min(m.role) END
        FROM space_members m WHERE m.space_id = s.id AND ${memberOf(who.viewer)}) AS "myRole"
    FROM spaces s
    WHERE s.workspace_id = ${who.workspaceId} AND s.kind <> 'personal' AND s.deleted_at IS NULL
      AND ${where}
    ORDER BY lower(s.name), s.id`;
}

const withManage =
  (who: SpaceViewer) =>
  (row: SpaceRow): SpaceJson => ({ ...row, canManage: who.isAdmin || row.myRole === 'owner' });

/** The person's spaces (the sidebar), the Open and Closed ones (Browse spaces), or all (Admins). */
export async function listSpaces(db: Executor, who: SpaceViewer, scope: SpaceScope) {
  const where = {
    mine: sql`s.archived_at IS NULL AND EXISTS (SELECT 1 FROM space_members m
      WHERE m.space_id = s.id AND ${memberOf(who.viewer)})`,
    browse: sql`s.archived_at IS NULL AND s.kind IN ('open', 'closed')`,
    all: sql`true`,
  }[scope];
  const { rows } = await db.execute<SpaceRow>(selectSpaces(who, where));
  return rows.map(withManage(who));
}

/**
 * A team space the person may see, or 404. Members and Admins see it; everyone in the workspace
 * sees Open and Closed spaces that aren't archived. Nobody else learns a Private space exists.
 */
export async function findSpace(db: Executor, who: SpaceViewer, spaceId: unknown) {
  if (!isUuid(spaceId)) throw notFound();
  const { rows } = await db.execute<SpaceRow>(selectSpaces(who, sql`s.id = ${spaceId}`));
  const row = rows[0];
  const listed = row !== undefined && row.kind !== 'private' && row.archivedAt === null;
  if (!row || !(who.isAdmin || row.myRole !== null || listed)) throw notFound();
  return withManage(who)(row);
}

/** For "Move the space and its N pages to Trash?". Rows aren't counted. */
export async function countSpacePages(db: Executor, spaceId: string): Promise<number> {
  const { rows } = await db.execute<{ count: number }>(sql`
    SELECT count(*)::int AS count FROM pages
    WHERE space_id = ${spaceId} AND deleted_at IS NULL AND kind <> 'row'`);
  return rows[0]?.count ?? 0;
}

export type NewSpace = Pick<CreateSpaceInput, 'name' | 'icon' | 'description'> &
  Partial<Pick<CreateSpaceInput, 'kind' | 'defaultAccess'>> & {
    workspaceId: string;
    /** Becomes its first owner. Null for spaces Care Hub makes itself, which Admins manage. */
    createdBy: string | null;
    isDefault?: boolean;
  };

/** Makes a team space (Open with Can edit unless chosen) and returns its ID. */
export async function createSpace(tx: Executor, input: NewSpace): Promise<string> {
  let id: string | undefined;
  try {
    const { rows } = await tx.execute<{ id: string }>(sql`
      INSERT INTO spaces (workspace_id, kind, name, icon, description, default_access,
        is_default, created_by)
      VALUES (${input.workspaceId}, ${input.kind ?? 'open'}, ${input.name},
        ${json(input.icon)}::jsonb, ${input.description ?? ''}, ${input.defaultAccess ?? 'edit'},
        ${input.isDefault ?? false}, ${input.createdBy})
      RETURNING id`);
    id = rows[0]?.id;
  } catch (error) {
    if (isUniqueViolation(error, 'spaces_name_idx')) throw nameTaken();
    throw error;
  }
  if (!id) throw new Error('The space was not saved.');
  if (input.createdBy) {
    await tx.execute(sql`
      INSERT INTO space_members (space_id, principal_type, principal_id, role, added_by)
      VALUES (${id}, 'user', ${input.createdBy}, 'owner', ${input.createdBy})`);
  }
  return id;
}

const COLUMNS = {
  name: 'name',
  icon: 'icon',
  description: 'description',
  kind: 'kind',
  defaultAccess: 'default_access',
  ownersOnlyTopLevel: 'owners_only_top_level',
  allowShareLinks: 'allow_share_links',
  allowGuests: 'allow_guests',
  allowExport: 'allow_export',
  allowMoveOut: 'allow_move_out',
  isDefault: 'is_default',
} as const satisfies Record<Exclude<keyof UpdateSpaceInput, 'archived'>, string>;

/** Changes a space's settings; `archived` archives or unarchives it. Checks are the caller's. */
export async function updateSpace(
  tx: Executor,
  spaceId: string,
  patch: UpdateSpaceInput,
  by: string,
): Promise<void> {
  const sets: SQL[] = [sql`updated_at = now()`];
  for (const [key, column] of Object.entries(COLUMNS) as [keyof typeof COLUMNS, string][]) {
    const value = patch[key];
    if (value === undefined) continue;
    sets.push(
      key === 'icon' ? sql`icon = ${json(value)}::jsonb` : sql`${sql.raw(column)} = ${value}`,
    );
  }
  if (patch.archived !== undefined) {
    sets.push(
      patch.archived
        ? sql`archived_at = now(), archived_by = ${by}`
        : sql`archived_at = NULL, archived_by = NULL`,
    );
  }
  try {
    await tx.execute(sql`UPDATE spaces SET ${sql.join(sets, sql`, `)} WHERE id = ${spaceId}`);
  } catch (error) {
    if (isUniqueViolation(error, 'spaces_name_idx')) throw nameTaken();
    throw error;
  }
}

/** Moves a space, and so all its pages, to Trash (Sidebar spec 3.3). */
export async function trashSpace(tx: Executor, spaceId: string, by: string): Promise<void> {
  await tx.execute(sql`
    UPDATE spaces SET deleted_at = now(), deleted_by = ${by}, updated_at = now()
    WHERE id = ${spaceId} AND kind <> 'personal' AND deleted_at IS NULL`);
}

/** Owners first, then by name. People removed from the workspace aren't listed. */
export async function listSpaceMembers(db: Executor, spaceId: string) {
  const { rows } = await db.execute<SpaceMemberJson>(sql`
    SELECT m.principal_type AS type, m.principal_id AS id, u.name, u.email,
      u.avatar_url AS "avatarUrl", m.role, ${iso('m.joined_at')} AS "joinedAt"
    FROM space_members m JOIN spaces s ON s.id = m.space_id JOIN users u ON u.id = m.principal_id
    WHERE m.space_id = ${spaceId} AND ${STILL_IN}
    ORDER BY m.role = 'owner' DESC, lower(u.name), u.id`);
  return rows;
}

/** Adds people as members or owners (an owner stays one). Guests can't join spaces. */
export async function addSpaceMembers(
  tx: Executor,
  space: { id: string; workspaceId: string },
  members: readonly { type: 'user' | 'group'; id: string }[],
  role: SpaceRole,
  by: string,
): Promise<void> {
  if (members.some((m) => m.type === 'group')) {
    throw invalid('Groups can be added once Settings → Members has groups.');
  }
  const unique = [...new Set(members.map((m) => m.id))];
  const ids = uuidArray(unique);
  const { rows } = await tx.execute<{ kind: string }>(sql`
    SELECT kind FROM workspace_members
    WHERE workspace_id = ${space.workspaceId} AND removed_at IS NULL AND user_id = ANY(${ids})`);
  if (rows.length < unique.length) throw invalid("Someone on the list isn't in this workspace.");
  if (rows.some((row) => row.kind === 'guest')) throw invalid("Guests can't join spaces.");
  await tx.execute(sql`
    INSERT INTO space_members (space_id, principal_type, principal_id, role, added_by)
    SELECT ${space.id}::uuid, 'user', id, ${role}::text, ${by}::uuid FROM unnest(${ids}) AS id
    ON CONFLICT (space_id, principal_type, principal_id) DO UPDATE
      SET role = CASE WHEN EXCLUDED.role = 'owner' THEN 'owner' ELSE space_members.role END`);
}

/** The member's role, after locking the space so that owner changes happen one at a time. */
async function roleOf(tx: Executor, spaceId: string, principalId: string): Promise<SpaceRole> {
  await tx.execute(sql`SELECT id FROM spaces WHERE id = ${spaceId} FOR UPDATE`);
  const { rows } = await tx.execute<{ role: SpaceRole }>(sql`
    SELECT role FROM space_members WHERE space_id = ${spaceId} AND principal_id = ${principalId}`);
  if (!rows[0]) throw notFound();
  return rows[0].role;
}

/** 409 unless someone other than `principalId` stays an owner (Sidebar spec 3.3). */
async function keepAnOwner(tx: Executor, spaceId: string, principalId: string) {
  const { rows } = await tx.execute<{ owners: number }>(sql`
    SELECT count(*)::int AS owners FROM space_members m JOIN spaces s ON s.id = m.space_id
    WHERE m.space_id = ${spaceId} AND m.role = 'owner' AND m.principal_id <> ${principalId}
      AND ${STILL_IN}`);
  if (!rows[0]?.owners) throw conflict('Make someone else an owner first.');
}

export async function setSpaceMemberRole(
  tx: Executor,
  spaceId: string,
  principalId: unknown,
  role: SpaceRole,
): Promise<void> {
  if (!isUuid(principalId)) throw notFound();
  const current = await roleOf(tx, spaceId, principalId);
  if (current === 'owner' && role === 'member') await keepAnOwner(tx, spaceId, principalId);
  await tx.execute(sql`UPDATE space_members SET role = ${role}
    WHERE space_id = ${spaceId} AND principal_id = ${principalId}`);
}

/** Removes someone from a space, or lets them leave it. The last owner hands over first. */
export async function removeSpaceMember(tx: Executor, spaceId: string, principalId: unknown) {
  if (!isUuid(principalId)) throw notFound();
  if ((await roleOf(tx, spaceId, principalId)) === 'owner') {
    await keepAnOwner(tx, spaceId, principalId);
  }
  await tx.execute(sql`DELETE FROM space_members
    WHERE space_id = ${spaceId} AND principal_id = ${principalId}`);
}

/** Joins a space as a member. Only Open spaces let people in by themselves; the route checks. */
export async function joinSpace(tx: Executor, spaceId: string, userId: string): Promise<void> {
  await tx.execute(sql`
    INSERT INTO space_members (space_id, principal_type, principal_id, role, added_by)
    VALUES (${spaceId}, 'user', ${userId}, 'member', ${userId}) ON CONFLICT DO NOTHING`);
}

/** Puts a new member of the workspace in its default spaces. Guests join none. */
export async function joinDefaultSpaces(tx: Executor, workspaceId: string, userId: string) {
  await tx.execute(sql`
    INSERT INTO space_members (space_id, principal_type, principal_id, role)
    SELECT s.id, 'user', w.user_id, 'member'
    FROM spaces s JOIN workspace_members w ON w.workspace_id = s.workspace_id
    WHERE s.workspace_id = ${workspaceId} AND w.user_id = ${userId} AND w.kind = 'member'
      AND w.removed_at IS NULL AND s.is_default AND s.kind <> 'personal'
      AND s.archived_at IS NULL AND s.deleted_at IS NULL
    ON CONFLICT DO NOTHING`);
}

/**
 * A workspace without team spaces gets the Open default space "General" (SB-01). Runs at start-up
 * and in the seed, any number of times. Returns the first default space (or the first space).
 */
export async function setUpWorkspaceSpaces(db: Executor, workspaceId: string) {
  await db.execute(sql`
    INSERT INTO spaces (workspace_id, kind, name, description, is_default)
    SELECT ${workspaceId}::uuid, 'open', ${GENERAL_SPACE}::text,
      'For everyone in the workspace.', true
    WHERE NOT EXISTS (SELECT 1 FROM spaces WHERE workspace_id = ${workspaceId}
      AND kind <> 'personal')
    ON CONFLICT DO NOTHING`);
  const { rows } = await db.execute<{ id: string }>(sql`
    SELECT id FROM spaces
    WHERE workspace_id = ${workspaceId} AND kind <> 'personal' AND deleted_at IS NULL
    ORDER BY is_default DESC, created_at, id LIMIT 1`);
  return rows[0]?.id ?? null;
}

/** 0007: the person's own Private section, made on first use (default: the current workspace). */
export async function getPrivateSpaceId(
  db: Executor,
  userId: string,
  workspaceId?: string,
): Promise<string> {
  const inWorkspace = workspaceId ?? (await getDefaultWorkspace(db))?.id;
  if (!inWorkspace) throw new Error('There is no workspace yet.');
  await db.execute(sql`
    INSERT INTO spaces (workspace_id, kind, owner_id, name)
    VALUES (${inWorkspace}, 'personal', ${userId}, 'Private') ON CONFLICT DO NOTHING`);
  const { rows } = await db.execute<{ id: string }>(sql`
    SELECT id FROM spaces
    WHERE workspace_id = ${inWorkspace} AND kind = 'personal' AND owner_id = ${userId}`);
  if (!rows[0]) throw new Error('The Private section was not saved.');
  return rows[0].id;
}
