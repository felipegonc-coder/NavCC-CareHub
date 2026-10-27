import {
  chatTitle,
  collapseWhitespace,
  countCharacters,
  messagePlainText,
  NOTIFICATION_TEXT_LENGTH,
  personName,
  truncateText,
  type NameOf,
} from '@carehub/team-chat';
import type { Db, Tx } from '../../db';
import { isUuid, lookUpPeople } from './people';
import { chatMembers, findMessage } from './store';

/** What a push notification about a message needs (agreed with W1-C). */
export interface MessageForPush {
  workspaceId: string;
  chatId: string;
  messageId: string;
  chatType: 'direct' | 'group';
  /** As the person sees the chat: the other person, the group's name, or its members' names. */
  chatName: string;
  senderId: string;
  senderName: string;
  /** Plain text on one line, mentions as names, at most 100 characters; "" for cards only. */
  text: string;
  mentionsUser: boolean;
  /** The person muted the chat: only @mentions notify. */
  muted: boolean;
}

/**
 * The message as `userId` would be notified of it, or null when they shouldn't be: they aren't in
 * the chat now, it's their own, a system line, or deleted.
 */
export async function getMessageForPush(
  db: Db | Tx,
  messageId: string,
  userId: string,
): Promise<MessageForPush | null> {
  if (!isUuid(messageId) || !isUuid(userId)) return null;
  const found = await findMessage(db, messageId);
  if (!found) return null;
  const { message, chat } = found;
  const { senderId } = message;
  if (message.kind !== 'message' || message.deletedAt || !senderId || senderId === userId) {
    return null;
  }
  const current = (await chatMembers(db, chat.id)).filter((row) => row.leftAt === null);
  const member = current.find((row) => row.userId === userId);
  if (!member) return null;
  const people = await lookUpPeople(db, chat.workspaceId, [
    senderId,
    ...current.map((row) => row.userId),
    ...message.mentions,
  ]);
  const nameOf: NameOf = (id) => people[id];
  const text = collapseWhitespace(messagePlainText(message.text, nameOf));
  return {
    workspaceId: chat.workspaceId,
    chatId: chat.id,
    messageId: message.id,
    chatType: chat.type,
    chatName: chatTitle({ type: chat.type, name: chat.name, members: current }, userId, nameOf),
    senderId,
    senderName: personName(nameOf(senderId)),
    // A cut text ends in "…", so it keeps one less.
    text:
      countCharacters(text) <= NOTIFICATION_TEXT_LENGTH
        ? text
        : truncateText(text, NOTIFICATION_TEXT_LENGTH - 1),
    mentionsUser: message.mentions.includes(userId),
    muted: member.muted,
  };
}
