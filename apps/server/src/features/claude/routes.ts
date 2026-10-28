import { claudeSettingsUpdateSchema } from '@carehub/extras/claude/settings';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { httpError } from '../../core/errors';
import claudeFieldRoutes from './fields-routes';
import { claudeSettingsView, claudeStatusFor, updateClaudeSettings } from './server/admin';
import { claudeMemberOf } from './server/members';
import { configureClaude } from './server/runtime';

// /api/claude: Claude features, all switched off by default.
// See docs/extras/claude.md (decision 0400). Every route needs a signed-in person.

function userIdOf(request: FastifyRequest): string {
  if (!request.user) throw httpError(401, 'signed_out');
  return request.user.id;
}

const claudeRoutes: FastifyPluginAsync = async (app) => {
  // The client's failures go to the app's log: a status and an error type, nothing else.
  configureClaude({ log: { warn: (details, message) => app.log.warn(details, message) } });

  /** The workspace an Admin is changing; 403 for anyone without workspace.admin. */
  async function adminWorkspaceOf(request: FastifyRequest): Promise<string> {
    const member = await claudeMemberOf(app.db, userIdOf(request));
    if (!member?.isAdmin) throw httpError(403, 'forbidden');
    return member.workspaceId;
  }

  // Which features the person can use now. The web app asks every 5 seconds and hides the rest.
  app.get('/status', async (request) => claudeStatusFor(app.db, userIdOf(request)));

  app.get('/settings', async (request) =>
    claudeSettingsView(app.db, await adminWorkspaceOf(request)),
  );

  await app.register(claudeFieldRoutes, { prefix: '/fields' });

  app.put('/settings', async (request) => {
    const workspaceId = await adminWorkspaceOf(request);
    const update = claudeSettingsUpdateSchema.parse(request.body);
    return updateClaudeSettings(app.db, {
      workspaceId,
      userId: userIdOf(request),
      update,
      log: request.log,
    });
  });
};

export default claudeRoutes;
