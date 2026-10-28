// Stand-ins for the page model's createPage and page lookup (decision 0007, section 4.1) until core
// has them; then these calls switch to core's and this file goes. Access checks stay with the
// caller (app.requirePageAccess).
import { sql } from 'drizzle-orm';
import type { Tx } from '../../db';
import { isUuid } from './record';
import type { Executor } from './store';

export type PageKind = 'page' | 'database' | 'row';

/** Where a page is. */
export interface PagePlace {
  id: string;
  workspaceId: string;
  spaceId: string;
  parentId: string | null;
  kind: PageKind;
  inTrash: boolean;
}

type PlaceRow = {
  id: string;
  workspace_id: string;
  space_id: string;
  parent_id: string | null;
  kind: PageKind;
  in_trash: boolean;
};

export async function loadPagePlace(db: Executor, id: string): Promise<PagePlace | null> {
  if (!isUuid(id)) return null;
  const { rows } = await db.execute<PlaceRow>(sql`
    SELECT id, workspace_id, space_id, parent_id, kind, deleted_at IS NOT NULL AS in_trash
    FROM pages WHERE id = ${id}`);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    spaceId: row.space_id,
    parentId: row.parent_id,
    kind: row.kind,
    inTrash: row.in_trash,
  };
}

export interface NewDatabasePage {
  workspaceId: string;
  spaceId: string;
  parentId: string;
  title: string;
  inline: boolean;
  createdBy: string;
}

/** A database page, last among its parent's pages. Returns its id. */
export async function createDatabasePage(tx: Tx, page: NewDatabasePage): Promise<string> {
  const { rows } = await tx.execute<{ id: string }>(sql`
    INSERT INTO pages
      (workspace_id, space_id, parent_id, kind, is_inline, title, position, created_by, updated_by)
    VALUES (${page.workspaceId}, ${page.spaceId}, ${page.parentId}, 'database', ${page.inline},
      ${page.title},
      COALESCE(
        (SELECT max(position) || 'V' FROM pages WHERE space_id = ${page.spaceId} AND parent_id = ${page.parentId}),
        'a0'),
      ${page.createdBy}, ${page.createdBy})
    RETURNING id`);
  const id = rows[0]?.id;
  if (!id) throw new Error('The database page was not saved.');
  return id;
}
