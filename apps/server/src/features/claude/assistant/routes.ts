// The assistant panel's chats (Claude features spec, section 3.3; checks CL-09 to CL-12), under
// /api/claude:
//   GET    /assistant/chats          the person's own chats, last used first
//   GET    /assistant/chats/:chatId  one of them, with its messages
//   PATCH  /assistant/chats/:chatId  { title }: Rename
//   DELETE /assistant/chats/:chatId  Delete, for good
//   POST   /assistant/ask            one question, answered and saved with its sources
// Every route needs a member with Use Claude, checked on every request. Chats are private: someone
// else's chat is 403, for Admins too. Chats past the days an Admin chose in Settings → Claude go
// before each request's answer, and every hour in every workspace (CL-D3).
import {
  askRequestSchema,
  chatIdParamsSchema,
  renameChatSchema,
  type ChatListResponse,
  type ChatResponse,
} from '@carehub/extras/claude/assistant';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { httpError } from '../../../core/errors';
import { registerPeriodicTask } from '../../jobs';
import { claudeHttpError } from '../index';
import { claudeMemberOf } from '../server/members';
import { claudeRuntime } from '../server/runtime';
import { answerQuestion } from './ask';
import {
  CHAT_RETENTION_TASK,
  chatMessageViews,
  chatView,
  deleteChat,
  listChats,
  ownChat,
  removeAllExpiredChats,
  removeExpiredChats,
  renameChat,
} from './chats';
import type { Asker } from './pages';

const HOUR_MS = 60 * 60 * 1000;

/** Stop closes the request: true once it closed before the answer was sent. */
function stoppedWaiting(reply: FastifyReply): () => boolean {
  let closed = false;
  reply.raw.once('close', () => {
    closed = true;
  });
  return () => closed && !reply.raw.writableFinished;
}

const assistantRoutes: FastifyPluginAsync = async (app) => {
  registerPeriodicTask(CHAT_RETENTION_TASK, HOUR_MS, async ({ signal }) => {
    await removeAllExpiredChats(app.db, claudeRuntime().now(), signal);
  });

  /** The person and their workspace, or the refusal: 403 without membership or Use Claude. */
  async function askerOf(request: FastifyRequest): Promise<Asker> {
    const userId = request.user?.id;
    if (!userId) throw httpError(401, 'signed_out');
    const member = await claudeMemberOf(app.db, userId);
    const { access, now } = claudeRuntime();
    if (!member || !(await access.canUseClaude(app.db, member.workspaceId, userId))) {
      throw claudeHttpError('no_permission');
    }
    await removeExpiredChats(app.db, member.workspaceId, now());
    return { workspaceId: member.workspaceId, userId };
  }

  app.get('/assistant/chats', async (request) => {
    const asker = await askerOf(request);
    const body: ChatListResponse = { chats: (await listChats(app.db, asker)).map(chatView) };
    return body;
  });

  app.get('/assistant/chats/:chatId', async (request) => {
    const asker = await askerOf(request);
    const { chatId } = chatIdParamsSchema.parse(request.params);
    const chat = await ownChat(app.db, asker, chatId);
    const body: ChatResponse = {
      chat: chatView(chat),
      messages: await chatMessageViews(app.db, asker, chatId),
    };
    return body;
  });

  app.patch('/assistant/chats/:chatId', async (request) => {
    const asker = await askerOf(request);
    const { chatId } = chatIdParamsSchema.parse(request.params);
    const { title } = renameChatSchema.parse(request.body);
    await ownChat(app.db, asker, chatId);
    return { chat: chatView(await renameChat(app.db, chatId, title)) };
  });

  app.delete('/assistant/chats/:chatId', async (request, reply) => {
    const asker = await askerOf(request);
    const { chatId } = chatIdParamsSchema.parse(request.params);
    await ownChat(app.db, asker, chatId);
    await deleteChat(app.db, chatId);
    return reply.code(204).send();
  });

  app.post('/assistant/ask', async (request, reply) => {
    const asker = await askerOf(request);
    const input = askRequestSchema.parse(request.body);
    const answered = await answerQuestion(app.db, asker, input, stoppedWaiting(reply));
    // Stopped: the person isn't waiting any more, and nothing was kept.
    if (!answered) return reply.code(204).send();
    return answered;
  });
};

export default assistantRoutes;
