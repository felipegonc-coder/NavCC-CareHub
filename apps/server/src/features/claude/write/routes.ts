// Writing help (Claude features spec, section 3.2; checks CL-06 to CL-08), under /api/claude:
//   POST /write          asks Claude for one action and answers { text } (Markdown)
//   POST /write/applied  after Replace or Insert below, for page history ("with Claude")
// Both need a member with Use Claude and Can edit on the page, checked on every request. Claude's
// answer only goes back to the person; it reaches the page through the editor, like typing.
import {
  writeAppliedSchema,
  writeRequestSchema,
  writeTooLong,
  type WriteResponse,
} from '@carehub/extras/claude/write';
import { atLeast } from '@carehub/shared';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { httpError } from '../../../core/errors';
import type { Db } from '../../../db';
import { getPageText } from '../../collab';
import { memberOf, pageFor } from './access';
import { askClaude, claudeErrorReason, claudeHttpError, isClaudeFeatureOn } from './claude';
import type { ClaudeWriteAppliedEvent } from './events';
import { cleanAnswer, writePromptFor } from './prompt';

const FEATURE = 'writing_help';

/** The person, their workspace and the page, or the refusal: 403 without Use Claude or Can edit. */
async function editorOf(db: Db, request: FastifyRequest, pageId: string) {
  const userId = request.user?.id;
  if (!userId) throw httpError(401, 'signed_out');
  const member = memberOf(request);
  if (!member?.canUseClaude) throw claudeHttpError('no_permission');
  const page = await pageFor(db, userId, pageId);
  if (!page || page.workspaceId !== member.workspaceId) throw httpError(404, 'not_found');
  if (!atLeast(page.level, 'edit')) throw claudeHttpError('no_permission');
  return { userId, workspaceId: member.workspaceId, page };
}

const writeRoutes: FastifyPluginAsync = async (app) => {
  app.post('/write', async (request) => {
    const input = writeRequestSchema.parse(request.body);
    const { userId, workspaceId, page } = await editorOf(app.db, request, input.pageId);
    if (writeTooLong(input)) throw claudeHttpError('too_long');
    // Draft sends no page text, so it isn't read.
    const text = input.action === 'draft' ? '' : await getPageText(app.db, input.pageId);
    if (input.action === 'summarize' && !input.selection.trim() && !text.trim()) {
      throw httpError(400, 'invalid', "There's nothing on this page to summarize yet.");
    }
    const prompt = writePromptFor(input, { title: page.title, text });
    let answer: string;
    try {
      ({ text: answer } = await askClaude(app.db, {
        workspaceId,
        userId,
        feature: FEATURE,
        ...prompt,
      }));
    } catch (error) {
      const reason = claudeErrorReason(error);
      if (reason) throw claudeHttpError(reason);
      throw error;
    }
    // Switched off while Claude was writing (CL-05): the answer is dropped.
    if (!(await isClaudeFeatureOn(app.db, workspaceId, FEATURE))) {
      throw claudeHttpError('switched_off');
    }
    const cleaned = cleanAnswer(answer);
    if (!cleaned) throw claudeHttpError('bad_output');
    const body: WriteResponse = { text: cleaned };
    return body;
  });

  app.post('/write/applied', async (request, reply) => {
    const { pageId, action, placement } = writeAppliedSchema.parse(request.body);
    const { userId, workspaceId } = await editorOf(app.db, request, pageId);
    const event: ClaudeWriteAppliedEvent = { workspaceId, pageId, by: userId, action, placement };
    app.events.emit('claude.write.applied', event);
    return reply.code(204).send();
  });
};

export default writeRoutes;
