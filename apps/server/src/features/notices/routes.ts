// The 🔔 Care Hub chat API, under /api/notices (Messages spec MS-09, MS-10). There's no route that
// adds a notice: features call sendNotice on the server.
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { httpError } from '../../core/errors';
import { publishToUsers } from '../live';
import { getCurrentMember } from '../workspaces';
import { lookUpCards } from './cards';
import { getNoticeActionHandler, resolveButtonClick } from './domain/actions';
import { NOTICE_FILTERS } from './domain/filters';
import { isNoticeOwner, toNoticeView } from './domain/view';
import './events';
import {
  bindNoticesRuntime,
  noticesChanged,
  type NoticeScope,
  type NoticesRuntime,
  type ReadTarget,
} from './service';
import { createNoticeStore } from './store';
import type { NoticeActionResponse, NoticeListResponse, NoticeUnreadResponse } from './types';

const listQuery = z.object({
  filter: z.enum(NOTICE_FILTERS).default('all'),
  /** A `nextCursor` from the previous page. */
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const noticeParams = z.object({ id: z.guid() });
const readBody = z.strictObject({ through: z.number().int().min(0) });
const clickBody = z.strictObject({
  button: z.number().int().min(0),
  choice: z.number().int().min(0).optional(),
});

/** The signed-in person's own chat in the current workspace: the only one they can see. */
function chatOf(request: FastifyRequest): NoticeScope {
  const { user, member } = request;
  if (!user || !member) throw httpError(403, 'forbidden');
  return { workspaceId: member.workspaceId, userId: user.id };
}

const noticesRoutes: FastifyPluginAsync = async (app) => {
  const runtime: NoticesRuntime = {
    store: createNoticeStore(app.db),
    emit: (name, payload) => app.events.emit(name, payload),
    publish: publishToUsers,
    isMember: async (workspaceId, userId) =>
      (await getCurrentMember(app.db, userId))?.workspaceId === workspaceId,
    onError: (err) => app.log.error({ err }, 'A notice follow-up failed.'),
  };
  const unbind = bindNoticesRuntime(runtime);
  app.addHook('onClose', async () => unbind());

  const { store } = runtime;
  // Guests have a chat too, for what's shared with them.
  const guard = { config: { allowGuests: true }, preHandler: app.requireMember };
  const logCardError = (err: unknown) => app.log.error({ err }, 'Notice cards failed to load.');

  const markRead = async (chat: NoticeScope, target: ReadTarget) => {
    const changed = await store.markRead(chat, target, new Date());
    if (changed > 0) noticesChanged(runtime, chat.userId);
    return { unread: await store.countUnread(chat) } satisfies NoticeUnreadResponse;
  };

  /** The reader's own notice: 404 when it doesn't exist, 403 when it's anyone else's. */
  const ownNotice = async (request: FastifyRequest) => {
    const chat = chatOf(request);
    const { id } = noticeParams.parse(request.params);
    const notice = await store.get(id);
    if (!notice) throw httpError(404, 'not_found');
    // Admins included: nobody reads another person's notices (RP-D1).
    if (!isNoticeOwner(notice, chat)) throw httpError(403, 'forbidden');
    return { chat, notice };
  };

  app.get('/', guard, async (request): Promise<NoticeListResponse> => {
    const chat = chatOf(request);
    const { filter, before, limit } = listQuery.parse(request.query);
    const records = await store.list(chat, { limit: limit + 1, before, filter });
    const page = records.slice(0, limit);
    const lookups = await lookUpCards(app.db, chat, page, logCardError);
    return {
      notices: page.map((record) => toNoticeView(record, lookups)),
      nextCursor: records.length > limit ? (page.at(-1)?.position ?? null) : null,
      unread: await store.countUnread(chat),
    };
  });

  app.get('/unread', guard, async (request): Promise<NoticeUnreadResponse> => ({
    unread: await store.countUnread(chatOf(request)),
  }));

  /** "Read up to here": the newest notice the chat has shown. */
  app.post('/read', guard, async (request) =>
    markRead(chatOf(request), readBody.parse(request.body)),
  );

  app.post('/read-all', guard, async (request) => markRead(chatOf(request), { all: true }));

  app.post('/:id/read', guard, async (request) => {
    const { chat, notice } = await ownNotice(request);
    return markRead(chat, { noticeIds: [notice.id] });
  });

  /** Runs an action button's handler, with the action and value from the stored notice. */
  app.post('/:id/actions', guard, async (request): Promise<NoticeActionResponse> => {
    const { chat, notice } = await ownNotice(request);
    const click = resolveButtonClick(notice.buttons, clickBody.parse(request.body));
    const handler = click && getNoticeActionHandler(click.action);
    if (!click || !handler) throw httpError(400, 'invalid', "This button doesn't do anything.");
    const result = await handler({ ...click, noticeId: notice.id, ...chat });
    const { unread } = await markRead(chat, { noticeIds: [notice.id] });
    return { message: result?.message ?? null, unread };
  });
};

export default noticesRoutes;
