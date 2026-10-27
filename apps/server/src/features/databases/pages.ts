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
  /** Absent: a new id. */
  id?: string;
  workspaceId: string;
  spaceId: string;
  /** null: the top of the space (never for an inline database). */
  parentId: string | null;
  title: string;
  inline: boolean;
  /** As the pages API stores them ({ type: 'emoji', emoji } and so on); absent: none. */
  icon?: unknown;
  cover?: unknown;
  createdBy: string;
}

const asJson = (value: unknown) =>
  value === undefined || value === null ? null : JSON.stringify(value);

/** A database page, last among its parent's pages. Returns its id. */
export async function createDatabasePage(tx: Executor, page: NewDatabasePage): Promise<string> {
  const { rows } = await tx.execute<{ id: string }>(sql`
    INSERT INTO pages (id, workspace_id, space_id, parent_id, kind, is_inline, title, icon, cover,
      position, created_by, updated_by)
    VALUES (COALESCE(${page.id ?? null}::uuid, gen_random_uuid()), ${page.workspaceId},
      ${page.spaceId}, ${page.parentId}, 'database', ${page.inline}, ${page.title},
      ${asJson(page.icon)}::jsonb, ${asJson(page.cover)}::jsonb,
      COALESCE(
        (SELECT max(position) || 'V' FROM pages
          WHERE space_id = ${page.spaceId} AND parent_id IS NOT DISTINCT FROM ${page.parentId}::uuid),
        'a0'),
      ${page.createdBy}, ${page.createdBy})
    RETURNING id`);
  const id = rows[0]?.id;
  if (!id) throw new Error('The database page was not saved.');
  return id;
}

export interface NewTemplatePage {
  id: string;
  databaseId: string;
  workspaceId: string;
  spaceId: string;
  title: string;
  createdBy: string;
}

/**
 * A database template's page (decision 0200): a row page under the database with no db_rows
 * entry, so nothing that lists rows ever shows it.
 */
export async function createTemplatePage(tx: Tx, page: NewTemplatePage): Promise<void> {
  await tx.execute(sql`
    INSERT INTO pages
      (id, workspace_id, space_id, parent_id, kind, title, position, created_by, updated_by)
    VALUES (${page.id}, ${page.workspaceId}, ${page.spaceId}, ${page.databaseId}, 'row',
      ${page.title},
      COALESCE(
        (SELECT max(position) || 'V' FROM pages WHERE space_id = ${page.spaceId} AND parent_id = ${page.databaseId}),
        'a0'),
      ${page.createdBy}, ${page.createdBy})`);
}

/** Only a template's page: under this database, a row page, and not a row. */
const templatePageOf = (id: string, databaseId: string) => sql`
  id = ${id} AND parent_id = ${databaseId} AND kind = 'row'
  AND NOT EXISTS (SELECT 1 FROM db_rows WHERE page_id = ${id})`;

/** A template page's title follows the template's Name preset. */
export async function setTemplatePageTitle(
  tx: Tx,
  id: string,
  databaseId: string,
  title: string,
  by: string,
): Promise<void> {
  if (!isUuid(id) || !isUuid(databaseId)) return;
  await tx.execute(sql`
    UPDATE pages SET title = ${title}, updated_by = ${by}, updated_at = now()
    WHERE ${templatePageOf(id, databaseId)}`);
}

/** Deletes a template's page for good, with everything under it. */
export async function deleteTemplatePage(tx: Tx, id: string, databaseId: string): Promise<void> {
  if (!isUuid(id) || !isUuid(databaseId)) return;
  await tx.execute(sql`DELETE FROM pages WHERE ${templatePageOf(id, databaseId)}`);
}
