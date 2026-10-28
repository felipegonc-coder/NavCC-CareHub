// Moving pages with everything under them (Sidebar spec 3.2 and 5; Pages and blocks 3.2, "Move
// to"), and turning pages into database rows and back (decision 0007, section 3.3). Can edit
// where it goes and events are the caller's.
import type { PageKind } from '@carehub/shared';
import { sql } from 'drizzle-orm';
import { httpError } from '../../core/errors';
import { loadViewer, resolvePages, type Executor } from './access';
import { invalid, isUuid, notFound, uuidArray } from './http';
import { MAX_DEPTH, tooDeep } from './pages';
import { positionAt } from './position';

export type PageMove = {
  /** Under this page, or at the top of `spaceId` when null. */
  parentId: string | null;
  /** At the top level, the space (its own space when left out); under a parent, the parent's. */
  spaceId?: string;
  /** Its place among its new neighbours (0 is first); last when left out. */
  index?: number;
  /** What it must become; the move is refused otherwise. */
  kind?: 'page' | 'row';
};

type Place = { spaceId: string; parentId: string | null; kind: PageKind };
export type MovedPage = { pageId: string; workspaceId: string; from: Place; to: Place };

/**
 * One move at a time in a workspace, taken before any check: two moves that each pass the
 * inside-itself check at the same time could otherwise make a loop.
 */
export async function lockMoves(tx: Executor, pageId: string): Promise<void> {
  await tx.execute(sql`
    SELECT pg_advisory_xact_lock(hashtext('pages.move'), hashtext(workspace_id::text))
    FROM pages WHERE id = ${isUuid(pageId) ? pageId : null}::uuid`);
}

/**
 * Moves a page, database or row with everything under it, Trash included. A page put in a
 * database becomes a row; a row put anywhere else becomes a page. To another space, the old
 * space must let pages go, and `by` needs Full access on the page and on every page under it
 * that keeps its own access, so nobody gains access by moving (the rest inherit from the page).
 */
