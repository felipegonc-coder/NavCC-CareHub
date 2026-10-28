import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useMemo, useSyncExternalStore } from 'react';
import type {
  ChatJson,
  ChatListResponse,
  ChatResponse,
  HistoryResponse,
  MessageJson,
  MessageResponse,
  MessageSearchBody,
  MessageSearchResponse,
  NewChatBody,
  NewChatResponse,
  PeopleListResponse,
  ReadResponse,
  UnreadResponse,
} from '@carehub/team-chat';
import { api, ApiError } from '../../lib/api';
import { useLiveEvent, type LiveEvent } from '../live';
import { toUnreadChats, type UnreadChat } from './chat-info';
import { noteViewer, onForget } from './memory';
import { createOutbox, type Outbox, type PendingMessage } from './outbox';

const BASE = '/api/messages';
const chatPath = (chatId: string) => `${BASE}/chats/${encodeURIComponent(chatId)}`;
const messagePath = (messageId: string) => `${BASE}/messages/${encodeURIComponent(messageId)}`;

export const messagesKeys = {
  all: ['messages'] as const,
  /** The chat list, and Home's unread chats under it. */
  chats: ['messages', 'chats'] as const,
  unreadChats: (limit: number) => ['messages', 'chats', 'unread', limit] as const,
  badge: ['messages', 'badge'] as const,
  people: ['messages', 'people'] as const,
  chat: (chatId: string) => ['messages', 'chat', chatId] as const,
  history: (chatId: string) => ['messages', 'history', chatId] as const,
  /** Message searches, refreshed when messages change. */
  searches: ['messages', 'search'] as const,
  search: (body: MessageSearchBody) => ['messages', 'search', body] as const,
};

/** No retries when the answer won't change: not found, no access, bad request. */
export function retryUnlessRefused(failureCount: number, error: Error): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 2;
}

/** Guests have only the 🔔 Care Hub chat (RP-D2): the server answers 403 for the rest. */
async function unlessGuest<T>(load: Promise<T>, forGuest: T): Promise<T> {
  try {
    return await load;
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) return forGuest;
    throw error;
  }
}

/** Notes who the answer is for: someone else signed in means the last person's drafts go. */
async function noted<T extends { viewerId: string } | null>(load: Promise<T>): Promise<T> {
  const answer = await load;
  if (answer) noteViewer(answer.viewerId);
  return answer;
}

const handledEvents = new WeakSet<object>();

/**
 * Refreshes what a `messages-changed` nudge touches, or everything after a reconnect. Several
 * hooks listen; each event is handled once.
 */
export function applyLiveEvent(client: QueryClient, event: LiveEvent): void {
  if (handledEvents.has(event)) return;
  handledEvents.add(event);
  if (event.type !== 'messages-changed') {
    void client.invalidateQueries({ queryKey: messagesKeys.all });
    return;
  }
  const data = event.data as { chatId?: unknown } | undefined;
  void client.invalidateQueries({ queryKey: messagesKeys.chats });
  void client.invalidateQueries({ queryKey: messagesKeys.badge });
  void client.invalidateQueries({ queryKey: messagesKeys.searches });
  if (typeof data?.chatId === 'string') {
    void client.invalidateQueries({ queryKey: messagesKeys.chat(data.chatId) });
    void client.invalidateQueries({ queryKey: messagesKeys.history(data.chatId) });
  }
}

/** Keeps Messages data fresh while the component is on screen. */
export function useMessagesLive(): void {
  const client = useQueryClient();
  useLiveEvent('messages-changed', (event) => applyLiveEvent(client, event));
}

/** The person's chats, latest first; null for guests. */
export function useChatList(): UseQueryResult<ChatListResponse | null, ApiError> {
  useMessagesLive();
  return useQuery<ChatListResponse | null, ApiError>({
    queryKey: messagesKeys.chats,
    queryFn: ({ signal }) =>
      noted(unlessGuest(api.get<ChatListResponse>(`${BASE}/chats`, { signal }), null)),
    retry: retryUnlessRefused,
  });
}

