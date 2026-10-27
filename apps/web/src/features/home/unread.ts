// Unread messages' data. Stand-in: UnreadChat and useUnreadChats mirror what features/messages
// will export: `useUnreadChats(limit = 5)`, live on `messages-changed`, with no chats for
// guests. Until Messages is on main there are no chats, so this list is empty. Switch to
// `import { useUnreadChats, type UnreadChat } from '../messages'` once it lands.
import { useQuery } from '@tanstack/react-query';

/** A chat with messages the person hasn't read. */
export interface UnreadChat {
  chatId: string;
  /** The other person's name, or the group's. */
  name: string;
  /** The start of the latest message. */
  preview: string;
  unreadCount: number;
  /** ISO instant. */
  lastMessageAt: string;
  /** Opens the chat. */
  href: string;
}

/** Up to `limit` chats with unread messages, latest message first. */
export function useUnreadChats(limit = 5) {
  return useQuery({
    queryKey: ['home', 'unread-chats', limit],
    queryFn: async (): Promise<UnreadChat[]> => [],
  });
}
