import type { FastifyRequest } from 'fastify';
import { httpError } from './errors';

export type LearningPermission = 'learning.build' | 'learning.assign' | 'learning.analytics';

/** The signed-in person, in the workspace they are using. */
export type Viewer = {
  userId: string;
  workspaceId: string;
  can(permission: LearningPermission): boolean;
};

// What core's sessions put on each request (0007 section 3.1).
type CoreRequest = {
  user?: { id: string } | null;
  member?: { workspaceId: string; roleId: string | null; permissions: ReadonlySet<string> } | null;
};

/**
 * Who is asking: 401 when signed out, 403 for someone who isn't a member or is a guest (no role), as core's
 * `app.requireMember`. Reads core's `request.user` and `request.member`; until core sets `request.member`
 * (accounts 1b), signed-in people get 403 from every Learning route.
 */
export function viewerOf(request: FastifyRequest): Viewer {
  const { user, member } = request as unknown as CoreRequest;
  if (!user) throw httpError(401);
  if (!member || member.roleId === null) throw httpError(403);
  return {
    userId: user.id,
    workspaceId: member.workspaceId,
    can: (permission) => member.permissions.has(permission),
  };
}

/** A preHandler that lets in only people with the permission; becomes core's `app.requirePermission` later. */
export function requirePermission(permission: LearningPermission) {
  return async (request: FastifyRequest): Promise<void> => {
    if (!viewerOf(request).can(permission)) throw httpError(403);
  };
}
