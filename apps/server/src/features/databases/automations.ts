// The databases automations plugin at /api/databases (decision 0200): button presses, Undo and
// run logs, date reminders, applying a template to a row, and repeating templates.
import type { FastifyInstance } from 'fastify';
import { buttonRoutes } from './buttons-routes';
import { registerReminders } from './reminders-task';
import { registerRepeats } from './repeat-task';
import { templateRoutes } from './templates-apply';

export default async function automationRoutes(app: FastifyInstance) {
  await buttonRoutes(app);
  registerReminders(app);
  await templateRoutes(app);
  registerRepeats(app);
}
