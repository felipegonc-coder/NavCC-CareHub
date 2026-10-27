// The databases automations plugin at /api/databases (decision 0200): button presses, Undo and
// run logs, and date reminders. Repeating templates join it here.
import type { FastifyInstance } from 'fastify';
import { buttonRoutes } from './buttons-routes';
import { registerReminders } from './reminders-task';

export default async function automationRoutes(app: FastifyInstance) {
  await buttonRoutes(app);
  registerReminders(app);
}
