// What the routes share: who's asking, the chat or message they asked about (for people in it
// now), answers in the API's shape, error answers and live nudges.
import {
  chatPermissions,
  type ChangeError,
  type ChatChangeError,
  type ChatResponse,
  type DraftError,
  type MessageResponse,
} from '@carehub/team-chat';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { httpError, type ErrorCode } from '../../core/errors';
import type { Db } from '../../db';
import { publishToUsers } from '../live';
import { chatJson, messageJson, peopleInChats, peopleInMessages } from './json';
import { findMessage } from './message-store';
import { isUuid, lookUpPeople } from './people';
import type { ChatRow, MemberRow, MessageRow } from './schema';
import { messageIndex } from './search';
import { chatItem, chatMembers, findChat } from './store';

export const chatParams = z.object({ chatId: z.string() });
export const memberParams = z.object({ chatId: z.string(), userId: z.string() });
export const messageParams = z.object({ messageId: z.string() });

export const NEW_CHAT_ERRORS = {
  'no-people': 'Pick at least one other person.',
  'group-too-big': 'Groups can have up to 50 people.',
  'name-too-long': 'Group names can be up to 100 characters.',
} as const;

export const DRAFT_ERRORS: Record<DraftError, string> = {
  empty: 'Type a message first.',
  'too-long': 'Messages can be up to 4,000 characters.',
  'too-many-page-cards': 'A message can have up to 10 page cards.',
  'too-many-files': 'A message can have up to 10 files.',
};

export const CANT_BE_MESSAGED = "Guests and people removed from the workspace can't be messaged.";

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
export function chatChangeError(error: ChatChangeError) {
  if (error === 'already-in-chat' || error === 'person-not-in-chat' || error === 'unchanged') {
    return null;
  }
  const [status, code, message] = CHAT_CHANGE_ERRORS[error];
  return httpError(status, code, message);
}

/** A nudge for these people's open tabs: they fetch the chat again (live updates). */
export const nudge = (userIds: readonly string[], chatId: string) =>
  publishToUsers(userIds, { type: 'messages-changed', data: { chatId } });

/** `not-yours` and `not-a-message` are 403s (MS-05). */
export function changeError(error: ChangeError) {
  if (error === 'deleted') return httpError(409, 'conflict', 'This message was deleted.');
  return httpError(403, 'forbidden');
}

export const current = (members: readonly MemberRow[]) =>
  members.filter((row) => row.leftAt === null).map((row) => row.userId);

/** Who's asking: a member of the workspace (the routes' preHandler checked). */
export function viewerOf(request: FastifyRequest) {
  const { user, member } = request;
  if (!user || !member) throw httpError(401, 'signed_out');
  return { userId: user.id, workspaceId: member.workspaceId, isGuest: member.kind === 'guest' };
}
export type Viewer = ReturnType<typeof viewerOf>;

/** The routes' look-ups and answers, on this database. */
export function chatAccess(db: Db) {
  /** The chat, for someone in it now: 404 when there's no such chat, 403 for anyone else. */
  async function openChat(viewer: Viewer, chatId: string) {
    const chat = isUuid(chatId) ? await findChat(db, viewer.workspaceId, chatId) : null;
    if (!chat) throw httpError(404, 'not_found');
    const members = await chatMembers(db, chat.id);
    const member = members.find((row) => row.userId === viewer.userId) ?? null;
    const can = chatPermissions({ chatType: chat.type, member, isGuest: viewer.isGuest });
    if (!can.read) throw httpError(403, 'forbidden');
    return { chat, members, can };
  }

  /** A message to change, in a chat the person is in now. */
  async function openMessage(viewer: Viewer, messageId: string) {
    const found = isUuid(messageId) ? await findMessage(db, messageId) : null;
    if (!found || found.chat.workspaceId !== viewer.workspaceId) throw httpError(404, 'not_found');
    const { members } = await openChat(viewer, found.chat.id);
    return { message: found.message, members };
  }

  async function chatAnswer(viewer: Viewer, chat: ChatRow, members: MemberRow[]) {
    const item = await chatItem(db, chat, members, viewer.userId);
    if (!item) throw httpError(403, 'forbidden');
    const json = chatJson(item, viewer.userId);
    const people = await lookUpPeople(db, viewer.workspaceId, peopleInChats([json]));
    return { viewerId: viewer.userId, chat: json, people } satisfies ChatResponse;
  }

  /** What search stores for a message, with mentions read as the people's names. */
  async function indexOf(
    viewer: Viewer,
    message: { text: string; mentions: readonly string[]; pageIds: readonly string[] },
  ) {
    const names = await lookUpPeople(db, viewer.workspaceId, message.mentions);
    return messageIndex(message, (userId) => names[userId]);
  }

  async function messageAnswer(viewer: Viewer, row: MessageRow) {
    const message = messageJson(row, viewer.userId);
    const people = await lookUpPeople(db, viewer.workspaceId, peopleInMessages([message]));
    return { message, people } satisfies MessageResponse;
  }

  return { openChat, openMessage, chatAnswer, indexOf, messageAnswer };
}
