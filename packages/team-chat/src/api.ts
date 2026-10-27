import { z } from 'zod';
import { idSchema } from './compose';
import { GROUP_MAX_PEOPLE, HISTORY_PAGE_SIZE } from './constants';
import type { SystemEvent } from './system-lines';
import type { ChatType, PersonLabel } from './types';

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

export interface ChatJson {
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
  /** The viewer's own settings. */
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
