import {
  findMentions,
  type ChatJson,
  type MessageJson,
  type SystemEvent,
} from '@carehub/team-chat';
import type { ChatItem } from './store';
import type { MessageRow } from './schema';

const iso = (date: Date | null) => date?.toISOString() ?? null;

export function messageJson(row: MessageRow, viewerId: string): MessageJson {
  return {
    id: row.id,
    chatId: row.chatId,
    seq: row.seq,
    kind: row.kind,
    senderId: row.senderId,
    clientId: row.senderId === viewerId ? row.clientId : null,
    text: row.text,
    mentions: row.mentions,
    pageIds: row.pageIds,
    system: row.system,
    createdAt: row.createdAt.toISOString(),
    editedAt: iso(row.editedAt),
    deletedAt: iso(row.deletedAt),
  };
}

export function chatJson(item: ChatItem, viewerId: string): ChatJson {
  const { chat, members, member, last, counts } = item;
  return {
    id: chat.id,
    type: chat.type,
    name: chat.name,
    startedBy: chat.startedBy,
    createdAt: chat.createdAt.toISOString(),
    lastMessageAt: chat.lastMessageAt.toISOString(),
    lastSeq: chat.lastSeq,
    members: members.map((row) => ({
      userId: row.userId,
      joinedAt: row.joinedAt.toISOString(),
      canRemoveOthers: row.canRemoveOthers,
    })),
    muted: member.muted,
    lastReadSeq: member.lastReadSeq,
    unread: counts.unread,
    mentions: counts.mentions,
    lastMessage: last ? messageJson(last, viewerId) : null,
  };
}

function systemPeople(event: SystemEvent): string[] {
  switch (event.kind) {
    case 'started':
    case 'renamed':
      return [event.actorId];
    case 'added':
      return [event.actorId, ...event.userIds];
    case 'removed':
      return [event.actorId, event.userId];
    case 'left':
    case 'tookOver':
      return [event.userId];
  }
}

/** Everyone these messages show: senders, people in system lines and `<@userId>` mentions. */
export function peopleInMessages(messages: readonly (MessageJson | null)[]): string[] {
  return messages.flatMap((message) => {
    if (!message) return [];
    const ids = findMentions(message.text);
    if (message.senderId) ids.push(message.senderId);
    if (message.system) ids.push(...systemPeople(message.system));
    return ids;
  });
}

/** Everyone a chat list or header shows: members, and the people in each latest message. */
export function peopleInChats(chats: readonly ChatJson[]): string[] {
  return [
    ...chats.flatMap((chat) => chat.members.map((member) => member.userId)),
    ...peopleInMessages(chats.map((chat) => chat.lastMessage)),
  ];
}
