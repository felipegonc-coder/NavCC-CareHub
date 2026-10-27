// /api/messages: direct chats and groups (Messages spec). Only members of the workspace use it:
// guests have just their 🔔 Care Hub chat (RP-D2), which is the notices feature's. Every chat
// request checks that the person is in the chat now, admins included (RP-D1, MS-10).
import {
  addPeopleBodySchema,
  badgeCount,
  changeChatBodySchema,
  chatListQuerySchema,
  chatPermissions,
  checkChangeMessage,
  deletedMessageFields,
  editMessageBodySchema,
  historyQuerySchema,
  membersKey,
  newChatBodySchema,
  planAddPeople,
  planLeave,
  planNewChat,
  planRemovePerson,
  planRename,
  prepareMessage,
  readBodySchema,
  sendMessageBodySchema,
  type ChangeError,
  type ChatChangeError,
  type ChatListResponse,
  type ChatResponse,
  type DraftError,
  type HistoryResponse,
  type MessageResponse,
  type NewChatResponse,
  type PeopleListResponse,
  type ReadResponse,
  type UnreadCounts,
  type UnreadResponse,
} from '@carehub/team-chat';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { httpError, type ErrorCode } from '../../core/errors';
import { isUniqueViolation } from '../../db';
import { publishToUsers } from '../live';
import * as changes from './changes';
import type { MessageCreatedEvent } from './events';
import { chatJson, messageJson, peopleInChats, peopleInMessages } from './json';
import { canBeMessaged, isUuid, listPeople, lookUpPeople } from './people';
import type { ChatRow, MemberRow, MessageRow } from './schema';
import * as store from './store';

const chatParams = z.object({ chatId: z.string() });
const memberParams = z.object({ chatId: z.string(), userId: z.string() });
const messageParams = z.object({ messageId: z.string() });

const NEW_CHAT_ERRORS = {
  'no-people': 'Pick at least one other person.',
  'group-too-big': 'Groups can have up to 50 people.',
  'name-too-long': 'Group names can be up to 100 characters.',
} as const;

const DRAFT_ERRORS: Record<DraftError, string> = {
  empty: 'Type a message first.',
  'too-long': 'Messages can be up to 4,000 characters.',
  'too-many-page-cards': 'A message can have up to 10 page cards.',
  'too-many-files': 'A message can have up to 10 files.',
};

const CANT_BE_MESSAGED = "Guests and people removed from the workspace can't be messaged.";

/** Asked for twice (a resend): nothing changes, and the answer is the chat as it is now. */
type AlreadyDone = 'already-in-chat' | 'person-not-in-chat' | 'unchanged';

const CHAT_CHANGE_ERRORS: Record<
  Exclude<ChatChangeError, AlreadyDone>,
  [number, ErrorCode, string?]
> = {
  'not-a-group': [400, 'invalid', "Direct chats can't be renamed, and people can't be added."],
  'cannot-leave': [400, 'invalid', "Direct chats can't be left."],
  'not-in-chat': [403, 'forbidden'],
  'cannot-remove-people': [403, 'forbidden', "You can't remove people from this group."],
  'remove-yourself': [400, 'invalid', 'To go yourself, leave the group.'],
  'group-too-big': [400, 'invalid', NEW_CHAT_ERRORS['group-too-big']],
  'name-too-long': [400, 'invalid', NEW_CHAT_ERRORS['name-too-long']],
};

/** The error for a change that can't be made, or null when it's already made. */
function chatChangeError(error: ChatChangeError) {
  if (error === 'already-in-chat' || error === 'person-not-in-chat' || error === 'unchanged') {
    return null;
  }
  const [status, code, message] = CHAT_CHANGE_ERRORS[error];
  return httpError(status, code, message);
}

/** A nudge for these people's open tabs: they fetch the chat again (live updates). */
const nudge = (userIds: readonly string[], chatId: string) =>
  publishToUsers(userIds, { type: 'messages-changed', data: { chatId } });

/** `not-yours` and `not-a-message` are 403s (MS-05). */
function changeError(error: ChangeError) {
  if (error === 'deleted') return httpError(409, 'conflict', 'This message was deleted.');
  return httpError(403, 'forbidden');
}

const current = (members: readonly MemberRow[]) =>
  members.filter((row) => row.leftAt === null).map((row) => row.userId);

const messagesRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireMember);

  function viewerOf(request: FastifyRequest) {
    const { user, member } = request;
    if (!user || !member) throw httpError(401, 'signed_out');
    return { userId: user.id, workspaceId: member.workspaceId, isGuest: member.kind === 'guest' };
  }
  type Viewer = ReturnType<typeof viewerOf>;

  /** The chat, for someone in it now: 404 when there's no such chat, 403 for anyone else. */
  async function openChat(viewer: Viewer, chatId: string) {
    const chat = isUuid(chatId) ? await store.findChat(app.db, viewer.workspaceId, chatId) : null;
    if (!chat) throw httpError(404, 'not_found');
    const members = await store.chatMembers(app.db, chat.id);
    const member = members.find((row) => row.userId === viewer.userId) ?? null;
    const can = chatPermissions({ chatType: chat.type, member, isGuest: viewer.isGuest });
    if (!can.read) throw httpError(403, 'forbidden');
    return { chat, members, can };
  }

  /** A message to change, in a chat the person is in now. */
  async function openMessage(viewer: Viewer, messageId: string) {
    const found = isUuid(messageId) ? await store.findMessage(app.db, messageId) : null;
    if (!found || found.chat.workspaceId !== viewer.workspaceId) throw httpError(404, 'not_found');
    const { members } = await openChat(viewer, found.chat.id);
    return { message: found.message, members };
  }

  async function chatAnswer(viewer: Viewer, chat: ChatRow, members: MemberRow[]) {
    const item = await store.chatItem(app.db, chat, members, viewer.userId);
    if (!item) throw httpError(403, 'forbidden');
    const json = chatJson(item, viewer.userId);
    const people = await lookUpPeople(app.db, viewer.workspaceId, peopleInChats([json]));
    return { viewerId: viewer.userId, chat: json, people } satisfies ChatResponse;
  }

  async function messageAnswer(viewer: Viewer, row: MessageRow) {
    const message = messageJson(row, viewer.userId);
    const people = await lookUpPeople(app.db, viewer.workspaceId, peopleInMessages([message]));
    return { message, people } satisfies MessageResponse;
  }

  // The chat list, latest message first. Home asks for the first few that count toward the badge:
  // unread messages, or unread @mentions in muted chats.
  app.get('/chats', async (request): Promise<ChatListResponse> => {
    const viewer = viewerOf(request);
    const query = chatListQuerySchema.parse(request.query);
    const items = await store.listChats(app.db, viewer.workspaceId, viewer.userId);
    const chats = items
      .filter(
        ({ member, counts }) =>
          !query.unread || (member.muted ? counts.mentions : counts.unread) > 0,
      )
      .slice(0, query.limit)
      .map((item) => chatJson(item, viewer.userId));
    const people = await lookUpPeople(app.db, viewer.workspaceId, peopleInChats(chats));
    return { viewerId: viewer.userId, chats, people };
  });

  // Everyone the person can message (New message, Add people): members, not guests (RP-D2).
  app.get('/people', async (request): Promise<PeopleListResponse> => {
    const viewer = viewerOf(request);
    if (viewer.isGuest) throw httpError(403, 'forbidden');
    return { people: await listPeople(app.db, viewer.workspaceId, viewer.userId) };
  });

  // The sidebar badge (MS-06): unread in unmuted chats, @mentions in muted ones.
  app.get('/unread', async (request): Promise<UnreadResponse> => {
    const viewer = viewerOf(request);
    const counts = await store.countUnread(app.db, viewer.workspaceId, viewer.userId);
    return { count: badgeCount([...counts.values()]) };
  });

  // New message: one person opens the pair's direct chat; more start a group of 3 to 50, unless
  // one with exactly these people exists and `startNew` isn't set ("Open existing chat").
  app.post('/chats', async (request, reply) => {
    const viewer = viewerOf(request);
    const body = newChatBodySchema.parse(request.body);
    const plan = planNewChat({
      starterId: viewer.userId,
      pickedIds: body.userIds,
      name: body.name,
    });
    if (!plan.ok) throw httpError(400, 'invalid', NEW_CHAT_ERRORS[plan.error]);
    const others =
      plan.type === 'direct'
        ? [plan.otherUserId]
        : plan.memberIds.filter((id) => id !== viewer.userId);
    if (!(await canBeMessaged(app.db, viewer.workspaceId, others))) {
      throw httpError(400, 'invalid', CANT_BE_MESSAGED);
    }
    const { workspaceId, userId: starterId } = viewer;
    let answer: NewChatResponse;
    if (plan.type === 'direct') {
      const { otherUserId: otherId, directKey } = plan;
      answer = await store.openDirectChat(app.db, { workspaceId, starterId, otherId, directKey });
    } else {
      const existing = body.startNew
        ? null
        : await store.findGroup(app.db, workspaceId, plan.membersKey);
      const { memberIds, name, membersKey, event } = plan;
      answer = existing
        ? { chatId: existing, existing: true }
        : {
            chatId: await store.createGroup(app.db, {
              workspaceId,
              starterId,
              memberIds,
              name,
              membersKey,
              event,
            }),
            existing: false,
          };
    }
    return reply.code(answer.existing ? 200 : 201).send(answer);
  });

  app.get('/chats/:chatId', async (request): Promise<ChatResponse> => {
    const viewer = viewerOf(request);
    const { chatId } = chatParams.parse(request.params);
    const { chat, members } = await openChat(viewer, chatId);
    return chatAnswer(viewer, chat, members);
  });

  // History 50 at a time (MS-11): older with `before`, newer with `after`.
  app.get('/chats/:chatId/messages', async (request): Promise<HistoryResponse> => {
    const viewer = viewerOf(request);
    const { chatId } = chatParams.parse(request.params);
    const query = historyQuerySchema.parse(request.query);
    const { chat } = await openChat(viewer, chatId);
    const page = await store.listMessages(app.db, chat.id, query);
    const messages = page.messages.map((row) => messageJson(row, viewer.userId));
    const people = await lookUpPeople(app.db, viewer.workspaceId, peopleInMessages(messages));
    return { messages, hasMore: page.hasMore, people };
  });

  // Sending. The server checks the 4,000-character limit and empty messages too (MS-14), and a
  // resend with the same clientId answers 200 with the message saved the first time (MS-08).
  app.post('/chats/:chatId/messages', async (request, reply) => {
    const viewer = viewerOf(request);
    const { chatId } = chatParams.parse(request.params);
    const body = sendMessageBodySchema.parse(request.body);
    const { chat, members, can } = await openChat(viewer, chatId);
    if (body.attachmentIds.length > 0) throw httpError(400, 'invalid', "Files can't be sent yet.");
    const memberIds = current(members);
    const recipientIds = memberIds.filter((id) => id !== viewer.userId);
    if (
      chat.type === 'direct' &&
      !(await canBeMessaged(app.db, viewer.workspaceId, recipientIds))
    ) {
      throw httpError(409, 'conflict', CANT_BE_MESSAGED);
    }
    if (!can.send) throw httpError(403, 'forbidden');
    const prepared = prepareMessage({ text: body.text, pageIds: body.pageIds }, { memberIds });
    if (!prepared.ok) throw httpError(400, 'invalid', DRAFT_ERRORS[prepared.error]);
    const { text, mentionedUserIds: mentions, pageIds } = prepared.message;
    const input = { chatId: chat.id, senderId: viewer.userId, clientId: body.clientId };
    const sent = await store
      .sendMessage(app.db, { ...input, text, mentions, pageIds })
      .catch((error: unknown) => {
        // The same clientId sent to two chats at once: the second one loses.
        if (isUniqueViolation(error, 'msg_messages_client_key')) {
          throw httpError(409, 'conflict', store.CLIENT_ID_USED);
        }
        throw error;
      });
    if (sent.created) {
      const event: MessageCreatedEvent = {
        workspaceId: viewer.workspaceId,
        chatId: chat.id,
        messageId: sent.message.id,
        senderId: viewer.userId,
        recipientIds,
      };
      app.events.emit('messages.message.created', event);
      nudge(memberIds, chat.id);
    }
    return reply.code(sent.created ? 201 : 200).send(await messageAnswer(viewer, sent.message));
  });

  /** What's unread in one chat for the viewer. */
  async function unreadIn(viewer: Viewer, chatId: string): Promise<UnreadCounts> {
    const counts = await store.countUnread(app.db, viewer.workspaceId, viewer.userId, [chatId]);
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

  // Only the sender edits a message (MS-05). Files can't be added in an edit; cards can change.
  app.patch('/messages/:messageId', async (request) => {
    const viewer = viewerOf(request);
    const { messageId } = messageParams.parse(request.params);
    const body = editMessageBodySchema.parse(request.body);
    const { message, members } = await openMessage(viewer, messageId);
    const check = checkChangeMessage(message, viewer.userId);
    if (!check.ok) throw changeError(check.error);
    if (body.keepAttachmentIds.length > 0) {
      throw httpError(400, 'invalid', 'This message has no files.');
    }
    const prepared = prepareMessage(
      { text: body.text, pageIds: body.pageIds },
      { memberIds: current(members) },
    );
    if (!prepared.ok) throw httpError(400, 'invalid', DRAFT_ERRORS[prepared.error]);
    const { text, mentionedUserIds: mentions, pageIds } = prepared.message;
    const unchanged = text === message.text && pageIds.join(' ') === message.pageIds.join(' ');
    const edited = unchanged
      ? message
      : await store.editMessage(app.db, message.id, { text, mentions, pageIds }, new Date());
    if (!edited) throw changeError('deleted');
    if (!unchanged) nudge(current(members), message.chatId);
    return messageAnswer(viewer, edited);
  });

  // Only the sender deletes a message (MS-05): its text is erased from the server.
  app.delete('/messages/:messageId', async (request, reply) => {
    const viewer = viewerOf(request);
    const { messageId } = messageParams.parse(request.params);
    const { message, members } = await openMessage(viewer, messageId);
    const check = checkChangeMessage(message, viewer.userId);
    // Deleting it again changes nothing.
    if (!check.ok && check.error !== 'deleted') throw changeError(check.error);
    if (check.ok) {
      await store.deleteMessage(app.db, message.id, deletedMessageFields(new Date()));
      nudge(current(members), message.chatId);
    }
    return reply.code(204).send();
  });
};

export default messagesRoutes;