export async function movePage(tx: Executor, pageId: string, move: PageMove, by: string) {
  if (!isUuid(pageId)) throw notFound();
  await lockMoves(tx, pageId);
  type Facts = Place & { workspaceId: string; isInline: boolean };
  const facts = sql`SELECT space_id AS "spaceId", parent_id AS "parentId", kind,
    workspace_id AS "workspaceId", is_inline AS "isInline" FROM pages`;
  const { rows } = await tx.execute<Facts>(sql`
    ${facts} WHERE id = ${pageId} AND deleted_at IS NULL FOR UPDATE`);
  const page = rows[0];
  if (!page) throw notFound();
  const { parentId } = move;
  let spaceId = move.spaceId ?? page.spaceId;
  let kind: PageKind = page.kind === 'row' ? 'page' : page.kind;
  if (parentId !== null) {
    if (!isUuid(parentId)) throw notFound();
    const { rows: parents } = await tx.execute<Facts>(sql`
      ${facts} WHERE id = ${parentId} AND deleted_at IS NULL FOR SHARE`);
    const parent = parents[0];
    if (!parent || parent.workspaceId !== page.workspaceId) throw notFound();
    if (move.spaceId !== undefined && move.spaceId !== parent.spaceId) {
      throw invalid('The parent page is in another space.');
    }
    // The parent's depth and the moved pages' height: inside itself, or deeper than allowed.
    type Shape = { inside: boolean; above: number; below: number };
    const { rows: shape } = await tx.execute<Shape>(sql`
      WITH RECURSIVE up AS (
        SELECT id, parent_id, 1 AS depth FROM pages WHERE id = ${parentId}
        UNION ALL
        SELECT p.id, p.parent_id, up.depth + 1 FROM up JOIN pages p ON p.id = up.parent_id
        WHERE up.depth < 1000
      ),
      down AS (
        SELECT id, 1 AS depth FROM pages WHERE id = ${pageId}
        UNION ALL
        SELECT p.id, down.depth + 1 FROM down JOIN pages p ON p.parent_id = down.id
        WHERE down.depth < 1000
      )
      SELECT EXISTS (SELECT 1 FROM up WHERE id = ${pageId}::uuid) AS inside,
        (SELECT max(depth) FROM up)::int AS above, (SELECT max(depth) FROM down)::int AS below`);
    if (shape[0]?.inside) throw invalid("A page can't go inside itself.");
    if ((shape[0]?.above ?? 0) + (shape[0]?.below ?? 0) > MAX_DEPTH) throw tooDeep();
    if (parent.kind === 'database') {
      if (page.kind === 'database') throw invalid('Only rows go in a database.');
      if (page.kind === 'row' && page.parentId !== parentId) {
        throw invalid("Rows can't move to another database.");
      }
      kind = 'row';
    }
    spaceId = parent.spaceId;
  } else if (page.isInline) {
    throw invalid('An inline database sits on a page.');
  }
  if (move.kind !== undefined && move.kind !== kind) {
    throw invalid(`This can't become a ${move.kind} there.`);
  }
  if (!isUuid(spaceId)) throw notFound();
  const { rows: spaces } = await tx.execute(sql`
    SELECT 1 FROM spaces
    WHERE id = ${spaceId} AND workspace_id = ${page.workspaceId} AND deleted_at IS NULL`);
  if (spaces.length === 0) throw notFound();
  if (spaceId !== page.spaceId) await checkSpaceChange(tx, pageId, page.spaceId, by);

  const { rows: siblings } = await tx.execute<{ position: string }>(sql`
    SELECT position FROM pages
    WHERE space_id = ${spaceId} AND parent_id IS NOT DISTINCT FROM ${parentId}::uuid
      AND deleted_at IS NULL AND id <> ${pageId}
    ORDER BY position`);
  const position = positionAt(
    siblings.map((sibling) => sibling.position),
    move.index,
  );
  // One statement, so each sub-page's parent is in its space again when the foreign key checks.
  const moving = spaceId === page.spaceId ? sql`id = ${pageId}` : sql`id IN (SELECT id FROM below)`;
  await tx.execute(sql`
    WITH RECURSIVE below AS (
      SELECT id FROM pages WHERE id = ${pageId}
      UNION SELECT p.id FROM pages p JOIN below b ON p.parent_id = b.id
    )
    UPDATE pages SET space_id = ${spaceId},
      parent_id = CASE WHEN id = ${pageId} THEN ${parentId}::uuid ELSE parent_id END,
      kind = CASE WHEN id = ${pageId} THEN ${kind}::text ELSE kind END,
      position = CASE WHEN id = ${pageId} THEN ${position}::text ELSE position END,
      updated_by = CASE WHEN id = ${pageId} THEN ${by}::uuid ELSE updated_by END,
      updated_at = CASE WHEN id = ${pageId} THEN now() ELSE updated_at END
    WHERE ${moving}`);
  const moved: MovedPage = {
    pageId,
    workspaceId: page.workspaceId,
    from: { spaceId: page.spaceId, parentId: page.parentId, kind: page.kind },
    to: { spaceId, parentId, kind },
  };
  return moved;
}

async function checkSpaceChange(tx: Executor, pageId: string, fromSpaceId: string, by: string) {
  const { rows } = await tx.execute<{ allowed: boolean }>(sql`
    SELECT allow_move_out AS allowed FROM spaces WHERE id = ${fromSpaceId}`);
  if (rows[0]?.allowed === false) {
    throw httpError(403, 'forbidden', "This space's pages can't be moved to other spaces.");
  }
  const ids = await ownAccessPages(tx, pageId);
  const levels = await resolvePages(tx, await loadViewer(tx, by), ids);
  if (ids.some((id) => levels.get(id)?.level !== 'full')) {
    throw httpError(403, 'forbidden', 'You need Full access to every page that would move.');
  }
}