/** Home's "Unread messages": the chats that count toward the badge, newest first. */
export function useUnreadChats(limit = 5): UseQueryResult<UnreadChat[], ApiError> {
  useMessagesLive();
  return useQuery<ChatListResponse | null, ApiError, UnreadChat[]>({
    queryKey: messagesKeys.unreadChats(limit),
    queryFn: ({ signal }) =>
      noted(
        unlessGuest(
          api.get<ChatListResponse>(`${BASE}/chats?unread=true&limit=${limit}`, { signal }),
          null,
        ),
      ),
    select: (answer) => (answer ? toUnreadChats(answer) : []),
    retry: retryUnlessRefused,
  });
}

/** The Messages part of the sidebar badge (the 🔔 chat adds its own). */
export function useMessagesUnread(): number {
  useMessagesLive();
  const { data } = useQuery<UnreadResponse, ApiError>({
    queryKey: messagesKeys.badge,
    queryFn: ({ signal }) =>
      unlessGuest(api.get<UnreadResponse>(`${BASE}/unread`, { signal }), { count: 0 }),
    retry: retryUnlessRefused,
  });
  return data?.count ?? 0;
}

export function useChat(chatId: string): UseQueryResult<ChatResponse, ApiError> {
  return useQuery<ChatResponse, ApiError>({
    queryKey: messagesKeys.chat(chatId),
    queryFn: ({ signal }) => noted(api.get<ChatResponse>(chatPath(chatId), { signal })),
    retry: retryUnlessRefused,
  });
}

/** History in pages of 50, newest page first; the next page is the 50 before it (MS-11). */
export function useHistory(chatId: string) {
  return useInfiniteQuery({
    queryKey: messagesKeys.history(chatId),
    queryFn: ({ pageParam, signal }) =>
      api.get<HistoryResponse>(
        `${chatPath(chatId)}/messages${pageParam > 0 ? `?before=${pageParam}` : ''}`,
        { signal },
      ),
    initialPageParam: 0,
    getNextPageParam: (page) => (page.hasMore ? page.messages[0]?.seq : undefined),
    retry: retryUnlessRefused,
  });
}

/** The loaded messages, oldest first, and everyone they name. */
export function historyOf(data: { pages: readonly HistoryResponse[] } | undefined) {
  const pages = data ? data.pages.toReversed() : [];
  return {
    messages: pages.flatMap((page) => page.messages),
    people: Object.assign({}, ...pages.map((page) => page.people)) as HistoryResponse['people'],
  };
}

const NO_SEARCH: MessageSearchBody = { q: '' };

/**
 * Message search (MS-19): up to 50 messages, newest first, from chats the person is in now. Asks
 * nothing while `body` is null. The last results stay on screen while the next search runs.
 */
export function useMessageSearch(
  body: MessageSearchBody | null,
): UseQueryResult<MessageSearchResponse, ApiError> {
  return useQuery<MessageSearchResponse, ApiError>({
    queryKey: messagesKeys.search(body ?? NO_SEARCH),
    queryFn: ({ signal }) =>
      api.post<MessageSearchResponse>(`${BASE}/search`, body ?? NO_SEARCH, { signal }),
    enabled: body !== null,
    placeholderData: (previous) => previous,
    staleTime: 30_000,
    retry: retryUnlessRefused,
  });
}

export function usePeopleOptions(enabled: boolean) {
  return useQuery<PeopleListResponse, ApiError>({
    queryKey: messagesKeys.people,
    queryFn: ({ signal }) => api.get<PeopleListResponse>(`${BASE}/people`, { signal }),
    enabled,
    staleTime: 5 * 60_000,
    retry: retryUnlessRefused,
  });
}

type History = InfiniteData<HistoryResponse>;

