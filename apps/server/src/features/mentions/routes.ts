// /api/mentions: people mentioned in page text (the editor sends each one) and the can-open check
// for the @ menu. It also turns `<@userId>` in new and edited comments into mentions, and runs the
// `mentions.send` job that sends the notices.
import {
  canOpenQuerySchema,
  createMentionSchema,
  type CreateMentionResponse,
} from '@carehub/shared';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { httpError } from '../../core/errors';
import { registerJobHandler } from '../jobs';
import type { MentionCreatedEvent } from './events';
import type { Mention } from './schema';
import {
  cancelMention,
  mentionInComment,
  mentionInPage,
  SEND_JOB,
  sendMention,
  toMentionView,
  whoCanOpen,
  type SendPayload,
} from './service';

const idParams = z.object({ id: z.string() });

function userIdOf(request: FastifyRequest): string {
  if (!request.user) throw httpError(401, 'signed_out');
  return request.user.id;
}

const mentionsRoutes: FastifyPluginAsync = async (app) => {
  // Retries for about two hours: sendNotice fails while notices aren't running.
  registerJobHandler<SendPayload>(SEND_JOB, (payload) => sendMention(app.db, payload), {
    maxAttempts: 8,
  });
  const announce = (created: readonly Mention[]) => {
    for (const mention of created) {
      const event: MentionCreatedEvent = {
        mentionId: mention.id,
        workspaceId: mention.workspaceId,
        pageId: mention.pageId,
        userId: mention.userId,
        by: mention.mentionedBy,
        blockId: mention.blockId,
        commentId: mention.commentId,
        status: mention.status,
      };
      app.events.emit('mention.created', event);
    }
  };
  const fromComment = async ({ commentId }: { commentId: string }) =>
    announce(await mentionInComment(app.db, commentId));
  const stop = [
    app.events.on('comment.created', fromComment),
    app.events.on('comment.edited', fromComment),
  ];
  app.addHook('onClose', async () => {
    for (const off of stop) off();
  });

  app.get('/can-open', async (request) => {
    const { pageId, userIds } = canOpenQuerySchema.parse(request.query);
    return whoCanOpen(app.db, userIdOf(request), pageId, userIds);
  });

  app.post('/', async (request, reply) => {
    const input = createMentionSchema.parse(request.body);
    const { mention, created } = await mentionInPage(app.db, userIdOf(request), input);
    if (created) announce([mention]);
    const body: CreateMentionResponse = { mention: toMentionView(mention) };
    return reply.code(created ? 201 : 200).send(body);
  });

  app.delete('/:id', async (request, reply) => {
    const { id } = idParams.parse(request.params);
    await cancelMention(app.db, userIdOf(request), id);
    return reply.code(204).send();
  });
};

export default mentionsRoutes;
