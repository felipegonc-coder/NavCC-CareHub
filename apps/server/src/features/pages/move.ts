// Moving pages with everything under them (Sidebar spec 3.2 and 5; Pages and blocks 3.2, "Move
// to"), and turning pages into database rows and back (decision 0007, section 3.3). Access checks
// and events are the caller's.
import type { PageKind } from '@carehub/shared';
import { sql } from 'drizzle-orm';
import type { Executor } from './access';
import { invalid, isUuid, notFound } from './http';
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
 * Moves a page, database or row with everything under it, Trash included. A page put in a
 * database becomes a row; a row put anywhere else becomes a page.
 */
export async function movePage(tx: Executor, pageId: string, move: PageMove, by: string) {
  if (!isUuid(pageId)) throw notFound();
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
    const { rows: loop } = await tx.execute(sql`
      WITH RECURSIVE up AS (
        SELECT id, parent_id FROM pages WHERE id = ${parentId}
        UNION SELECT p.id, p.parent_id FROM pages p JOIN up ON p.id = up.parent_id
      )
      SELECT 1 FROM up WHERE id = ${pageId}`);
    if (loop.length > 0) throw invalid("A page can't go inside itself.");
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
 * Everyone in the workspace who can open the page: grants on it and on the pages and space it
 * inherits from, the space's members, Admins in team spaces and the owner of a Private section.
 * Row rules aren't counted, and groups come with groups.
 */
export async function whoCanOpen(db: Executor, pageId: string): Promise<Set<string>> {
  const { rows } = await db.execute<{ userId: string }>(sql`
    WITH RECURSIVE chain AS (
      SELECT id, space_id, parent_id, inherit_access, 0 AS depth FROM pages WHERE id = ${pageId}
      UNION ALL
      SELECT a.id, a.space_id, a.parent_id, a.inherit_access, c.depth + 1
      FROM chain c JOIN pages a ON a.id = c.parent_id WHERE c.inherit_access AND c.depth < 1000
    ),
    top AS (SELECT space_id FROM chain WHERE parent_id IS NULL AND inherit_access),
    reaching AS (
      SELECT g.principal_type, g.principal_id FROM chain c JOIN access_grants g ON g.page_id = c.id
      WHERE c.depth = 0 OR g.level <> 'rows_only'
      UNION ALL
      SELECT g.principal_type, g.principal_id FROM top t JOIN access_grants g
        ON g.space_id = t.space_id WHERE g.level <> 'rows_only'
      UNION ALL
      SELECT m.principal_type, m.principal_id FROM top t JOIN space_members m
        ON m.space_id = t.space_id
    )
    SELECT w.user_id AS "userId"
    FROM chain c JOIN spaces s ON s.id = c.space_id
      JOIN workspace_members w ON w.workspace_id = s.workspace_id AND w.removed_at IS NULL
      LEFT JOIN roles r ON r.id = w.role_id
    WHERE c.depth = 0 AND (
      (s.kind = 'personal' AND w.user_id = s.owner_id)
      OR (s.kind <> 'personal' AND w.kind = 'member' AND 'workspace.admin' = ANY (r.permissions))
      OR EXISTS (SELECT 1 FROM reaching x
        WHERE (x.principal_type = 'user' AND x.principal_id = w.user_id)
          OR (w.kind = 'member' AND (x.principal_type = 'everyone'
            OR (x.principal_type = 'role' AND x.principal_id = w.role_id)))))`);
  return new Set(rows.map((row) => row.userId));
}
