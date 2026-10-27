// /api/messages: direct chats and groups (Messages spec). Only members of the workspace use it:
// guests have just their 🔔 Care Hub chat (RP-D2), which is the notices feature's. Every chat
// request checks that the person is in the chat now, admins included (RP-D1, MS-10).
import {
  badgeCount,
  chatListQuerySchema,
  checkChangeMessage,
  deletedMessageFields,
  editMessageBodySchema,
  historyQuerySchema,
  messageSearchBodySchema,
  newChatBodySchema,
  planNewChat,
  prepareMessage,
  sendMessageBodySchema,
  type ChatListResponse,
  type ChatResponse,
  type HistoryResponse,
  type MessageSearchResponse,
  type NewChatResponse,
  type PeopleListResponse,
  type UnreadResponse,
} from '@carehub/team-chat';
import { DEFAULT_TIME_ZONE } from '@carehub/shared';
import type { FastifyPluginAsync } from 'fastify';
import { httpError } from '../../core/errors';
import { isUniqueViolation } from '../../db';
import type { MessageCreatedEvent } from './events';
import { addGroupRoutes } from './group-routes';
import { chatJson, messageJson, peopleInChats, peopleInMessages } from './json';
import * as messageStore from './message-store';
import { canBeMessaged, listPeople, lookUpPeople } from './people';
import {
  CANT_BE_MESSAGED,
  changeError,
  chatAccess,
  chatParams,
  current,
  DRAFT_ERRORS,
  messageParams,
  NEW_CHAT_ERRORS,
  nudge,
  viewerOf,
} from './requests';
import { searchMessages } from './search';
import * as store from './store';

const messagesRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireMember);
  const { openChat, openMessage, chatAnswer, indexOf, messageAnswer } = chatAccess(app.db);

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
    const page = await messageStore.listMessages(app.db, chat.id, query);
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
    const index = await indexOf(viewer, { text, mentions, pageIds });
    const sent = await messageStore
      .sendMessage(app.db, { ...input, text, mentions, pageIds, index })
      .catch((error: unknown) => {
        // The same clientId sent to two chats at once: the second one loses.
        if (isUniqueViolation(error, 'msg_messages_client_key')) {
          throw httpError(409, 'conflict', messageStore.CLIENT_ID_USED);
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
      : await messageStore.editMessage(
          app.db,
          message.id,
          { text, mentions, pageIds, index: await indexOf(viewer, { text, mentions, pageIds }) },
          new Date(),
        );
    if (!edited) throw changeError('deleted');
    if (!unchanged) nudge(current(members), message.chatId);
    return messageAnswer(viewer, edited);
  });

  // Search (MS-19 to MS-21): newest first, in chats the person is in now. The Date filter's days
  // are the person's own, in their time zone.
  app.post('/search', async (request): Promise<MessageSearchResponse> => {
    const viewer = viewerOf(request);
    const body = messageSearchBodySchema.parse(request.body);
    const timeZone = request.user?.timeZone ?? DEFAULT_TIME_ZONE;
    const { rows, hasMore } = await searchMessages(app.db, {
      workspaceId: viewer.workspaceId,
      viewerId: viewer.userId,
      timeZone,
      body,
    });
    const results = rows.map((row) => messageJson(row, viewer.userId));
    const people = await lookUpPeople(app.db, viewer.workspaceId, peopleInMessages(results));
    return { results, hasMore, people };
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
      await messageStore.deleteMessage(app.db, message.id, deletedMessageFields(new Date()));
      nudge(current(members), message.chatId);
    }
    return reply.code(204).send();
  });

  addGroupRoutes(app);
};

export default messagesRoutes;
