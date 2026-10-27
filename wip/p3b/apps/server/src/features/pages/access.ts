// Who can open what (decision 0012; names in decision 0007, section 3.3). Routes, live co-editing,
// comments, search and the other lanes all ask these functions, so the rules live in one place.
import {
  ACCESS_LEVELS,
  atLeast,
  type AccessLevel,
  type GrantLevel,
  type PermissionKey,
} from '@carehub/shared';
import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { httpError } from '../../core/errors';
import type { Db, Tx } from '../../db';
import { forbidden, invalid, isUuid, notFound, uuidArray } from './http';
import { accessGrants, accessHistory, type AccessGrant } from './schema';

export type Executor = Db | Tx;

/** `array_position(RANKS, level)` is the level's index in ACCESS_LEVELS. */
const RANKS = sql`ARRAY['view', 'comment', 'edit_content', 'edit', 'full']::text[]`;
/** Levels as granted, for the row resolver; 'rows_only' sorts first (index = position - 1). */
const GRANTS: readonly GrantLevel[] = ['rows_only', ...ACCESS_LEVELS.slice(1)];
const GRANT_RANKS = sql`ARRAY['rows_only', 'view', 'comment', 'edit_content', 'edit', 'full']::text[]`;
const lower = (a: AccessLevel, b: AccessLevel): AccessLevel => (atLeast(a, b) ? b : a);

export type Membership = {
  workspaceId: string;
  kind: 'member' | 'guest';
  roleId: string | null;
  permissions: ReadonlySet<PermissionKey>;
  isAdmin: boolean;
};
/** A person, their membership in each workspace and their groups. */
export type Viewer = {
  userId: string;
  memberships: ReadonlyMap<string, Membership>;
  groupIds: readonly string[];
};

/** Grants never give more than the role allows; guests have no role and never get Full access. */
export function limitByRole(level: AccessLevel, member: Membership): AccessLevel {
  if (member.kind === 'guest') return lower(level, 'edit');
  const can = (key: PermissionKey) => member.permissions.has(key);
  let limited = can('pages.edit') ? level : lower(level, can('pages.comment') ? 'comment' : 'view');
  if (limited === 'full' && !can('pages.share')) limited = 'edit';
  if (limited === 'comment' && !can('pages.comment')) limited = 'view';
  return limited;
}

export async function loadViewer(db: Executor, userId: string): Promise<Viewer> {
  const viewer = { userId, memberships: new Map<string, Membership>(), groupIds: [] };
  if (!isUuid(userId)) return viewer;
  type Row = Omit<Membership, 'permissions' | 'isAdmin'> & { permissions: PermissionKey[] | null };
  const { rows } = await db.execute<Row>(sql`
    SELECT m.workspace_id AS "workspaceId", m.kind, m.role_id AS "roleId", r.permissions
    FROM workspace_members m LEFT JOIN roles r ON r.id = m.role_id
    WHERE m.user_id = ${userId} AND m.removed_at IS NULL
    ORDER BY m.workspace_id`);
  for (const { permissions, ...row } of rows) {
    const keys = new Set(permissions ?? []);
    const isAdmin = row.kind === 'member' && keys.has('workspace.admin');
    viewer.memberships.set(row.workspaceId, { ...row, permissions: keys, isAdmin });
  }
  // Group memberships come with groups (a later accounts pull request).
  return viewer;
}

const viewers = new WeakMap<FastifyRequest, Promise<Viewer>>();

/** The signed-in person, loaded once per request. */
export function viewerFor(request: FastifyRequest): Promise<Viewer> {
  if (!request.user) throw httpError(401, 'signed_out');
  let viewer = viewers.get(request);
  if (!viewer) viewers.set(request, (viewer = loadViewer(request.server.db, request.user.id)));
  return viewer;
}

const memberWorkspaces = (viewer: Viewer) =>
  uuidArray(
    [...viewer.memberships.values()].flatMap((m) => (m.kind === 'member' ? [m.workspaceId] : [])),
  );

/** Grants (alias `g`) that reach the person. Role and everyone grants don't reach guests. */
function grantedTo(viewer: Viewer): SQL {
  const roleIds = [...viewer.memberships.values()].flatMap((m) =>
    m.kind === 'member' && m.roleId ? [m.roleId] : [],
  );
  return sql`((g.principal_type = 'user' AND g.principal_id = ${viewer.userId}::uuid)
    OR (g.principal_type = 'group' AND g.principal_id = ANY(${uuidArray(viewer.groupIds)}))
    OR (g.workspace_id = ANY(${memberWorkspaces(viewer)})
      AND (g.principal_type = 'everyone'
        OR (g.principal_type = 'role' AND g.principal_id = ANY(${uuidArray(roleIds)})))))`;
}

