// /api/home: the signed-in person's own Home settings (Home and reminders spec, section 4). The
// routes take no person from the request, so no one can read or change someone else's (HR-06).
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { httpError } from '../../core/errors';
import { publishToUsers } from '../live';
import { changeHomeSettings, readHomeSettings } from './store';
import { HOME_SETTINGS_CHANGED, homeSettingsChangeSchema, type HomeSettings } from './types';

function userIdOf(request: FastifyRequest): string {
  if (!request.user) throw httpError(401, 'signed_out');
  return request.user.id;
}

const homeRoutes: FastifyPluginAsync = async (app) => {
  app.get('/settings', async (request): Promise<{ settings: HomeSettings }> => ({
    settings: await readHomeSettings(app.db, userIdOf(request)),
  }));

  app.patch('/settings', async (request): Promise<{ settings: HomeSettings }> => {
    const userId = userIdOf(request);
    const change = homeSettingsChangeSchema.parse(request.body);
    const settings = await changeHomeSettings(app.db, userId, change);
    publishToUsers([userId], { type: HOME_SETTINGS_CHANGED });
    return { settings };
  });
};

export default homeRoutes;
