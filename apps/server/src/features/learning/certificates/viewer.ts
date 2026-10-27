import type { FastifyRequest } from 'fastify';
import { httpError } from '../errors';

// Who is asking. A stand-in for the courses server's ../auth (B1, #111) with the same names: when
// that is on main, routes.ts and service.ts import from there and this file goes. Reads core's
// `request.user` and `request.member` (0007 section 3.1); until core sets `request.member`
// (accounts 1b), signed-in people get 403 from these routes.

/** The signed-in person, in the workspace they are using. */
export type Viewer = {
  userId: string;
  workspaceId: string;
  can(permission: 'learning.analytics'): boolean;
};

type CoreRequest = {
  user?: { id: string } | null;
  member?: { workspaceId: string; roleId: string | null; permissions: ReadonlySet<string> } | null;
};

/** 401 when signed out; 403 for someone who isn't a member of the workspace or is a guest. */
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
