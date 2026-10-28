// HTTP for pages (decision 0007, section 4.1): making, opening, changing and moving pages, and
// page cards. Who may do what: Pages and blocks 5 and the Sidebar spec 5.
import {
  atLeast,
  createPageSchema,
  hasPermission,
  movePageSchema,
  pageCardsSchema,
  updatePageSchema,
  type AccessChangeJson,
  type CreatePageInput,
  type PageCardsJson,
  type PageJson,
  type UpdatePageInput,
} from '@carehub/shared';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { httpError } from '../../core/errors';
import { recheckSubscriptions } from '../live';
import {
  pageAccessOf,
  resolvePages,
  resolveSpace,
  viewerFor,
  type Executor,
  type Viewer,
} from './access';
import { cardsFor } from './cards';
import { forbidden, invalid, notFound, spaceArchived } from './http';
import { pageChanged, treeChanged } from './live';
import {
  lockMoves,
  movePage,
  ownAccessPages,
  whoCanOpen,
  type MovedPage,
  type PageMove,
} from './move';
import { grantCreator, insertPage, readPage, updatePage } from './pages';
import { spacePlace } from './spaces';

const locked = () => httpError(403, 'forbidden', 'This page is locked. Unlock it to change it.');

/**
 * Where a new page goes: a page the person can edit that isn't locked, a space they may add to,
 * or Private. Nothing about a parent is told before the person is found to edit it.
 */
async function checkPlace(tx: Executor, viewer: Viewer, input: CreatePageInput) {
  if (input.parentId !== undefined) {
    const parent = (await resolvePages(tx, viewer, [input.parentId])).get(input.parentId);
    if (!parent || parent.deleted) throw notFound();
    if (!atLeast(parent.level, parent.kind === 'database' ? 'edit_content' : 'edit')) {
      throw forbidden();
    }
    const { rows } = await tx.execute<{ locked: boolean }>(sql`
      SELECT locked_at IS NOT NULL AS locked FROM pages WHERE id = ${input.parentId}`);
    if (rows[0]?.locked) throw locked();
  } else if (input.spaceId !== undefined) {
    const space = await spacePlace(tx, viewer, input.spaceId);
    if (space.archived) throw spaceArchived();
    if (space.ownersOnlyTopLevel && space.role !== 'owner' && !space.isAdmin) throw forbidden();
  }
}

/** Can edit where a moved page goes (Sidebar spec 5): on the parent, or at the space's top. */
export async function checkTarget(tx: Executor, viewer: Viewer, move: PageMove) {
  if (move.parentId === null) {
    if (move.spaceId === undefined) throw invalid('Choose a page or a space to move it to.');
    await checkPlace(tx, viewer, { spaceId: move.spaceId });
    if (!atLeast(await resolveSpace(tx, viewer, move.spaceId), 'edit')) throw forbidden();
    return;
  }
  await checkPlace(tx, viewer, { parentId: move.parentId });
}

const people = (count: number) => (count === 1 ? '1 person' : `${count} people`);

/** 409 before a move that changes who can open the page (SB-04): the confirm's words. */
function accessChange({ losing, gaining }: AccessChangeJson) {
  const message =
    gaining === 0
      ? `${people(losing)} will lose access.`
      : losing === 0
        ? `${people(gaining)} will gain access.`
        : `${people(losing)} will lose access and ${gaining} will gain it.`;
  return httpError(409, 'conflict', message, { losing, gaining });
}

/**
 * A move with every rule, for the move route and Trash's "Move to" (Sidebar spec 5): Can edit
 * where it goes, the service's checks, and the 409 question when it changes who can open the page
 * or a page under it that keeps its own access. Full access on the page is the caller's check.
 */