/** The person's space memberships (alias `m`, its space `s`), directly or through a group. */
export function memberOf(viewer: Viewer): SQL {
  return sql`(s.workspace_id = ANY(${memberWorkspaces(viewer)})
    AND ((m.principal_type = 'user' AND m.principal_id = ${viewer.userId}::uuid)
      OR (m.principal_type = 'group' AND m.principal_id = ANY(${uuidArray(viewer.groupIds)}))))`;
}

type SpaceKind = 'open' | 'closed' | 'private' | 'personal';
type Place = {
  workspaceId: string;
  spaceKind: SpaceKind;
  ownerId: string | null;
  archived: boolean;
};

/** The owner of a Private section and Admins in team spaces get Full access; others their best. */
function levelFrom(viewer: Viewer, member: Membership, place: Place, best: number | null) {
  const owns = place.spaceKind === 'personal' ? place.ownerId === viewer.userId : member.isAdmin;
  return owns ? 'full' : (ACCESS_LEVELS[best ?? 0] ?? 'none');
}

/** The role limit, then read-only pages in archived spaces (Sidebar spec 3.3). */
const finish = (level: AccessLevel, member: Membership, place: Place) =>
  place.archived ? lower(limitByRole(level, member), 'view') : limitByRole(level, member);

export type RowAccessContext = {
  db: Executor;
  userId: string;
  rowPageId: string;
  databasePageId: string;
  /** The row's level from grants, space membership and admin rights, before the role limit. */
  inherited: AccessLevel;
  /** The best grant that reached the database (or the row's other parents), as given. */
  grantLevel: GrantLevel | null;
};
type AccessResolver = (ctx: RowAccessContext) => Promise<AccessLevel>;
const resolvers = new Map<'row', AccessResolver>();

/** Lets the Databases lane adjust a row's level from its row rules; the role limit applies after. */
export function registerAccessResolver(kind: 'row', resolver: AccessResolver): void {
  resolvers.set(kind, resolver);
}

type PageFacts = Place & {
  id: string;
  kind: 'page' | 'database' | 'row';
  parentId: string | null;
  deleted: boolean;
  best: number | null;
  granted: number | null;
};
export type PageAnswer = Pick<PageFacts, 'kind' | 'deleted' | 'workspaceId'> & {
  level: AccessLevel;
};

/**
 * The person's level on each existing page (pages in Trash or in a space in Trash too, marked
 * `deleted`). Grants reach a
 * page from the page itself, then from each parent while the page below inherits, then from the
 * space (its grants, and its default access or Full access for its members and owners). Below a
 * database, its 'edit_content' counts as 'edit' and its 'rows_only' as nothing (on the database
 * itself 'rows_only' is 'view'); the row resolver can lift rows from there.
 */
export async function resolvePages(db: Executor, viewer: Viewer, pageIds: readonly string[]) {
  const ids = uuidArray([...new Set(pageIds)].filter(isUuid));
  const { rows } = await db.execute<PageFacts>(sql`
    WITH RECURSIVE chain AS (
      SELECT p.id AS page_id, p.id AS node_id, p.space_id, p.parent_id, p.inherit_access, 0 AS depth
      FROM pages p WHERE p.id = ANY(${ids})
      UNION ALL
      SELECT c.page_id, a.id, a.space_id, a.parent_id, a.inherit_access, c.depth + 1
      FROM chain c JOIN pages a ON a.id = c.parent_id
      WHERE c.inherit_access AND c.depth < 1000
    ),
    mine AS (SELECT g.* FROM access_grants g WHERE ${grantedTo(viewer)}),
    joined AS (
      SELECT m.space_id,
        CASE WHEN bool_or(m.role = 'owner') THEN 'full' ELSE min(s.default_access) END AS level
      FROM space_members m JOIN spaces s ON s.id = m.space_id
      WHERE ${memberOf(viewer)}
      GROUP BY m.space_id
    ),
    from_spaces AS (
      SELECT space_id, level FROM mine WHERE space_id IS NOT NULL
      UNION ALL SELECT space_id, level FROM joined
    ),
    reaching AS (
      SELECT c.page_id, c.depth, g.level AS granted, CASE
          WHEN c.node_id = c.page_id THEN replace(g.level, 'rows_only', 'view')
          WHEN g.level = 'edit_content' THEN 'edit'
          WHEN g.level = 'rows_only' THEN NULL
          ELSE g.level END AS level
      FROM chain c JOIN mine g ON g.page_id = c.node_id
      UNION ALL
      SELECT c.page_id, c.depth, f.level, f.level FROM chain c JOIN from_spaces f
        ON f.space_id = c.space_id
      WHERE c.parent_id IS NULL AND c.inherit_access
    ),
    best AS (
      SELECT page_id, max(array_position(${RANKS}, level)) AS best,
        max(array_position(${GRANT_RANKS}, granted)) FILTER (WHERE depth > 0) AS granted
      FROM reaching GROUP BY page_id
    )
    SELECT p.id, p.workspace_id AS "workspaceId", p.kind, p.parent_id AS "parentId",
      p.deleted_at IS NOT NULL OR s.deleted_at IS NOT NULL AS deleted, s.kind AS "spaceKind",
      s.owner_id AS "ownerId",
      s.archived_at IS NOT NULL AS archived, b.best, b.granted
    FROM pages p JOIN spaces s ON s.id = p.space_id LEFT JOIN best b ON b.page_id = p.id
    WHERE p.id = ANY(${ids})`);
  const answers = new Map<string, PageAnswer>();
  const resolver = resolvers.get('row');
  await Promise.all(
    rows.map(async ({ best, granted, ...page }) => {
      const member = viewer.memberships.get(page.workspaceId);
      if (!member) {
        answers.set(page.id, { ...page, level: 'none' });
        return;
      }
      let level = levelFrom(viewer, member, page, best);
      if (resolver && page.kind === 'row' && page.parentId) {
        const grantLevel = GRANTS[(granted ?? 0) - 1] ?? null;
        const ctx = { db, userId: viewer.userId, rowPageId: page.id, inherited: level, grantLevel };
        level = await resolver({ ...ctx, databasePageId: page.parentId });
      }
      answers.set(page.id, { ...page, level: finish(level, member, page) });
    }),
  );
  return answers;
}

