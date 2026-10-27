import {
  chatTitle,
  messagePreview,
  personName,
  type ChatJson,
  type ChatListResponse,
  type ChatMember,
  type MessageJson,
  type NameOf,
  type PeopleJson,
  type PreviewSource,
  type UnreadMessage,
} from '@carehub/team-chat';

export const MESSAGES_PATH = '/messages';
/** The 🔔 Care Hub chat's address, /messages/care-hub; the notices feature shows it. */
export const CARE_HUB_ID = 'care-hub';
export const chatHref = (chatId: string) => `${MESSAGES_PATH}/${encodeURIComponent(chatId)}`;

/** Looks people up in an answer's `people`. */
export const nameLookup =
  (people: PeopleJson): NameOf =>
  (userId) =>
    people[userId];

/** The chat's current members, as team-chat's helpers take them. */
export function membersOf(chat: ChatJson): ChatMember[] {
  return chat.members.map((member) => ({
    userId: member.userId,
    joinedAt: new Date(member.joinedAt),
    canRemoveOthers: member.canRemoveOthers,
    leftAt: null,
  }));
}

/** The group's name, the other person, or the group's other members. */
export function titleOf(chat: ChatJson, viewerId: string, people: PeopleJson): string {
  return chatTitle(
    { type: chat.type, name: chat.name, members: membersOf(chat) },
    viewerId,
    nameLookup(people),
  );
}

/** The other person in a direct chat. */
export function otherPersonId(chat: ChatJson, viewerId: string): string | null {
  if (chat.type !== 'direct') return null;
  return chat.members.find((member) => member.userId !== viewerId)?.userId ?? null;
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

export function previewSource(message: MessageJson): PreviewSource {
  if (message.kind === 'system' && message.system) {
    return { kind: 'system', event: message.system };
  }
  return {
    kind: 'message',
    text: message.text,
    deleted: message.deletedAt !== null,
    mentionedUserIds: message.mentions,
    pageCount: message.pageIds.length,
  };
}

/** The chat list's line under the name; "You: …" for your own messages. */
export function previewOf(message: MessageJson, viewerId: string, people: PeopleJson): string {
  const text = messagePreview(previewSource(message), nameLookup(people));
  const own = message.kind === 'message' && message.senderId === viewerId && !message.deletedAt;
  return own ? `You: ${text}` : text;
}

/** The sender's name as the chat shows it. */
export function senderName(message: MessageJson, people: PeopleJson): string {
  return personName(message.senderId ? people[message.senderId] : undefined);
}

export function unreadMessage(message: MessageJson): UnreadMessage {
  return {
    seq: message.seq,
    kind: message.kind,
    senderId: message.senderId,
    deleted: message.deletedAt !== null,
    mentionedUserIds: message.mentions,
  };
}

/** A chat for Home's "Unread messages" (agreed with Home): newest first, no 🔔 Care Hub chat. */
export interface UnreadChat {
  chatId: string;
  name: string;
  /** The latest message, or null before the first one. */
  preview: string | null;
  /** Unread messages, or unread @mentions when the chat is muted (as the badge counts). */
  unreadCount: number;
  /** ISO instant. */
  lastMessageAt: string;
  href: string;
}

export function toUnreadChats(answer: ChatListResponse): UnreadChat[] {
  const { viewerId, people } = answer;
  return answer.chats.flatMap((chat) => {
    const unreadCount = chat.muted ? chat.mentions : chat.unread;
    if (unreadCount <= 0) return [];
    return [
      {
        chatId: chat.id,
        name: titleOf(chat, viewerId, people),
        preview: chat.lastMessage ? previewOf(chat.lastMessage, viewerId, people) : null,
        unreadCount,
        lastMessageAt: chat.lastMessageAt,
        href: chatHref(chat.id),
      },
    ];
  });
}
