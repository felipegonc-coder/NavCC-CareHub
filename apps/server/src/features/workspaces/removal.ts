import { and, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { emitSessionsEnded } from '../auth/events';
import { deleteUserSessions } from '../auth/sessions';
import type { MemberRemovedEvent } from './events';
import { getDefaultWorkspace } from './members';
import { workspaceMembers } from './schema';

/**
 * Takes the person out of the current workspace (a member or a guest; addMember brings them back).
 * Care Hub has one workspace, so all their sessions end with it. After the commit, `session.ended`
 * goes out for each session and then `member.removed`: live updates close their open streams and push
 * forgets their browsers. False when they weren't in the workspace.
 */
export async function removeMember(app: FastifyInstance, userId: string): Promise<boolean> {
  const removed = await app.db.transaction(async (tx) => {
    const workspace = await getDefaultWorkspace(tx);
    if (!workspace) return null;
    const [row] = await tx
      .update(workspaceMembers)
      .set({ removedAt: sql`now()`, updatedAt: sql`now()` })
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspace.id),
          eq(workspaceMembers.userId, userId),
          isNull(workspaceMembers.removedAt),
        ),
      )
      .returning({ workspaceId: workspaceMembers.workspaceId });
    if (!row) return null;
    const event: MemberRemovedEvent = { workspaceId: row.workspaceId, userId };
    return { event, ended: await deleteUserSessions(tx, userId) };
  });
  if (!removed) return false;
  emitSessionsEnded(app, removed.ended);
  app.events.emit('member.removed', removed.event);
  return true;
}
