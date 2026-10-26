// Workspace people and spaces. Access rules: docs/decisions/0005-spaces-and-page-access.md.
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import {
  createSpaceSchema,
  setSpaceMembersSchema,
  updateSpaceSchema,
  type MemberSummary,
  type Space,
  type SpaceMember,
} from '@carehub/shared';
import { getSpace, listSpaces, type SpaceWithAccess } from '../pages/access';
import {
  actorOf,
  badRequest,
  first,
  forbidden,
  idParam,
  notFound,
  parse,
  uuidArray,
  type Actor,
  type Executor,
} from '../pages/common';
import { positionAt } from '../pages/position';
import { spaceMembers, spaces } from './schema';

const toSpace = ({ space, access }: SpaceWithAccess): Space => ({
  id: space.id,
  name: space.name,
  icon: space.icon,
  kind: space.kind,
  visibility: space.visibility,
  position: space.position,
  access,
});

/** Each person's private space is made the first time it's needed. */
const ensurePrivateSpace = (db: Executor, { userId, workspaceId }: Actor) =>
  db.execute(sql`
    INSERT INTO spaces (workspace_id, name, kind, owner_id, position)
    VALUES (${workspaceId}, 'Private', 'private', ${userId}, ${positionAt([])})
    ON CONFLICT (workspace_id, owner_id) WHERE kind = 'private' DO NOTHING`);

async function teamSpacePositions(db: Executor, workspaceId: string, exceptId?: string) {
  const rows = await db
    .select({ position: spaces.position })
    .from(spaces)
    .where(
      and(
        eq(spaces.workspaceId, workspaceId),
        eq(spaces.kind, 'team'),
        exceptId ? ne(spaces.id, exceptId) : undefined,
      ),
    )
    .orderBy(asc(spaces.position), asc(spaces.id));
  return rows.map((row) => row.position);
}

async function checkWorkspaceMembers(db: Executor, workspaceId: string, userIds: string[]) {
  if (userIds.length === 0) return;
  const { rows } = await db.execute<{ count: number }>(sql`
    SELECT count(*)::int AS count FROM workspace_members
    WHERE workspace_id = ${workspaceId} AND user_id = ANY(${uuidArray(userIds)})`);
  if (rows[0]?.count !== userIds.length) {
    throw badRequest('Everyone listed must be in the workspace.');
  }
}

async function memberList(db: Executor, spaceId: string) {
  const { rows } = await db.execute<SpaceMember>(sql`
    SELECT sm.user_id AS "userId", u.name, u.avatar_url AS avatar, sm.role
    FROM space_members sm JOIN users u ON u.id = sm.user_id
    WHERE sm.space_id = ${spaceId}
    ORDER BY lower(u.name), u.id`);
  return rows;
}

async function visibleSpace(db: Executor, actor: Actor, spaceId: string) {
  const found = await getSpace(db, actor.userId, spaceId);
  if (!found) throw notFound('Space not found.');
  return found;
}

async function manageableSpace(db: Executor, actor: Actor, spaceId: string) {
  const found = await visibleSpace(db, actor, spaceId);
  if (!found.access.canManage) throw forbidden();
  return found.space;
}

const workspacesFeature: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireUser);
  const { db } = app;

  app.get('/workspace/members', async (request) => {
    const { rows } = await db.execute<MemberSummary>(sql`
      SELECT u.id, u.name, u.avatar_url AS avatar, m.role
      FROM workspace_members m JOIN users u ON u.id = m.user_id
      WHERE m.workspace_id = ${actorOf(request).workspaceId}
      ORDER BY lower(u.name), u.id`);
    return { members: rows };
  });

  app.get('/spaces', async (request) => {
    const actor = actorOf(request);
    await ensurePrivateSpace(db, actor);
    return { spaces: (await listSpaces(db, actor.userId, actor.workspaceId)).map(toSpace) };
  });

  app.post('/spaces', { preHandler: app.requireAdmin }, async (request, reply) => {
    const actor = actorOf(request);
    const input = parse(createSpaceSchema, request.body);
    const members = input.members ?? [];
    const spaceId = await db.transaction(async (tx) => {
      await checkWorkspaceMembers(
        tx,
        actor.workspaceId,
        members.map((m) => m.userId),
      );
      const { id } = first(
        await tx
          .insert(spaces)
          .values({
            workspaceId: actor.workspaceId,
            name: input.name,
            icon: input.icon ?? null,
            kind: 'team',
            visibility: input.visibility,
            position: positionAt(await teamSpacePositions(tx, actor.workspaceId)),
          })
          .returning({ id: spaces.id }),
      );
      if (members.length > 0) {
        await tx.insert(spaceMembers).values(members.map((m) => ({ spaceId: id, ...m })));
      }
      return id;
    });
    reply.code(201);
    return { space: toSpace(await visibleSpace(db, actor, spaceId)) };
  });

  app.patch('/spaces/:id', async (request) => {
    const actor = actorOf(request);
    const space = await manageableSpace(db, actor, idParam(request, 'Space'));
    const input = parse(updateSpaceSchema, request.body);
    if (space.kind === 'private' && (input.visibility ?? input.position) !== undefined) {
      throw badRequest('A private space can only be renamed or given an icon.');
    }
    const position =
      input.position === undefined
        ? undefined
        : positionAt(await teamSpacePositions(db, space.workspaceId, space.id), input.position);
    await db
      .update(spaces)
      .set({ ...input, position, updatedAt: new Date() })
      .where(eq(spaces.id, space.id));
    return { space: toSpace(await visibleSpace(db, actor, space.id)) };
  });

  app.delete('/spaces/:id', async (request, reply) => {
    const space = await manageableSpace(db, actorOf(request), idParam(request, 'Space'));
    if (space.kind === 'private') throw badRequest("A private space can't be deleted.");
    await db.delete(spaces).where(eq(spaces.id, space.id));
    return reply.code(204).send();
  });

  app.get('/spaces/:id/members', async (request) => {
    const { space } = await visibleSpace(db, actorOf(request), idParam(request, 'Space'));
    return { members: await memberList(db, space.id) };
  });

  app.put('/spaces/:id/members', async (request) => {
    const space = await manageableSpace(db, actorOf(request), idParam(request, 'Space'));
    if (space.kind === 'private') throw badRequest("A private space can't be shared.");
    const { members } = parse(setSpaceMembersSchema, request.body);
    await db.transaction(async (tx) => {
      await checkWorkspaceMembers(
        tx,
        space.workspaceId,
        members.map((m) => m.userId),
      );
      await tx.delete(spaceMembers).where(eq(spaceMembers.spaceId, space.id));
      if (members.length > 0) {
        await tx.insert(spaceMembers).values(members.map((m) => ({ spaceId: space.id, ...m })));
      }
    });
    return { members: await memberList(db, space.id) };
  });
};

export default workspacesFeature;