/** The page and the pages under it that keep their own access, Trash included. */
export async function ownAccessPages(db: Executor, pageId: string): Promise<string[]> {
  const { rows } = await db.execute<{ id: string }>(sql`
    WITH RECURSIVE below AS (
      SELECT id, inherit_access, 0 AS depth FROM pages WHERE id = ${pageId}
      UNION ALL
      SELECT p.id, p.inherit_access, b.depth + 1 FROM pages p JOIN below b ON p.parent_id = b.id
      WHERE b.depth < 1000
    )
    SELECT id FROM below WHERE depth = 0 OR NOT inherit_access`);
  return rows.map((row) => row.id);
}

/**
 * 0007: "Move to" between a database and normal pages: `row` under a database, or `page` under a
 * page or at the top of a space. The caller emits `page.kindChanged` with the answer after its
 * commit (the move route does).
 */
export async function changePageKind(
  tx: Executor,
  pageId: string,
  to: { kind: 'page' | 'row'; parentId: string | null; spaceId?: string },
  by: string,
): Promise<{ pageId: string; from: PageKind; to: PageKind }> {
  const moved = await movePage(tx, pageId, to, by);
  return { pageId, from: moved.from.kind, to: moved.to.kind };
}

/**
 * Everyone in the workspace who can open each page, as `<pageId> <userId>` pairs: grants on it
 * and on the pages and space it inherits from, the space's members, Admins in team spaces and the
 * owner of a Private section. Row rules aren't counted, and groups come with groups.
 */
export async function whoCanOpen(db: Executor, pageIds: readonly string[]): Promise<Set<string>> {
  const { rows } = await db.execute<{ pageId: string; userId: string }>(sql`
    WITH RECURSIVE chain AS (
      SELECT id AS page_id, id, space_id, parent_id, inherit_access, 0 AS depth FROM pages
      WHERE id = ANY(${uuidArray(pageIds)})
      UNION ALL
      SELECT c.page_id, a.id, a.space_id, a.parent_id, a.inherit_access, c.depth + 1
      FROM chain c JOIN pages a ON a.id = c.parent_id WHERE c.inherit_access AND c.depth < 1000
    ),
    top AS (SELECT page_id, space_id FROM chain WHERE parent_id IS NULL AND inherit_access),
    reaching AS (
      SELECT c.page_id, g.principal_type, g.principal_id
      FROM chain c JOIN access_grants g ON g.page_id = c.id
      WHERE c.depth = 0 OR g.level <> 'rows_only'
      UNION ALL
      SELECT t.page_id, g.principal_type, g.principal_id FROM top t JOIN access_grants g
        ON g.space_id = t.space_id WHERE g.level <> 'rows_only'
      UNION ALL
      SELECT t.page_id, m.principal_type, m.principal_id FROM top t JOIN space_members m
        ON m.space_id = t.space_id
    )
    SELECT c.page_id AS "pageId", w.user_id AS "userId"
    FROM chain c JOIN spaces s ON s.id = c.space_id
      JOIN workspace_members w ON w.workspace_id = s.workspace_id AND w.removed_at IS NULL
      LEFT JOIN roles r ON r.id = w.role_id
    WHERE c.depth = 0 AND (
      (s.kind = 'personal' AND w.user_id = s.owner_id)
      OR (s.kind <> 'personal' AND w.kind = 'member' AND 'workspace.admin' = ANY (r.permissions))
      OR EXISTS (SELECT 1 FROM reaching x WHERE x.page_id = c.page_id AND (
        (x.principal_type = 'user' AND x.principal_id = w.user_id)
        OR (w.kind = 'member' AND (x.principal_type = 'everyone'
          OR (x.principal_type = 'role' AND x.principal_id = w.role_id))))))`);
  return new Set(rows.map((row) => `${row.pageId} ${row.userId}`));
}
