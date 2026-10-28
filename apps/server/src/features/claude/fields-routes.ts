import {
  claudeFieldFillRequestSchema,
  claudeFieldPlanRequestSchema,
  claudeFieldProgressQuerySchema,
} from '@carehub/extras/claude/fields';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { httpError } from '../../core/errors';
import { registerPeriodicTask } from '../jobs';
import { claudeErrorReason, claudeHttpError } from './server/errors';
import { fillClaudeFields, planClaudeFieldFill } from './server/fields';
import { claudeFieldProgress, runClaudeFieldQueue } from './server/fields-queue';

// /api/claude/fields: Fill, its confirm and its progress for the Claude field type
// (docs/extras/claude.md, "Claude fields"). Every route needs a signed-in person; the checks are in
// server/fields.ts.

/** Fills rows in the background. Only the app that registered it last runs it (tests start many). */
export const CLAUDE_FIELDS_TASK = 'claude.fields';
const QUEUE_EVERY_MS = 10_000;
let queueApp: object | null = null;

function userIdOf(request: FastifyRequest): string {
  if (!request.user) throw httpError(401, 'signed_out');
  return request.user.id;
}

/** A refused or failed Claude request as CLAUDE_ERRORS[reason]; any other error as it is. */
async function answer<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const reason = claudeErrorReason(error);
    throw reason ? claudeHttpError(reason) : error;
  }
}

const claudeFieldRoutes: FastifyPluginAsync = async (app) => {
  queueApp = app;
  app.addHook('onClose', async () => {
    if (queueApp === app) queueApp = null;
  });
  registerPeriodicTask(CLAUDE_FIELDS_TASK, QUEUE_EVERY_MS, async ({ signal }) => {
    if (queueApp === app) await runClaudeFieldQueue(app.db, { signal });
  });

  // How many rows a Fill would fill: "Fill 240 rows? This uses 240 of this month's 3,000 requests."
  app.post('/plan', async (request) => {
    const userId = userIdOf(request);
    const input = claudeFieldPlanRequestSchema.parse(request.body);
    return answer(() => planClaudeFieldFill(app.db, { userId, ...input }));
  });

  app.post('/fill', async (request) => {
    const userId = userIdOf(request);
    const input = claudeFieldFillRequestSchema.parse(request.body);
    return answer(() => fillClaudeFields(app.db, { userId, ...input }));
  });

  // How many of the person's own rows are still waiting, for the progress in the header.
  app.get('/progress', async (request) => {
    const userId = userIdOf(request);
    const input = claudeFieldProgressQuerySchema.parse(request.query);
    return claudeFieldProgress(app.db, { userId, ...input });
  });
};

export default claudeFieldRoutes;
