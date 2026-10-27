// HTTP for Trash (Page history and Trash 3.4 and 5; decision 0007, section 4.1). An entry is for
// the person who deleted it and people with Full access on it; a space, for its owners and Admins.
import {
  restorePageSchema,
  trashQuerySchema,
  type TrashJson,
  type TrashPlaceJson,
} from '@carehub/shared';
import { sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { httpError } from '../../core/errors';
import { pageAccessOf, resolvePages, viewerFor, type Executor, type Viewer } from './access';
import { forbidden, isUuid, notFound } from './http';
import { pageChanged, treeChanged } from './live';
import { movePage } from './move';
import { announceMove, checkTarget } from './page-routes';
import { restoreSpace } from './spaces';
import {
  deletePageForever,
  deleteSpaceForever,
  listTrash,
  placesInTrash,
  restorePage,
  trashPage,
  TRASH_RETENTION_DAYS,
  type TrashPlace,
} from './trash';

type Item = TrashPlace & { title: string; canRestore: boolean; canDeleteForever: boolean };

/** A page in Trash (or in a space in Trash), or a space in Trash, and what the person may do. */
async function trashItem(db: Executor, viewer: Viewer, workspaceId: string, id: unknown) {
  if (!isUuid(id)) throw notFound();
  const { rows: pages } = await db.execute<{ title: string; deletedBy: string | null }>(sql`
    SELECT p.title, coalesce(p.deleted_by, s.deleted_by) AS "deletedBy"
    FROM pages p JOIN spaces s ON s.id = p.space_id
    WHERE p.id = ${id} AND p.workspace_id = ${workspaceId}
      AND (p.deleted_at IS NOT NULL OR s.deleted_at IS NOT NULL)`);
  const isAdmin = viewer.memberships.get(workspaceId)?.isAdmin ?? false;
  if (pages[0]) {
    const full = (await resolvePages(db, viewer, [id])).get(id)?.level === 'full';
    const mine = pages[0].deletedBy === viewer.userId;
    const title = pages[0].title;
    return { type: 'page', id, title, canRestore: full || mine, canDeleteForever: full } as Item;
  }
  const { rows: spaces } = await db.execute<{ title: string; mine: boolean; owns: boolean }>(sql`
    SELECT s.name AS title, s.deleted_by = ${viewer.userId} AS mine,
      EXISTS (SELECT 1 FROM space_members m WHERE m.space_id = s.id AND m.role = 'owner'
        AND m.principal_type = 'user' AND m.principal_id = ${viewer.userId}) AS owns
    FROM spaces s WHERE s.id = ${id} AND s.workspace_id = ${workspaceId}
      AND s.deleted_at IS NOT NULL AND s.kind <> 'personal'`);
  const space = spaces[0];
  if (!space) throw notFound();
  const manages = isAdmin || space.owns;
  const { title } = space;
  return {
    type: 'space',
    id,
    title,
    canRestore: manages || space.mine,
    canDeleteForever: manages,
  } as Item;
}

/** 409 "Policies is in Trash too. Restore it as well, or move Refund steps somewhere else?" */
async function placeInTrash(
  db: Executor,
  viewer: Viewer,
  workspaceId: string,
  page: Item,
  place: TrashPlace,
) {
  let title: string | null = null;
  if (place.type === 'space') {
    title = (await trashItem(db, viewer, workspaceId, place.id)).title;
  } else if ((await resolvePages(db, viewer, [place.id])).get(place.id)?.level !== 'none') {
    const { rows } = await db.execute<{ title: string }>(sql`
      SELECT title FROM pages WHERE id = ${place.id}`);
    title = rows[0]?.title ?? null;
  }
  const where = title || (place.type === 'space' ? 'Its space' : 'The page it was in');
  const details: TrashPlaceJson = { ...place, title };
  const message = `${where} is in Trash too. Restore it as well, or move ${page.title || 'Untitled'} somewhere else?`;
  return httpError(409, 'conflict', message, details);
}

export function trashRoutes(app: FastifyInstance): void {
  const { db } = app;
  const workspaceOf = (request: FastifyRequest) => request.member!.workspaceId;
  const idOf = (request: FastifyRequest) => (request.params as { id?: unknown }).id;

  // "Move to Trash" (Full access), and Undo with POST /api/trash/:id/restore.
  const canTrash = { preHandler: app.requirePageAccess('full') };
  app.delete('/api/pages/:id', canTrash, async (request, reply) => {
    const { pageId } = pageAccessOf(request);
    const viewer = await viewerFor(request);
    const trashed = await db.transaction((tx) => trashPage(tx, pageId, viewer.userId));
    app.events.emit('page.trashed', { ...trashed, by: viewer.userId });
    treeChanged(trashed.spaceId);
    for (const id of trashed.pageIds) pageChanged(id);
    return reply.code(204).send();
  });

  const people = { preHandler: app.requireMember, config: { allowGuests: true } };
  app.get('/api/trash', people, async (request): Promise<TrashJson> => {
    const query = trashQuerySchema.parse(request.query);
    const viewer = await viewerFor(request);
    const id = workspaceOf(request);
    const isAdmin = viewer.memberships.get(id)?.isAdmin ?? false;
    const entries = await listTrash(db, viewer, { id, isAdmin }, query);
    return { entries, retentionDays: TRASH_RETENTION_DAYS };
  });

  app.post('/api/trash/:id/restore', people, async (request, reply) => {
    const { withParents = false, moveTo } = restorePageSchema.parse(request.body ?? {});
    const viewer = await viewerFor(request);
    const workspaceId = workspaceOf(request);
    const by = viewer.userId;
    const { pages, spaceIds, moved } = await db.transaction(async (tx) => {
      const item = await trashItem(tx, viewer, workspaceId, idOf(request));
      if (!item.canRestore) throw forbidden();
      if (item.type === 'space') {
        await restoreSpace(tx, item.id);
        return { pages: [], spaceIds: [item.id], moved: undefined };
      }
      const places = await placesInTrash(tx, item.id);
      if (places[0] && !withParents && !moveTo) {
        throw await placeInTrash(tx, viewer, workspaceId, item, places[0]);
      }
      for (const place of withParents ? places : []) {
        if (!(await trashItem(tx, viewer, workspaceId, place.id)).canRestore) throw forbidden();
      }
      if (moveTo) await checkTarget(tx, viewer, moveTo);
      const restored = await restorePage(tx, item.id, by, { withParents, alone: !!moveTo });
      return { ...restored, moved: moveTo && (await movePage(tx, item.id, moveTo, by)) };
    });
    for (const restored of pages) app.events.emit('page.restored', { ...restored, by });
    const spaces = new Set([...spaceIds, ...pages.map((restored) => restored.spaceId)]);
    if (moved) announceMove(app, moved, by);
    else for (const spaceId of spaces) treeChanged(spaceId);
    return reply.code(204).send();
  });

  // "Delete forever": Full access on it (spaces: owners and Admins). Undo isn't possible.
  app.delete('/api/trash/:id', people, async (request, reply) => {
    const viewer = await viewerFor(request);
    const gone = await db.transaction(async (tx) => {
      const item = await trashItem(tx, viewer, workspaceOf(request), idOf(request));
      if (!item.canDeleteForever) throw forbidden();
      if (item.type === 'space') return deleteSpaceForever(tx, item.id);
      return [await deletePageForever(tx, item.id)];
    });
    for (const pages of gone) app.events.emit('page.deleted', { ...pages, by: viewer.userId });
    return reply.code(204).send();
  });
}
