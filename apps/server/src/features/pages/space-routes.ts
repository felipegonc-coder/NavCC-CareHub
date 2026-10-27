// HTTP for spaces (decision 0007, section 4.1; Sidebar spec 3.3 and 5). Guests have no spaces.
import {
  addSpaceMembersSchema,
  createSpaceSchema,
  listSpacesQuerySchema,
  updateSpaceMemberSchema,
  updateSpaceSchema,
  type SpaceListJson,
} from '@carehub/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { viewerFor } from './access';
import { conflict, forbidden, spaceArchived } from './http';
import {
  addSpaceMembers,
  countSpacePages,
  createSpace,
  findSpace,
  getPrivateSpaceId,
  joinSpace,
  listSpaceMembers,
  listSpaces,
  removeSpaceMember,
  setSpaceMemberRole,
  trashSpace,
  updateSpace,
  type SpaceViewer,
} from './spaces';

async function asker(request: FastifyRequest): Promise<SpaceViewer> {
  const { member } = request;
  if (!member) throw forbidden();
  const viewer = await viewerFor(request);
  return { viewer, workspaceId: member.workspaceId, isAdmin: member.isAdmin };
}

const params = (request: FastifyRequest) => request.params as { id?: unknown; memberId?: unknown };

export function spaceRoutes(app: FastifyInstance): void {
  const { db } = app;
  const members = { preHandler: app.requireMember };

  /** A space the person manages (its owners and Admins) that isn't archived. */
  async function managed(request: FastifyRequest) {
    const who = await asker(request);
    const space = await findSpace(db, who, params(request).id);
    if (!space.canManage) throw forbidden();
    if (space.archivedAt !== null) throw spaceArchived();
    return { who, space };
  }

  const sidebar = { preHandler: app.requireMember, config: { allowGuests: true } };
  app.get('/api/spaces', sidebar, async (request): Promise<SpaceListJson> => {
    const { scope } = listSpacesQuerySchema.parse(request.query);
    if (request.member?.kind === 'guest') return { spaces: [], privateSpaceId: null };
    const who = await asker(request);
    if (scope === 'all' && !who.isAdmin) throw forbidden();
    const spaces = await listSpaces(db, who, scope);
    const privateSpaceId = await getPrivateSpaceId(db, who.viewer.userId, who.workspaceId);
    return { spaces, privateSpaceId };
  });

  // Who may create spaces becomes a workspace setting with Settings (Sidebar spec 3.3).
  const creators = { preHandler: app.requirePermission('pages.create') };
  app.post('/api/spaces', creators, async (request, reply) => {
    const input = createSpaceSchema.parse(request.body);
    const who = await asker(request);
    const createdBy = who.viewer.userId;
    const id = await db.transaction((tx) =>
      createSpace(tx, { ...input, workspaceId: who.workspaceId, createdBy }),
    );
    return reply.code(201).send(await findSpace(db, who, id));
  });

  app.get('/api/spaces/:id', members, async (request) => {
    const space = await findSpace(db, await asker(request), params(request).id);
    return { ...space, pageCount: await countSpacePages(db, space.id) };
  });

  app.patch('/api/spaces/:id', members, async (request) => {
    const patch = updateSpaceSchema.parse(request.body);
    const who = await asker(request);
    const space = await findSpace(db, who, params(request).id);
    if (!space.canManage) throw forbidden();
    const { archived: archive, ...changes } = patch;
    const isArchived = space.archivedAt !== null;
    if (isArchived && (archive !== false || Object.keys(changes).length > 0)) throw spaceArchived();
    // Default spaces are an Admin setting (Settings and members), and so is unarchiving (SB-09).
    if ((patch.isDefault !== undefined || isArchived) && !who.isAdmin) throw forbidden();
    await db.transaction((tx) => updateSpace(tx, space.id, patch, who.viewer.userId));
    return findSpace(db, who, space.id);
  });

  app.delete('/api/spaces/:id', members, async (request, reply) => {
    const who = await asker(request);
    const space = await findSpace(db, who, params(request).id);
    if (!space.canManage) throw forbidden();
    await trashSpace(db, space.id, who.viewer.userId);
    return reply.code(204).send();
  });

  app.get('/api/spaces/:id/members', members, async (request) => {
    const who = await asker(request);
    const space = await findSpace(db, who, params(request).id);
    if (!who.isAdmin && space.myRole === null) throw forbidden();
    return { members: await listSpaceMembers(db, space.id) };
  });

  app.post('/api/spaces/:id/members', members, async (request) => {
    const { members: added, role } = addSpaceMembersSchema.parse(request.body);
    const { who, space } = await managed(request);
    const target = { id: space.id, workspaceId: who.workspaceId };
    await db.transaction((tx) => addSpaceMembers(tx, target, added, role, who.viewer.userId));
    return { members: await listSpaceMembers(db, space.id) };
  });

  app.patch('/api/spaces/:id/members/:memberId', members, async (request) => {
    const { role } = updateSpaceMemberSchema.parse(request.body);
    const { space } = await managed(request);
    const memberId = params(request).memberId;
    await db.transaction((tx) => setSpaceMemberRole(tx, space.id, memberId, role));
    return { members: await listSpaceMembers(db, space.id) };
  });

  app.delete('/api/spaces/:id/members/:memberId', members, async (request, reply) => {
    const who = await asker(request);
    const space = await findSpace(db, who, params(request).id);
    const memberId = params(request).memberId;
    if (!space.canManage && memberId !== who.viewer.userId) throw forbidden();
    if (space.archivedAt !== null) throw spaceArchived();
    // Members leave Open and Closed spaces by themselves; owners remove people from Private ones.
    if (!space.canManage && space.kind === 'private') {
      throw conflict('Ask an owner of this space to remove you.');
    }
    await db.transaction((tx) => removeSpaceMember(tx, space.id, memberId));
    return reply.code(204).send();
  });

  app.post('/api/spaces/:id/join', members, async (request) => {
    const who = await asker(request);
    const space = await findSpace(db, who, params(request).id);
    if (space.myRole === null) {
      if (space.kind !== 'open' || space.archivedAt !== null) {
        throw conflict("Joining this space needs an owner's OK. Ask one of its owners to add you.");
      }
      await joinSpace(db, space.id, who.viewer.userId);
    }
    return findSpace(db, who, space.id);
  });
}