/** The level a new top-level page in the space would get: "Can edit where it goes" (SB-08). */
export async function resolveSpace(
  db: Executor,
  viewer: Viewer,
  spaceId: string,
): Promise<AccessLevel> {
  const { rows } = await db.execute<Place & { best: number | null }>(sql`
    SELECT s.workspace_id AS "workspaceId", s.kind AS "spaceKind", s.owner_id AS "ownerId",
      s.archived_at IS NOT NULL AS archived,
      (SELECT max(array_position(${RANKS}, l.level)) FROM (
        SELECT g.level FROM access_grants g WHERE g.space_id = s.id AND ${grantedTo(viewer)}
        UNION ALL
        SELECT CASE WHEN m.role = 'owner' THEN 'full' ELSE s.default_access END
        FROM space_members m WHERE m.space_id = s.id AND ${memberOf(viewer)}) l) AS best
    FROM spaces s WHERE s.id = ${isUuid(spaceId) ? spaceId : null}::uuid AND s.deleted_at IS NULL`);
  const place = rows[0];
  const member = place && viewer.memberships.get(place.workspaceId);
  if (!place || !member) return 'none';
  return finish(levelFrom(viewer, member, place, place.best), member, place);
}

/** 0007: bulk levels, 'none' for pages that are missing, in Trash or closed to the person. */
export async function getAccessForPages(
  db: Executor,
  userId: string,
  pageIds: readonly string[],
): Promise<Map<string, AccessLevel>> {
  const answers = await resolvePages(db, await loadViewer(db, userId), pageIds);
  return new Map(
    pageIds.map((id): [string, AccessLevel] => {
      const answer = answers.get(id);
      return [id, answer && !answer.deleted ? answer.level : 'none'];
    }),
  );
}

export async function getPageAccess(db: Executor, userId: string, pageId: string) {
  return (await getAccessForPages(db, userId, [pageId])).get(pageId) ?? 'none';
}

const checked = new WeakMap<FastifyRequest, PageAnswer & { pageId: string }>();

/**
 * preHandler, also `app.requirePageAccess`: 404 if the page is missing or in Trash, 403 if the
 * person's level is below `min`. The handler reads the result with `pageAccessOf(request)`.
 */
export function requirePageAccess(
  min: AccessLevel,
  pageIdOf: (request: FastifyRequest) => unknown = (request) =>
    (request.params as { id?: unknown }).id,
) {
  return async (request: FastifyRequest) => {
    const viewer = await viewerFor(request);
    const pageId = pageIdOf(request);
    if (!isUuid(pageId)) throw notFound();
    const answer = (await resolvePages(request.server.db, viewer, [pageId])).get(pageId);
    if (!answer || answer.deleted) throw notFound();
    if (!atLeast(answer.level, min)) throw forbidden();
    checked.set(request, { ...answer, pageId });
  };
}

export function pageAccessOf(request: FastifyRequest) {
  const answer = checked.get(request);
  if (!answer) throw new Error('requirePageAccess must run first');
  return answer;
}

export type Principal = { type: 'user' | 'role' | 'group' | 'everyone'; id?: string };
export type GrantTarget = { workspaceId: string; spaceId: string | null; pageId: string | null };

