// Archive (Page history and Trash 3.5): pages and databases that are done but worth keeping. The
// page and everything under it, Trash included, turn read-only (resolvePages) and leave the
// sidebar tree. Unarchive puts back exactly those pages: they share the archive's root
// (`archive_root_id`).
import { atLeast, type ArchivedPageJson } from '@carehub/shared';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { loadViewer, resolvePages, viewerFor, type Executor } from './access';
import { conflict, forbidden, invalid, isUuid, notFound, spaceArchived, uuidArray } from './http';
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

/**
 * The page, locked, once `by` has Full access on it (as if it weren't archived). In an archived
 * space, anyone who can open it gets the space's 409.
 */
async function target(tx: Executor, pageId: string, by: string): Promise<Target> {
  if (!isUuid(pageId)) throw notFound();
  const viewer = await loadViewer(tx, by);
  const answer = (await resolvePages(tx, viewer, [pageId], { unarchiving: true })).get(pageId);
  if (!answer || answer.deleted) throw notFound();
  if (answer.level === 'none') throw forbidden();
  const { rows } = await tx.execute<Target & { inArchivedSpace: boolean }>(sql`
    SELECT p.id, p.workspace_id AS "workspaceId", p.space_id AS "spaceId", p.kind,
      p.archive_root_id AS "rootId", a.archived_at IS NOT NULL AS "parentArchived",
      s.archived_at IS NOT NULL AS "inArchivedSpace"
    FROM pages p JOIN spaces s ON s.id = p.space_id LEFT JOIN pages a ON a.id = p.parent_id
    WHERE p.id = ${pageId} FOR UPDATE OF p`);
  const { inArchivedSpace, ...page } = rows[0]!;
  if (inArchivedSpace) throw spaceArchived();
  if (!atLeast(answer.level, 'full')) throw forbidden();
  return page;
}

const archived = (page: Target, rows: { id: string }[]): ArchivedPages => ({
  pageId: page.id,
  workspaceId: page.workspaceId,
  spaceId: page.spaceId,
  pageIds: rows.map((row) => row.id),
});

/**
 * 0007: archives a page or database with everything under it, Trash included (so a page restored
 * later comes back archived); `by` needs Full access. Sub-pages archived earlier keep their own
 * archive. A row can't be archived on its own.
 */
export async function archivePage(tx: Executor, pageId: string, by: string) {
  const page = await target(tx, pageId, by);
  if (page.kind === 'row') throw invalid("Rows can't be archived. Use a property or Trash.");
  if (page.rootId !== null) throw conflict('This page is already archived.');
  const { rows } = await tx.execute<{ id: string }>(sql`
    WITH RECURSIVE sub AS (
      SELECT ${page.id}::uuid AS id
      UNION ALL
      SELECT p.id FROM pages p JOIN sub ON p.parent_id = sub.id WHERE p.archived_at IS NULL
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

/** The pages in `pageIds` that are archived (Page history 3.5), for search, Forms and notices. */
export async function getArchivedPageIds(
  db: Executor,
  pageIds: readonly string[],
): Promise<Set<string>> {
  const { rows } = await db.execute<{ id: string }>(sql`
    SELECT id FROM pages WHERE id = ANY(${uuidArray(pageIds)}) AND archived_at IS NOT NULL`);
  return new Set(rows.map((row) => row.id));
}

/**
 * Archive and Unarchive (page menu and banner): the page as it is now and how many pages under
 * it went along. Each page also gets `page.updated` with `archived`, so open editors re-check.
 */
export function archiveRoutes(app: FastifyInstance): void {
  const { db } = app;
  for (const action of ['archive', 'unarchive'] as const) {
    const change = action === 'archive' ? archivePage : unarchivePage;
    const route = `/api/pages/:id/${action}`;
    app.post(
      route,
      { preHandler: app.requireMember },
      async (request): Promise<ArchivedPageJson> => {
        const { id } = request.params as { id: string };
        const viewer = await viewerFor(request);
        const done = await db.transaction((tx) => change(tx, id, viewer.userId));
        const by = viewer.userId;
        app.events.emit(`page.${action}d` as const, { ...done, by });
        for (const pageId of done.pageIds) {
          const { workspaceId } = done;
          app.events.emit('page.updated', { pageId, workspaceId, by, changes: ['archived'] });
          pageChanged(pageId);
        }
        treeChanged(done.spaceId);
        const level = (await resolvePages(db, viewer, [id])).get(id)?.level ?? 'none';
        return { ...(await readPage(db, viewer, id, level)), subPages: done.pageIds.length - 1 };
      },
    );
  }
}
