// The databases automations plugin at /api/databases (decision 0200): button presses, Undo and
// run logs. Date reminders and repeating templates join it here.
import type { FastifyInstance } from 'fastify';
import { buttonRoutes } from './buttons-routes';

export default async function automationRoutes(app: FastifyInstance) {
  await buttonRoutes(app);
}
