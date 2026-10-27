import { z } from 'zod';
import { idSchema } from './compose';
import { GROUP_MAX_PEOPLE, HISTORY_PAGE_SIZE } from './constants';
import type { SystemEvent } from './system-lines';
import type { ChatType, PersonLabel } from './types';
import type { UnreadCounts } from './unread';

// What the web sends to /api/messages and what the server answers, so both sides agree.

/** Postgres `integer`, the type of `seq`. */
const SEQ_MAX = 2_147_483_647;
const seq = (min: number) => z.coerce.number().int().min(min).max(SEQ_MAX);

/**
 * New message: the people picked (the sender is added), a group name, and `startNew` to start a
 * new group even when one with exactly these people exists ("Open existing chat").
 */
export const newChatBodySchema = z.object({
  userIds: z.array(idSchema).min(1).max(GROUP_MAX_PEOPLE),
  name: z.string().max(1000).nullish(),
  startNew: z.boolean().default(false),
});
export type NewChatBody = z.infer<typeof newChatBodySchema>;

/** A page of history: messages before `before`, or after `after` (both `seq`), up to 50. */
export const historyQuerySchema = z
  .object({
    before: seq(1).optional(),
    after: seq(0).optional(),
    limit: z.coerce.number().int().min(1).max(HISTORY_PAGE_SIZE).default(HISTORY_PAGE_SIZE),
  })
  .refine((query) => query.before === undefined || query.after === undefined, {
    message: 'Ask for messages before or after, not both.',
  });
export type HistoryQuery = z.infer<typeof historyQuerySchema>;

/** The chat list: `unread=true` keeps chats with unread messages (Home), `limit` the first ones. */
export const chatListQuerySchema = z.object({
  unread: z.stringbool().default(false),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export type ChatListQuery = z.infer<typeof chatListQuerySchema>;

/** Read up to `seq`, the newest message on screen. The marker only moves forward. */
export const readBodySchema = z.object({ seq: seq(0) });
export type ReadBody = z.infer<typeof readBodySchema>;

/** Rename a group (a blank name removes it), or mute a chat for yourself. */
export const changeChatBodySchema = z
  .object({
    name: z.string().max(1000).nullable().optional(),
    muted: z.boolean().optional(),
  })
  .refine((body) => body.name !== undefined || body.muted !== undefined, {
    message: 'Send a new name or muted.',
  });
export type ChangeChatBody = z.infer<typeof changeChatBodySchema>;

/** Add people to a group. They see its earlier messages. */
export const addPeopleBodySchema = z.object({
  userIds: z.array(idSchema).min(1).max(GROUP_MAX_PEOPLE),
});
export type AddPeopleBody = z.infer<typeof addPeopleBodySchema>;

/** A current member of a chat. Times are ISO strings. */
export interface ChatMemberJson {
  userId: string;
  joinedAt: string;
  canRemoveOthers: boolean;
}

export interface MessageJson {
  id: string;
  chatId: string;
  seq: number;
  kind: 'message' | 'system';
  /** Null for system lines (the person is in `system`) and for deleted accounts. */
  senderId: string | null;
  /** The ID the sender's browser made; only in the sender's own messages. */
  clientId: string | null;
  /** Stored text with `<@userId>` mentions; "" once deleted. */
  text: string;
  mentions: string[];
  /** Page cards in order. The web asks the pages feature for each viewer's cards. */
  pageIds: string[];
  system: SystemEvent | null;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
}

export interface ChatJson extends UnreadCounts {
  id: string;
  type: Exclude<ChatType, 'careHub'>;
  /** Groups only; null shows the members' names (`chatTitle`). */
  name: string | null;
  startedBy: string | null;
  createdAt: string;
  /** The latest message's time, or when the chat was started. */
  lastMessageAt: string;
  /** The latest message's `seq`, 0 before the first. */
  lastSeq: number;
  /** Current members, longest-standing first. */
  members: ChatMemberJson[];
  /** The viewer's own settings and read marker; `unread` and `mentions` count after it. */
  muted: boolean;
  lastReadSeq: number;
  lastMessage: MessageJson | null;
}

/** Names for everyone an answer mentions; `removed` for people no longer in the workspace. */
export type PeopleJson = Record<string, PersonLabel>;

export interface ChatListResponse {
  chats: ChatJson[];
  people: PeopleJson;
}

export interface ChatResponse {
  chat: ChatJson;
  people: PeopleJson;
}

/** `existing`: the pair's direct chat, or a group of exactly these people (Open existing chat). */
export interface NewChatResponse {
  chatId: string;
  existing: boolean;
}

export interface HistoryResponse {
  /** Oldest first. */
  messages: MessageJson[];
  /** More messages before the first one here (or after the last one, for `after`). */
  hasMore: boolean;
  people: PeopleJson;
}

export interface MessageResponse {
  message: MessageJson;
  people: PeopleJson;
}

/** After reading or Mark as unread: the viewer's marker and what's left unread. */
export interface ReadResponse extends UnreadCounts {
  lastReadSeq: number;
}

/** The Messages part of the sidebar badge (`badgeCount`); the 🔔 Care Hub chat adds its own. */
export interface UnreadResponse {
  count: number;
}
