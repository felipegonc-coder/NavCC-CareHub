// Stand-ins for the page model's createPage, setPageTitle, trashPage and restorePage (decision
// 0007, section 4.1) until core has them; then these calls switch to core's and this file goes.
// Access checks stay with the caller. Like core's, they never emit: the caller does after commit.
import { sql } from 'drizzle-orm';
import type { Tx } from '../../db';
import { uuidList } from './store';

export interface NewRowPage {
  /** Made by the caller, so template presets can point at the new row ("This page"). */
  id: string;
  workspaceId: string;
  spaceId: string;
  databaseId: string;
  title: string;
  /** null for an anonymous form answer. */
  createdBy: string | null;
}

/** A row page under its database page. Rows are ordered by the views, not by page position. */
export async function createRowPage(tx: Tx, page: NewRowPage): Promise<void> {
  await tx.execute(sql`
    INSERT INTO pages
      (id, workspace_id, space_id, parent_id, kind, title, position, created_by, updated_by)
    VALUES (${page.id}, ${page.workspaceId}, ${page.spaceId}, ${page.databaseId}, 'row',
      ${page.title}, 'a' || to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISSUS'),
      ${page.createdBy}, ${page.createdBy})`);
}

/** Renames a page. */
export async function setPageTitle(tx: Tx, pageId: string, title: string, by: string | null) {
  await tx.execute(sql`
    UPDATE pages SET title = ${title}, updated_by = ${by}, updated_at = now() WHERE id = ${pageId}`);
}

/**
 * Moves rows to Trash with the pages inside them (each marked with the row it went with, so they
 * come back together). Returns the ids of the rows that moved; rows already in Trash are skipped.
 */
export async function trashPages(
  tx: Tx,
  pageIds: readonly string[],
  by: string,
): Promise<string[]> {
  const { rows } = await tx.execute<{ id: string }>(sql`
    WITH RECURSIVE tree AS (
      SELECT id, id AS root FROM pages WHERE id = ANY(${uuidList(pageIds)}) AND deleted_at IS NULL
      UNION ALL
      SELECT p.id, t.root FROM pages p JOIN tree t ON p.parent_id = t.id WHERE p.deleted_at IS NULL
    )
    UPDATE pages SET deleted_at = now(), deleted_by = ${by}, trash_root_id = tree.root
    FROM tree WHERE pages.id = tree.id
    RETURNING pages.id`);
  const moved = new Set(rows.map((r) => r.id));
  return pageIds.filter((id) => moved.has(id));
}

/** Brings rows back from Trash with the pages that went with them. Returns the rows restored. */
export async function restorePages(
  tx: Tx,
  pageIds: readonly string[],
  by: string,
): Promise<string[]> {
  const { rows } = await tx.execute<{ id: string }>(sql`
    UPDATE pages SET deleted_at = NULL, deleted_by = NULL, trash_root_id = NULL,
      updated_by = ${by}, updated_at = now()
    WHERE trash_root_id = ANY(${uuidList(pageIds)}) AND deleted_at IS NOT NULL
    RETURNING id`);
  const back = new Set(rows.map((r) => r.id));
  return pageIds.filter((id) => back.has(id));
}
