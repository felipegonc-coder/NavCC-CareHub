// Stand-ins for core pieces that aren't on main yet (0007). Each goes when its piece lands.
import type { FastifyRequest } from 'fastify';
import { httpError } from '../../core/errors';
import type { NotesPages, Viewer } from './types';

/**
 * Pages and page content: `createPage`, `getPageAccess`, `getPrivateSpaceId` and `grantAccess`
 * from features/pages, `setPageContentFromMarkdown` from features/collab. Null until they're on
 * main, so Take meeting notes answers 409 and makes nothing.
 */
export const corePages: NotesPages | null = null;

type CoreRequest = {
  user?: { id: string } | null;
  member?: { workspaceId: string; roleId: string | null; permissions: ReadonlySet<string> } | null;
};

/**
 * The member, from core's `request.user` and `request.member` (0007, section 3.1): 403 for guests
 * and people outside the workspace, so for everyone until core sets `request.member`.
 */
export function viewerOf(request: FastifyRequest): Viewer {
  const { user, member } = request as unknown as CoreRequest;
  if (!user) throw httpError(401, 'signed_out');
  if (!member || member.roleId === null) throw httpError(403, 'forbidden');
  const canCreatePages = member.permissions.has('pages.create');
  return { userId: user.id, workspaceId: member.workspaceId, canCreatePages };
}
