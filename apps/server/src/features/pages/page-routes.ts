// HTTP for pages (decision 0007, section 4.1): making, opening and changing pages, and page
// cards. Who may do what: Pages and blocks 5 and the Sidebar spec 5.
import {
  atLeast,
  createPageSchema,
  pageCardsSchema,
  updatePageSchema,
  type CreatePageInput,
  type PageCardsJson,
  type PageJson,
  type UpdatePageInput,
} from '@carehub/shared';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { httpError } from '../../core/errors';
import { pageAccessOf, resolvePages, viewerFor, type Executor, type Viewer } from './access';
import { cardsFor } from './cards';
import { forbidden, notFound, spaceArchived } from './http';
import { createPage, readPage, updatePage } from './pages';
import { spacePlace } from './spaces';

const locked = () => httpError(403, 'forbidden', 'This page is locked. Unlock it to change it.');

/** Where a new page goes: a page that isn't locked, a space the person may add to, or Private. */
async function checkPlace(tx: Executor, viewer: Viewer, input: CreatePageInput) {
  if (input.parentId !== undefined) {
    const { rows } = await tx.execute<{ locked: boolean }>(sql`
      SELECT locked_at IS NOT NULL AS locked FROM pages WHERE id = ${input.parentId}`);
    if (rows[0]?.locked) throw locked();
  } else if (input.spaceId !== undefined) {
    const space = await spacePlace(tx, viewer, input.spaceId);
    if (space.archived) throw spaceArchived();
    if (space.ownersOnlyTopLevel && space.role !== 'owner' && !space.isAdmin) throw forbidden();
  }
}

export function pageRoutes(app: FastifyInstance): void {
  const { db } = app;
  const canView = { preHandler: app.requirePageAccess('view') };
  const canEdit = { preHandler: app.requirePageAccess('edit') };

  // Add a sub-page: Can edit on the parent. Top level: a member (owners, if the space says so).
  // Both need the Create permission, and Can edit on the new page.
  const create = { preHandler: app.requirePermission('pages.create') };
  app.post('/api/pages', create, async (request, reply) => {
    const input = createPageSchema.parse(request.body);
    const viewer = await viewerFor(request);
    const { workspaceId } = request.member!;
    const page = await db.transaction(async (tx) => {
      await checkPlace(tx, viewer, input);
      const made = await createPage(tx, {
        ...input,
        workspaceId,
        kind: 'page',
        createdBy: viewer.userId,
      });
      const level = (await resolvePages(tx, viewer, [made.id])).get(made.id)?.level ?? 'none';
      if (!atLeast(level, 'edit')) throw forbidden();
      return { ...made, level };
    });
    const { id: pageId, spaceId, parentId, kind } = page;
    app.events.emit('page.created', {
      pageId,
      workspaceId,
      spaceId,
      parentId,
      kind,
      by: viewer.userId,
    });
    return reply.code(201).send(await readPage(db, viewer, pageId, page.level));
  });

  app.get('/api/pages/:id', canView, async (request): Promise<PageJson> => {
    const { pageId, level } = pageAccessOf(request);
    return readPage(db, await viewerFor(request), pageId, level);
  });

  app.patch('/api/pages/:id', canEdit, async (request): Promise<PageJson> => {
    const changes = updatePageSchema.parse(request.body);
    const { pageId, workspaceId, level } = pageAccessOf(request);
    const viewer = await viewerFor(request);
    const named = (Object.keys(changes) as (keyof UpdatePageInput)[]).filter(
      (key) => changes[key] !== undefined,
    );
    await db.transaction(async (tx) => {
      const { rows } = await tx.execute<{ locked: boolean }>(sql`
        SELECT locked_at IS NOT NULL AS locked FROM pages WHERE id = ${pageId} FOR UPDATE`);
      const unlocking = changes.locked === false;
      if (rows[0]?.locked && !unlocking && named.some((key) => key !== 'locked')) throw locked();
      await updatePage(tx, pageId, changes, viewer.userId);
    });
    if (named.length > 0) {
      app.events.emit('page.updated', { pageId, workspaceId, by: viewer.userId, changes: named });
    }
    return readPage(db, viewer, pageId, level);
  });

  app.get('/api/pages/:id/card', canView, async (request) => {
    const { pageId } = pageAccessOf(request);
    const card = (await cardsFor(db, await viewerFor(request), [pageId])).get(pageId);
    if (!card || !('title' in card)) throw notFound();
    return card;
  });

  app.post('/api/pages/cards', async (request): Promise<PageCardsJson> => {
    const { ids } = pageCardsSchema.parse(request.body);
    const cards = await cardsFor(db, await viewerFor(request), ids);
    return { cards: ids.map((id) => cards.get(id)!) };
  });
}