/** Puts a sent or edited message in the loaded history, in `seq` order. */
export function putInHistory(client: QueryClient, chatId: string, answer: MessageResponse): void {
  const { message, people } = answer;
  client.setQueryData<History>(messagesKeys.history(chatId), (old) => {
    if (!old) return old;
    const known = old.pages.some((page) => page.messages.some((item) => item.id === message.id));
    const pages = old.pages.map((page, index) => {
      if (known) {
        const messages = page.messages.map((item) => (item.id === message.id ? message : item));
        return { ...page, messages, people: { ...page.people, ...people } };
      }
      if (index !== 0) return page;
      const messages = [...page.messages, message].sort((a, b) => a.seq - b.seq);
      return { ...page, messages, people: { ...page.people, ...people } };
    });
    return { ...old, pages };
  });
}

function changeMessage(
  client: QueryClient,
  chatId: string,
  messageId: string,
  change: (message: MessageJson) => MessageJson,
) {
  client.setQueryData<History>(messagesKeys.history(chatId), (old) =>
    old
      ? {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            messages: page.messages.map((item) => (item.id === messageId ? change(item) : item)),
          })),
        }
      : old,
  );
}

/** Updates the person's own settings and counts for a chat in the list and the open chat. */
function changeChat(client: QueryClient, chatId: string, change: Partial<ChatJson>) {
  client.setQueryData<ChatListResponse | null>(messagesKeys.chats, (old) =>
    old
      ? {
          ...old,
          chats: old.chats.map((chat) => (chat.id === chatId ? { ...chat, ...change } : chat)),
        }
      : old,
  );
  client.setQueryData<ChatResponse>(messagesKeys.chat(chatId), (old) =>
    old ? { ...old, chat: { ...old.chat, ...change } } : old,
  );
}

const refreshCounts = (client: QueryClient) => {
  void client.invalidateQueries({ queryKey: messagesKeys.badge });
  void client.invalidateQueries({ queryKey: ['messages', 'chats', 'unread'] });
};

/** Read up to the newest message on screen. */
export function useMarkRead(chatId: string) {
  const client = useQueryClient();
  return useMutation<ReadResponse, ApiError, number>({
    mutationFn: (seq) => api.post<ReadResponse>(`${chatPath(chatId)}/read`, { seq }),
    onSuccess: (answer) => {
      changeChat(client, chatId, answer);
      refreshCounts(client);
    },
  });
}

export function useMarkUnread(chatId: string) {
  const client = useQueryClient();
  return useMutation<ReadResponse, ApiError, void>({
    mutationFn: () => api.post<ReadResponse>(`${chatPath(chatId)}/unread`),
    onSuccess: (answer) => {
      changeChat(client, chatId, answer);
      refreshCounts(client);
    },
  });
}

export function useMute(chatId: string) {
  const client = useQueryClient();
  return useMutation<ChatResponse, ApiError, boolean>({
    mutationFn: (muted) => api.patch<ChatResponse>(chatPath(chatId), { muted }),
    onSuccess: (answer) => {
      client.setQueryData(messagesKeys.chat(chatId), answer);
      changeChat(client, chatId, { muted: answer.chat.muted });
      refreshCounts(client);
    },
  });
}

/** A group change gives the chat as it is now; its history gets the new system line. */
function afterGroupChange(client: QueryClient, chatId: string, answer: ChatResponse) {
  client.setQueryData(messagesKeys.chat(chatId), answer);
  void client.invalidateQueries({ queryKey: messagesKeys.history(chatId) });
  void client.invalidateQueries({ queryKey: messagesKeys.chats });
}

/** Rename a group; a blank name shows the members' names again. */
export function useRenameChat(chatId: string) {
  const client = useQueryClient();
  return useMutation<ChatResponse, ApiError, string | null>({
    mutationFn: (name) => api.patch<ChatResponse>(chatPath(chatId), { name }),
    onSuccess: (answer) => afterGroupChange(client, chatId, answer),
  });
}

export function useAddPeople(chatId: string) {
  const client = useQueryClient();
  return useMutation<ChatResponse, ApiError, string[]>({
    mutationFn: (userIds) => api.post<ChatResponse>(`${chatPath(chatId)}/members`, { userIds }),
    onSuccess: (answer) => afterGroupChange(client, chatId, answer),
  });
}

