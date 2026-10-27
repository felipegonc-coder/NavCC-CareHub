// Read markers, mute and group changes: rename, add people, leave and remove (Messages spec).
import {
  addPeopleBodySchema,
  changeChatBodySchema,
  membersKey,
  planAddPeople,
  planLeave,
  planRemovePerson,
  planRename,
  readBodySchema,
  type ChatResponse,
  type ReadResponse,
  type UnreadCounts,
} from '@carehub/team-chat';
import type { FastifyInstance } from 'fastify';
import { httpError } from '../../core/errors';
import * as changes from './changes';
import { canBeMessaged } from './people';
import {
  CANT_BE_MESSAGED,
  chatAccess,
  chatChangeError,
  chatParams,
  current,
  memberParams,
  nudge,
  viewerOf,
  type Viewer,
} from './requests';
import { countUnread } from './store';

/** Adds these routes to the Messages plugin, after its member check (routes.ts). */
export function addGroupRoutes(app: FastifyInstance): void {
  const { openChat, chatAnswer } = chatAccess(app.db);

  /** What's unread in one chat for the viewer. */
  async function unreadIn(viewer: Viewer, chatId: string): Promise<UnreadCounts> {
    const counts = await countUnread(app.db, viewer.workspaceId, viewer.userId, [chatId]);
    const { unread, mentions } = counts.get(chatId) ?? { unread: 0, mentions: 0 };
    return { unread, mentions };
  }

  // Read up to the newest message on screen (MS-11). The marker only moves forward, up to the
  // chat's latest message.
  app.post('/chats/:chatId/read', async (request): Promise<ReadResponse> => {
    const viewer = viewerOf(request);
    const { chatId } = chatParams.parse(request.params);
    const { seq } = readBodySchema.parse(request.body);
    const { chat } = await openChat(viewer, chatId);
    const lastReadSeq = await changes.markRead(
      app.db,
      chat.id,
      viewer.userId,
      Math.min(seq, chat.lastSeq),
    );
    if (lastReadSeq === null) throw httpError(403, 'forbidden');
    nudge([viewer.userId], chat.id);
    return { lastReadSeq, ...(await unreadIn(viewer, chat.id)) };
  });

  // Mark as unread: back to just before the newest message from someone else.
  app.post('/chats/:chatId/unread', async (request): Promise<ReadResponse> => {
    const viewer = viewerOf(request);
    const { chatId } = chatParams.parse(request.params);
    const { chat, members, can } = await openChat(viewer, chatId);
    if (!can.mute) throw httpError(403, 'forbidden');
    const marked = await changes.markUnread(app.db, chat.id, viewer.userId);
    const before = members.find((row) => row.userId === viewer.userId)?.lastReadSeq ?? 0;
    if (marked !== null) nudge([viewer.userId], chat.id);
    return { lastReadSeq: marked ?? before, ...(await unreadIn(viewer, chat.id)) };
  });

  // Mute (for yourself) or rename a group (for everyone, with a "renamed" line).
  app.patch('/chats/:chatId', async (request): Promise<ChatResponse> => {
    const viewer = viewerOf(request);
    const { chatId } = chatParams.parse(request.params);
    const body = changeChatBodySchema.parse(request.body);
    const { chat, can } = await openChat(viewer, chatId);
    if (body.muted !== undefined && !can.mute) throw httpError(403, 'forbidden');
    let told = [viewer.userId];
    if (body.name !== undefined) {
      const renamed = await changes.changeChat(app.db, chat.id, async (tx, locked, members) => {
        const plan = planRename(
          { chatType: locked.type, members, actorId: viewer.userId, currentName: locked.name },
          body.name ?? null,
        );
        if (!plan.ok) {
          const error = chatChangeError(plan.error);
          if (error) throw error;
          return null;
        }
        await changes.addSystemLines(tx, locked, [plan.event]);
        await changes.updateGroup(tx, locked.id, { name: plan.name });
        return current(members);
      });
      told = renamed ?? told;
    }
    if (body.muted !== undefined) {
      await changes.setMuted(app.db, chat.id, viewer.userId, body.muted);
    }
    nudge(told, chat.id);
    const after = await openChat(viewer, chat.id);
    return chatAnswer(viewer, after.chat, after.members);
  });

  // Anyone in a group adds people (up to 50). They can read its earlier messages.
  app.post('/chats/:chatId/members', async (request): Promise<ChatResponse> => {
    const viewer = viewerOf(request);
    const { chatId } = chatParams.parse(request.params);
    const { userIds } = addPeopleBodySchema.parse(request.body);
    const { chat } = await openChat(viewer, chatId);
    const told = await changes.changeChat(app.db, chat.id, async (tx, locked, members) => {
      const plan = planAddPeople(
        { chatType: locked.type, members, actorId: viewer.userId },
        userIds,
      );
      if (!plan.ok) {
        const error = chatChangeError(plan.error);
        if (error) throw error;
        return null;
      }
      if (!(await canBeMessaged(tx, viewer.workspaceId, plan.addIds))) {
        throw httpError(400, 'invalid', CANT_BE_MESSAGED);
      }
      const seq = await changes.addSystemLines(tx, locked, [plan.event]);
      await changes.addMembers(tx, locked.id, plan.addIds, seq);
      const memberIds = [...current(members), ...plan.addIds];
      await changes.updateGroup(tx, locked.id, { membersKey: membersKey(memberIds) });
      return memberIds;
    });
    if (told) nudge(told, chat.id);
    const after = await openChat(viewer, chat.id);
    return chatAnswer(viewer, after.chat, after.members);
  });

  // Leave (yourself: 204) or remove someone (the starter, or whoever took over: the chat). When
  // the starter leaves, the longest-standing member takes over.
  app.delete('/chats/:chatId/members/:userId', async (request, reply) => {
    const viewer = viewerOf(request);
    const { chatId, userId } = memberParams.parse(request.params);
    const { chat } = await openChat(viewer, chatId);
    const leaving = userId === viewer.userId;
    const told = await changes.changeChat(app.db, chat.id, async (tx, locked, members) => {
      const context = { chatType: locked.type, members, actorId: viewer.userId };
      if (leaving) {
        const plan = planLeave(context);
        if (!plan.ok) throw chatChangeError(plan.error) ?? httpError(403, 'forbidden');
        await changes.addSystemLines(tx, locked, plan.events);
        await changes.endMembership(tx, locked.id, viewer.userId);
        if (plan.newRemoverId) await changes.giveRemoveRights(tx, locked.id, plan.newRemoverId);
      } else {
        const plan = planRemovePerson(context, userId);
        if (!plan.ok) {
          const error = chatChangeError(plan.error);
          if (error) throw error;
          return null;
        }
        await changes.addSystemLines(tx, locked, [plan.event]);
        await changes.endMembership(tx, locked.id, userId);
      }
      const before = current(members);
      const after = before.filter((id) => id !== userId);
      await changes.updateGroup(tx, locked.id, { membersKey: membersKey(after) });
      return before;
    });
    if (told) nudge(told, chat.id);
    if (leaving) return reply.code(204).send();
    const after = await openChat(viewer, chat.id);
    return reply.send(await chatAnswer(viewer, after.chat, after.members));
  });
}
