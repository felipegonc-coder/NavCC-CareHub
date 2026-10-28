// Archive (Page history and Trash 3.5): pages and databases that are done but worth keeping. The
// page and everything live under it turn read-only (resolvePages) and leave the sidebar tree.
// Unarchive puts back exactly those pages: they share the archive's root (`archive_root_id`).
import { atLeast, type PageJson } from '@carehub/shared';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { loadViewer, resolvePages, viewerFor, type Executor } from './access';
import { conflict, forbidden, invalid, isUuid, notFound } from './http';
import { pageChanged, treeChanged } from './live';
import { readPage } from './pages';

export type ArchivedPages = {
  /** The archive's root: the page that was archived. */
  pageId: string;
  workspaceId: string;
  spaceId: string;
  /** The root and the sub-pages, databases and rows archived with it. */
  pageIds: string[];
};

type Target = Omit<ArchivedPages, 'pageId' | 'pageIds'> & {
  id: string;
  kind: string;
  rootId: string | null;
  parentArchived: boolean;
};

/** The page, locked, once `by` has Full access on it (as if it weren't archived). */
async function target(tx: Executor, pageId: string, by: string): Promise<Target> {
  if (!isUuid(pageId)) throw notFound();
  const viewer = await loadViewer(tx, by);
  const answer = (await resolvePages(tx, viewer, [pageId], { unarchiving: true })).get(pageId);
  if (!answer || answer.deleted) throw notFound();
  if (!atLeast(answer.level, 'full')) throw forbidden();
  const { rows } = await tx.execute<Target>(sql`
    SELECT p.id, p.workspace_id AS "workspaceId", p.space_id AS "spaceId", p.kind,
      p.archive_root_id AS "rootId", a.archived_at IS NOT NULL AS "parentArchived"
    FROM pages p LEFT JOIN pages a ON a.id = p.parent_id
    WHERE p.id = ${pageId} FOR UPDATE OF p`);
  return rows[0]!;
}

const archived = (page: Target, rows: { id: string }[]): ArchivedPages => ({
  pageId: page.id,
  workspaceId: page.workspaceId,
  spaceId: page.spaceId,
  pageIds: rows.map((row) => row.id),
});

/**
 * 0007: archives a page or database with everything live under it; `by` needs Full access.
 * Sub-pages archived earlier keep their own archive. A row can't be archived on its own.
 */
export async function archivePage(tx: Executor, pageId: string, by: string) {
  const page = await target(tx, pageId, by);
  if (page.kind === 'row') throw invalid("Rows can't be archived. Use a property or Trash.");
  if (page.rootId !== null) throw conflict('This page is already archived.');
  const { rows } = await tx.execute<{ id: string }>(sql`
    WITH RECURSIVE sub AS (
      SELECT ${page.id}::uuid AS id
      UNION ALL
      SELECT p.id FROM pages p JOIN sub ON p.parent_id = sub.id
      WHERE p.deleted_at IS NULL AND p.archived_at IS NULL
    )
    UPDATE pages SET archived_at = now(), archived_by = ${by}, archive_root_id = ${page.id}
    WHERE id IN (SELECT id FROM sub) RETURNING id`);
  return archived(page, rows);
}

/**
 * 0007: unarchives the archive the page is in, so its root and every page archived with it come
 * back; `by` needs Full access on both. 409 while the page above the root is archived too.
 */
export async function unarchivePage(tx: Executor, pageId: string, by: string) {
  let page = await target(tx, pageId, by);
  if (page.rootId === null) throw conflict("This page isn't archived.");
  if (page.rootId !== page.id) page = await target(tx, page.rootId, by);
  if (page.parentArchived) {
    throw conflict('The page above it is archived too. Unarchive that one first.');
  }
  const { rows } = await tx.execute<{ id: string }>(sql`
    UPDATE pages SET archived_at = NULL, archived_by = NULL, archive_root_id = NULL
    WHERE archive_root_id = ${page.id} RETURNING id`);
  return archived(page, rows);
}

/** Archive and Unarchive (page menu and banner); both answer with the page as it is now. */
export function archiveRoutes(app: FastifyInstance): void {
  const { db } = app;
  for (const action of ['archive', 'unarchive'] as const) {
    const change = action === 'archive' ? archivePage : unarchivePage;
    const route = `/api/pages/:id/${action}`;
    app.post(route, { preHandler: app.requireMember }, async (request): Promise<PageJson> => {
      const { id } = request.params as { id: string };
      const viewer = await viewerFor(request);
      const done = await db.transaction((tx) => change(tx, id, viewer.userId));
      app.events.emit(`page.${action}d` as const, { ...done, by: viewer.userId });
      treeChanged(done.spaceId);
      for (const pageId of done.pageIds) pageChanged(pageId);
      const level = (await resolvePages(db, viewer, [id])).get(id)?.level ?? 'none';
      return readPage(db, viewer, id, level);
    });
  }
}
