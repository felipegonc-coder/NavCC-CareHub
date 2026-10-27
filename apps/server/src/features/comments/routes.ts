// /api/comments: threads and comments on pages (decision 0007, section 4.3). Open tabs of a page
// hear `comments.changed` on the live topic `comments:<pageId>` (Can view needed).
import {
  atLeast,
  createCommentSchema,
  editCommentSchema,
  listCommentsQuerySchema,
  resolveThreadSchema,
  type CreateCommentResponse,
} from '@carehub/shared';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { httpError } from '../../core/errors';
import { publishTopic, registerTopic } from '../live';
import type { CommentCreatedEvent } from './events';
import { pageAccess } from './pages';
import {
  addComment,
  commentsForPage,
  deleteComment,
  editComment,
  setThreadResolved,
} from './service';

const TOPIC = 'comments';
const idParams = z.object({ id: z.string() });

function userIdOf(request: FastifyRequest): string {
  if (!request.user) throw httpError(401, 'signed_out');
  return request.user.id;
}

const commentsRoutes: FastifyPluginAsync = async (app) => {
  registerTopic(TOPIC, async ({ userId, topic }) => {
    const page = await pageAccess(app.db, userId, topic.slice(TOPIC.length + 1));
    return page !== null && atLeast(page.level, 'view');
  });
  const changed = (change: { pageId: string; threadId: string }) =>
    publishTopic(`${TOPIC}:${change.pageId}`, {
      type: 'comments.changed',
      data: { pageId: change.pageId, threadId: change.threadId },
    });

  app.get('/', async (request) => {
    const { pageId, status } = listCommentsQuerySchema.parse(request.query);
    return commentsForPage(app.db, userIdOf(request), pageId, status);
  });

  app.post('/', async (request, reply) => {
    const input = createCommentSchema.parse(request.body);
    const by = userIdOf(request);
    const added = await addComment(app.db, by, input);
    const { id, threadId, pageId, workspaceId, newThread } = added;
    const event: CommentCreatedEvent = {
      commentId: id,
      threadId,
      pageId,
      workspaceId,
      by,
      newThread,
    };
    app.events.emit('comment.created', event);
    changed(added);
    const body: CreateCommentResponse = { id, threadId };
    return reply.code(201).send(body);
  });

  app.patch('/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    const { text } = editCommentSchema.parse(request.body);
    const edited = await editComment(app.db, userIdOf(request), id, text);
    changed(edited);
    return { id, editedAt: edited.editedAt };
  });

  app.delete('/:id', async (request, reply) => {
    const { id } = idParams.parse(request.params);
    changed(await deleteComment(app.db, userIdOf(request), id));
    return reply.code(204).send();
  });

  app.patch('/threads/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    const { resolved } = resolveThreadSchema.parse(request.body);
    const thread = await setThreadResolved(app.db, userIdOf(request), id, resolved);
    changed({ pageId: thread.pageId, threadId: thread.id });
    const resolvedAt = thread.resolvedAt?.toISOString() ?? null;
    return { id: thread.id, resolvedAt, resolvedBy: thread.resolvedBy };
  });
};

export default commentsRoutes;