export async function checkedMove(
  tx: Executor,
  viewer: Viewer,
  pageId: string,
  move: PageMove,
  confirmed: boolean,
) {
  await lockMoves(tx, pageId);
  await checkTarget(tx, viewer, move);
  const pages = await ownAccessPages(tx, pageId);
  const before = await whoCanOpen(tx, pages);
  const moved = await movePage(tx, pageId, move, viewer.userId);
  const after = await whoCanOpen(tx, pages);
  // People with a page they could open before and not after (and the other way round).
  const dropped = (from: Set<string>, to: Set<string>) =>
    new Set([...from].filter((pair) => !to.has(pair)).map((pair) => pair.split(' ')[1]!));
  const losing = [...dropped(before, after)];
  const gaining = dropped(after, before).size;
  if (!confirmed && losing.length + gaining > 0) {
    throw accessChange({ losing: losing.length, gaining });
  }
  return { moved, losing };
}

/** After a move's commit: `page.updated`, `page.kindChanged` if it changed kind, and nudges. */
export function announceMove(app: FastifyInstance, moved: MovedPage, by: string): void {
  const { pageId, workspaceId, from, to } = moved;
  const changes = (['spaceId', 'parentId', 'kind'] as const).filter((key) => from[key] !== to[key]);
  app.events.emit('page.updated', { pageId, workspaceId, by, changes: [...changes, 'position'] });
  if (from.kind !== to.kind) {
    app.events.emit('page.kindChanged', { pageId, workspaceId, from: from.kind, to: to.kind, by });
  }
  treeChanged(from.spaceId);
  if (to.spaceId !== from.spaceId) treeChanged(to.spaceId);
  pageChanged(pageId);
}

export function pageRoutes(app: FastifyInstance): void {
  const { db } = app;
  const canView = { preHandler: app.requirePageAccess('view') };
  const canEdit = { preHandler: app.requirePageAccess('edit') };

  // Add a sub-page: Can edit on the parent. Top level: a member (owners, if the space says so).
  // Both need the Create permission, and Can edit on the new page before the creator's grant.
  // Guests have no permissions, but may add sub-pages where they can edit (Roles spec 3, Guests).
  const create = { preHandler: app.requireMember, config: { allowGuests: true } };
  app.post('/api/pages', create, async (request, reply) => {
    const input = createPageSchema.parse(request.body);
    const member = request.member!;
    const guest = member.kind === 'guest';
    if (!(guest ? input.parentId : hasPermission(member, 'pages.create'))) throw forbidden();
    const viewer = await viewerFor(request);
    const { workspaceId } = member;
    const levelOf = async (tx: Executor, id: string) =>
      (await resolvePages(tx, viewer, [id])).get(id)?.level ?? 'none';
    const page = await db.transaction(async (tx) => {
      await checkPlace(tx, viewer, input);
      const made = await insertPage(tx, {
        ...input,
        workspaceId,
        kind: 'page',
        createdBy: viewer.userId,
      });
      if (!atLeast(await levelOf(tx, made.id), 'edit')) throw forbidden();
      await grantCreator(tx, made, viewer.userId);
      return { ...made, level: await levelOf(tx, made.id) };
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
    treeChanged(spaceId);
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
    const page = await readPage(db, viewer, pageId, level);
    if (named.length > 0) {
      app.events.emit('page.updated', { pageId, workspaceId, by: viewer.userId, changes: named });
      pageChanged(pageId);
      const inTree = page.kind !== 'row' && !page.isInline;
      if (inTree && (named.includes('title') || named.includes('icon'))) treeChanged(page.spaceId);
    }
    return page;
  });

  // Full access on the page and Can edit where it goes. Rows and inline databases move too (the
  // database's and the editor's "Move to"), with everything under them.
  const canMove = { preHandler: app.requirePageAccess('full') };
  app.post('/api/pages/:id/move', canMove, async (request): Promise<PageJson> => {
    const { confirmAccessChange = false, ...move } = movePageSchema.parse(request.body);
    const { pageId } = pageAccessOf(request);
    const viewer = await viewerFor(request);
    const { moved, losing } = await db.transaction((tx) =>
      checkedMove(tx, viewer, pageId, move, confirmAccessChange),
    );
    announceMove(app, moved, viewer.userId);
    for (const userId of losing) void recheckSubscriptions(userId);
    const level = (await resolvePages(db, viewer, [pageId])).get(pageId)?.level ?? 'none';
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