/** Sets one principal's grant on a space or page (`null` removes it) and records the change. */
export async function writeGrant(
  tx: Executor,
  target: GrantTarget,
  principal: Principal,
  level: GrantLevel | null,
  by: string,
): Promise<AccessGrant | null> {
  const principalId = principal.type === 'everyone' ? null : (principal.id ?? null);
  const [existing] = await tx
    .select()
    .from(accessGrants)
    .where(
      and(
        target.pageId
          ? eq(accessGrants.pageId, target.pageId)
          : eq(accessGrants.spaceId, target.spaceId ?? ''),
        eq(accessGrants.principalType, principal.type),
        principalId ? eq(accessGrants.principalId, principalId) : isNull(accessGrants.principalId),
      ),
    )
    .for('update');
  if ((existing?.level ?? null) === level) return existing ?? null;
  let grant: AccessGrant | null = null;
  if (existing && level === null) {
    await tx.delete(accessGrants).where(eq(accessGrants.id, existing.id));
  } else if (existing && level !== null) {
    [grant = null] = await tx
      .update(accessGrants)
      .set({ level, grantedBy: by })
      .where(eq(accessGrants.id, existing.id))
      .returning();
  } else if (level !== null) {
    [grant = null] = await tx
      .insert(accessGrants)
      .values({ ...target, principalType: principal.type, principalId, level, grantedBy: by })
      .returning();
  }
  await tx.insert(accessHistory).values({
    ...target,
    changedBy: by,
    principalType: principal.type,
    principalId,
    beforeLevel: existing?.level ?? null,
    afterLevel: level,
  });
  return grant;
}

type GrantPlace = { spaceId?: string | null; pageId?: string | null };

/** The page a grant is on, its kind and the changer's level there. */
async function targetFor(db: Executor, userId: string, place: GrantPlace) {
  if (place.spaceId || !place.pageId) throw invalid('Grants on spaces come with the spaces API.');
  const viewer = await loadViewer(db, userId);
  const answer = (await resolvePages(db, viewer, [place.pageId])).get(place.pageId);
  if (!answer || answer.deleted) throw notFound();
  const target = { workspaceId: answer.workspaceId, spaceId: null, pageId: place.pageId };
  return { target, kind: answer.kind, level: answer.level };
}

/** Checks the principal belongs to the workspace; returns whether it's a guest. */
async function checkPrincipal(db: Executor, workspaceId: string, principal: Principal) {
  if (principal.type === 'everyone') return false;
  if (principal.type === 'group') throw invalid('Sharing with groups comes with groups.');
  const what = principal.type === 'user' ? 'person' : 'role';
  const missing = invalid(`That ${what} isn't in this workspace.`);
  if (!isUuid(principal.id)) throw missing;
  const { rows } = await db.execute<{ kind: string }>(
    principal.type === 'user'
      ? sql`SELECT kind FROM workspace_members
          WHERE workspace_id = ${workspaceId} AND user_id = ${principal.id} AND removed_at IS NULL`
      : sql`SELECT 'role' AS kind FROM roles
          WHERE workspace_id = ${workspaceId} AND id = ${principal.id}`,
  );
  if (!rows[0]) throw missing;
  return rows[0].kind === 'guest';
}

export type GrantAccessInput = {
  spaceId?: string;
  pageId?: string;
  principal: Principal;
  level: GrantLevel;
  grantedBy: string;
};

/**
 * 0007: adds or changes a grant. It needs Full access there, which the role limit gives only with
 * the Share permission; Full is the top level, so nobody can grant above their own.
 */
export async function grantAccess(tx: Executor, input: GrantAccessInput) {
  if (input.level === 'none') throw invalid('Choose a level, or remove the grant.');
  const { target, kind, level } = await targetFor(tx, input.grantedBy, input);
  if (!atLeast(level, 'full')) throw forbidden();
  const forDatabases = input.level === 'edit_content' || input.level === 'rows_only';
  if (forDatabases && kind !== 'database') throw invalid('That level is only for databases.');
  const guest = await checkPrincipal(tx, target.workspaceId, input.principal);
  if (guest && input.level === 'full') throw invalid('Guests never get Full access.');
  return writeGrant(tx, target, input.principal, input.level, input.grantedBy);
}

/** 0007: removes a grant (Full access needed there). */
export async function revokeAccess(tx: Executor, grantId: string, by: string): Promise<void> {
  if (!isUuid(grantId)) throw notFound();
  const [grant] = await tx.select().from(accessGrants).where(eq(accessGrants.id, grantId));
  if (!grant) throw notFound();
  const { target, level } = await targetFor(tx, by, grant);
  if (!atLeast(level, 'full')) throw forbidden();
  const principal = { type: grant.principalType, id: grant.principalId ?? undefined };
  await writeGrant(tx, target, principal, null, by);
}
