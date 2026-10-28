import { claudeFieldFillRequestSchema } from '@carehub/extras/claude/fields';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { httpError } from '../../core/errors';
import { claudeErrorReason, claudeHttpError } from './server/errors';
import { fillClaudeFields } from './server/fields';

// /api/claude/fields: Fill for the Claude field type (docs/extras/claude.md, "Claude fields").
// Every route needs a signed-in person; the checks are in server/fields.ts.

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
  app.post('/fill', async (request) => {
    const userId = userIdOf(request);
    const input = claudeFieldFillRequestSchema.parse(request.body);
    return answer(() => fillClaudeFields(app.db, { userId, ...input }));
  });
};

export default claudeFieldRoutes;
