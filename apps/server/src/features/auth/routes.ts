import type { MeResponse } from '@carehub/shared';
import type { FastifyPluginAsync } from 'fastify';
import { httpError } from '../../core/errors';
import { getDefaultWorkspace, memberJson } from '../workspaces';
import { sessionOf } from './cookies';
import { deleteSession } from './sessions';

/** /api/auth: the current user, and signing out. */
const authRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/me',
    { config: { allowTemporaryPassword: true } },
    async (request): Promise<MeResponse> => {
      if (!request.user) throw httpError(401, 'signed_out');
      const workspace = await getDefaultWorkspace(app.db);
      if (!workspace) throw new Error('The current workspace is missing.');
      const member = request.member && memberJson(request.member);
      return { user: request.user, member, workspace };
    },
  );

  // Public, so it always clears the cookies, even for a session that has already ended.
  app.post('/sign-out', { config: { public: true } }, async (request, reply) => {
    const session = sessionOf(request);
    if (session) await deleteSession(app.db, session.id);
    app.sessionCookies.clear(reply);
    return { ok: true };
  });
};

export default authRoutes;