/** Only the person who started the group, or took over, can remove people. */
export function useRemovePerson(chatId: string) {
  const client = useQueryClient();
  return useMutation<ChatResponse, ApiError, string>({
    mutationFn: (userId) =>
      api.delete<ChatResponse>(`${chatPath(chatId)}/members/${encodeURIComponent(userId)}`),
    onSuccess: (answer) => afterGroupChange(client, chatId, answer),
  });
}

/** Leave a group: it goes from the list straight away (the screen then goes back to the list). */
export function useLeaveChat(chatId: string, viewerId: string) {
  const client = useQueryClient();
  return useMutation<unknown, ApiError, void>({
    mutationFn: () => api.delete(`${chatPath(chatId)}/members/${encodeURIComponent(viewerId)}`),
    onSuccess: () => {
      client.setQueryData<ChatListResponse | null>(messagesKeys.chats, (old) =>
        old ? { ...old, chats: old.chats.filter((chat) => chat.id !== chatId) } : old,
      );
      refreshCounts(client);
    },
  });
}

export function useStartChat() {
  const client = useQueryClient();
  return useMutation<NewChatResponse, ApiError, Pick<NewChatBody, 'userIds' | 'name' | 'startNew'>>(
    {
      mutationFn: (body) => api.post<NewChatResponse>(`${BASE}/chats`, body),
      onSuccess: () => void client.invalidateQueries({ queryKey: messagesKeys.chats }),
    },
  );
}

export function useEditMessage(chatId: string) {
  const client = useQueryClient();
  return useMutation<
    MessageResponse,
    ApiError,
    { messageId: string; text: string; pageIds: string[] }
  >({
    mutationFn: ({ messageId, text, pageIds }) =>
      api.patch<MessageResponse>(messagePath(messageId), { text, pageIds }),
    onSuccess: (answer) => {
      putInHistory(client, chatId, answer);
      void client.invalidateQueries({ queryKey: messagesKeys.chats });
    },
  });
}

export function useDeleteMessage(chatId: string) {
  const client = useQueryClient();
  return useMutation<unknown, ApiError, string>({
    mutationFn: (messageId) => api.delete(messagePath(messageId)),
    onSuccess: (_answer, messageId) => {
      const deletedAt = new Date().toISOString();
      changeMessage(client, chatId, messageId, (message) => ({
        ...message,
        text: '',
        mentions: [],
        pageIds: [],
        deletedAt: message.deletedAt ?? deletedAt,
      }));
      void client.invalidateQueries({ queryKey: messagesKeys.chats });
    },
  });
}

let shared: { client: QueryClient; outbox: Outbox } | null = null;
// Signing out, or someone else signing in, empties it (memory.ts).
onForget(() => shared?.outbox.clear());

/** One outbox for the app, so messages keep sending while the person moves between chats. */
export function useOutbox(): Outbox {
  const client = useQueryClient();
  if (shared?.client !== client) {
    const outbox = createOutbox({
      post: (chatId, body) => api.post<MessageResponse>(`${chatPath(chatId)}/messages`, body),
      onSent: (chatId, answer) => {
        putInHistory(client, chatId, answer);
        void client.invalidateQueries({ queryKey: messagesKeys.chats });
      },
      isOnline: () => navigator.onLine,
      newId: () => crypto.randomUUID(),
      now: () => new Date(),
      retryLater: (run) => void window.setTimeout(run, 5000),
    });
    window.addEventListener('online', () => outbox.resume());
    shared = { client, outbox };
  }
  return shared.outbox;
}

/** The chat's messages still on their way, oldest first. */
export function usePendingMessages(outbox: Outbox, chatId: string): PendingMessage[] {
  const all = useSyncExternalStore(outbox.subscribe, outbox.snapshot);
  return useMemo(() => all.filter((item) => item.chatId === chatId), [all, chatId]);
}
