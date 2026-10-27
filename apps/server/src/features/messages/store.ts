import type { SystemEvent, UnreadCounts } from '@carehub/team-chat';
import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  gt,
  inArray,
  isNull,
  lt,
  ne,
  or,
  sql,
} from 'drizzle-orm';
import { httpError } from '../../core/errors';
import type { Db, Tx } from '../../db';
import {
  msgChats,
  msgMembers,
  msgMessages,
  type ChatRow,
  type MemberRow,
  type MessageRow,
} from './schema';
import { EMPTY_INDEX, type MessageIndex } from './search';

type Executor = Db | Tx;

/** A clientId is the sender's for one message, in one chat. */
export const CLIENT_ID_USED = 'That message ID was used in another chat. Send it again.';

/** A chat as its list row and header show it, for one viewer. */
export interface ChatItem {
  chat: ChatRow;
  /** Current members, longest-standing first. */
  members: MemberRow[];
  /** The viewer's own membership. */
  member: MemberRow;
  last: MessageRow | null;
  counts: UnreadCounts;
}

const byJoined = [asc(msgMembers.joinedAt), asc(msgMembers.userId)];

export async function findChat(
  db: Executor,
  workspaceId: string,
  chatId: string,
): Promise<ChatRow | null> {
  const [chat] = await db
    .select()
    .from(msgChats)
    .where(and(eq(msgChats.id, chatId), eq(msgChats.workspaceId, workspaceId)));
  return chat ?? null;
}

/** Everyone ever in the chat, longest-standing first (`leftAt` is set for people who left). */
export async function chatMembers(db: Executor, chatId: string): Promise<MemberRow[]> {
  return db
    .select()
    .from(msgMembers)
    .where(eq(msgMembers.chatId, chatId))
    .orderBy(...byJoined);
}

async function lastMessages(db: Executor, chats: readonly ChatRow[]) {
  const ids = chats.filter((chat) => chat.lastSeq > 0).map((chat) => chat.id);
  if (ids.length === 0) return new Map<string, MessageRow>();
  const rows = await db
    .select(getTableColumns(msgMessages))
    .from(msgMessages)
    .innerJoin(
      msgChats,
      and(eq(msgChats.id, msgMessages.chatId), eq(msgChats.lastSeq, msgMessages.seq)),
    )
    .where(inArray(msgMessages.chatId, ids));
  return new Map(rows.map((row) => [row.chatId, row]));
}

const countMentionsOf = (userId: string) =>
  sql<number>`count(*) filter (where ${userId}::uuid = any(${msgMessages.mentions}))`.mapWith(
    Number,
  );

/**
 * Unread messages in the person's current chats in the workspace (or only `chatIds`): messages
 * from others after their read marker, not deleted (as `countsAsUnread`), and those mentioning
 * them. Chats with nothing unread are left out.
 */
export async function countUnread(
  db: Executor,
  workspaceId: string,
  userId: string,
  chatIds?: readonly string[],
): Promise<Map<string, UnreadCounts & { muted: boolean }>> {
  if (chatIds?.length === 0) return new Map();
  const rows = await db
    .select({
      chatId: msgMessages.chatId,
      muted: msgMembers.muted,
      unread: count(),
      mentions: countMentionsOf(userId),
    })
    .from(msgMessages)
    .innerJoin(msgChats, eq(msgChats.id, msgMessages.chatId))
    .innerJoin(
      msgMembers,
      and(
        eq(msgMembers.chatId, msgMessages.chatId),
        eq(msgMembers.userId, userId),
        isNull(msgMembers.leftAt),
      ),
    )
    .where(
      and(
        eq(msgChats.workspaceId, workspaceId),
        chatIds ? inArray(msgMessages.chatId, [...chatIds]) : undefined,
        gt(msgMessages.seq, msgMembers.lastReadSeq),
        eq(msgMessages.kind, 'message'),
        isNull(msgMessages.deletedAt),
        or(isNull(msgMessages.senderId), ne(msgMessages.senderId, userId)),
      ),
    )
    .groupBy(msgMessages.chatId, msgMembers.muted);
  return new Map(rows.map(({ chatId, ...counts }) => [chatId, counts]));
}

const NOTHING_UNREAD: UnreadCounts = { unread: 0, mentions: 0 };

function toItems(
  chats: readonly ChatRow[],
  members: readonly MemberRow[],
  last: ReadonlyMap<string, MessageRow>,
  counts: ReadonlyMap<string, UnreadCounts>,
  userId: string,
): ChatItem[] {
  const byChat = new Map<string, MemberRow[]>();
  for (const row of members) {
    const list = byChat.get(row.chatId) ?? [];
    list.push(row);
    byChat.set(row.chatId, list);
  }
  return chats.flatMap((chat) => {
    const current = (byChat.get(chat.id) ?? []).filter((row) => row.leftAt === null);
    const member = current.find((row) => row.userId === userId);
    if (!member) return [];
    const { unread, mentions } = counts.get(chat.id) ?? NOTHING_UNREAD;
    const item = { chat, members: current, member, last: last.get(chat.id) ?? null };
    return [{ ...item, counts: { unread, mentions } }];
  });
}

/** The person's chats in the workspace, latest message first. */
export async function listChats(
  db: Executor,
  workspaceId: string,
  userId: string,
): Promise<ChatItem[]> {
  const chats = await db
    .select(getTableColumns(msgChats))
    .from(msgChats)
    .innerJoin(
      msgMembers,
      and(
        eq(msgMembers.chatId, msgChats.id),
        eq(msgMembers.userId, userId),
        isNull(msgMembers.leftAt),
      ),
    )
    .where(eq(msgChats.workspaceId, workspaceId))
    .orderBy(desc(msgChats.lastMessageAt), asc(msgChats.id));
  if (chats.length === 0) return [];
  const ids = chats.map((chat) => chat.id);
  const [members, last, counts] = await Promise.all([
    db
      .select()
      .from(msgMembers)
      .where(and(inArray(msgMembers.chatId, ids), isNull(msgMembers.leftAt)))
      .orderBy(...byJoined),
    lastMessages(db, chats),
    countUnread(db, workspaceId, userId, ids),
  ]);
  return toItems(chats, members, last, counts, userId);
}

/** One chat for a current member, or null. */
export async function chatItem(
  db: Executor,
  chat: ChatRow,
  members: readonly MemberRow[],
  userId: string,
): Promise<ChatItem | null> {
  const [last, counts] = await Promise.all([
    lastMessages(db, [chat]),
    countUnread(db, chat.workspaceId, userId, [chat.id]),
  ]);
  const [item] = toItems([chat], members, last, counts, userId);
  return item ?? null;
}

/** The pair's direct chat: the one they have, or a new one. */
export async function openDirectChat(
  db: Db,
  input: { workspaceId: string; starterId: string; otherId: string; directKey: string },
): Promise<{ chatId: string; existing: boolean }> {
  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(msgChats)
      .values({
        workspaceId: input.workspaceId,
        type: 'direct',
        directKey: input.directKey,
        startedBy: input.starterId,
      })
      .onConflictDoNothing({ target: [msgChats.workspaceId, msgChats.directKey] })
      .returning({ id: msgChats.id });
    if (!created) {
      const [found] = await tx
        .select({ id: msgChats.id })
        .from(msgChats)
        .where(
          and(eq(msgChats.workspaceId, input.workspaceId), eq(msgChats.directKey, input.directKey)),
        );
      if (!found) throw new Error('The direct chat was neither made nor found.');
      return { chatId: found.id, existing: true };
    }
    await tx.insert(msgMembers).values([
      { chatId: created.id, userId: input.starterId },
      { chatId: created.id, userId: input.otherId },
    ]);
    return { chatId: created.id, existing: false };
  });
}

/** The most recent group with exactly these current members, for "Open existing chat". */
export async function findGroup(
  db: Executor,
  workspaceId: string,
  membersKey: string,
): Promise<string | null> {
  const [found] = await db
    .select({ id: msgChats.id })
    .from(msgChats)
    .where(and(eq(msgChats.workspaceId, workspaceId), eq(msgChats.membersKey, membersKey)))
    .orderBy(desc(msgChats.lastMessageAt))
    .limit(1);
  return found?.id ?? null;
}

/** A new group, with its starter able to remove people and the "started the group" line. */
export async function createGroup(
  db: Db,
  input: {
    workspaceId: string;
    starterId: string;
    memberIds: readonly string[];
    name: string | null;
    membersKey: string;
    event: SystemEvent;
  },
): Promise<string> {
  return db.transaction(async (tx) => {
    const [chat] = await tx
      .insert(msgChats)
      .values({
        workspaceId: input.workspaceId,
        type: 'group',
        name: input.name,
        membersKey: input.membersKey,
        startedBy: input.starterId,
        lastSeq: 1,
      })
      .returning({ id: msgChats.id });
    if (!chat) throw new Error('The group was not saved.');
    await tx.insert(msgMembers).values(
      input.memberIds.map((userId) => {
        const starter = userId === input.starterId;
        return { chatId: chat.id, userId, canRemoveOthers: starter, lastReadSeq: starter ? 1 : 0 };
      }),
    );
    await tx
      .insert(msgMessages)
      .values({ chatId: chat.id, seq: 1, kind: 'system', system: input.event });
    return chat.id;
  });
}

export interface NewMessage {
  chatId: string;
  senderId: string;
  clientId: string;
  text: string;
  mentions: readonly string[];
  pageIds: readonly string[];
  index: MessageIndex;
}

/**
 * Saves a message as the chat's next `seq` and marks the chat read up to it for the sender. A
 * resend with the same `clientId` gives back the message saved the first time (`created: false`).
 */
export async function sendMessage(
  db: Db,
  input: NewMessage,
): Promise<{ message: MessageRow; created: boolean }> {
  return db.transaction(async (tx) => {
    // The chat's row lock puts sends in order, and makes the resend check below safe.
    const [chat] = await tx
      .select({ lastSeq: msgChats.lastSeq })
      .from(msgChats)
      .where(eq(msgChats.id, input.chatId))
      .for('update');
    if (!chat) throw httpError(404, 'not_found');
    const [sent] = await tx
      .select()
      .from(msgMessages)
      .where(
        and(eq(msgMessages.senderId, input.senderId), eq(msgMessages.clientId, input.clientId)),
      );
    if (sent) {
      if (sent.chatId !== input.chatId) {
        throw httpError(409, 'conflict', CLIENT_ID_USED);
      }
      return { message: sent, created: false };
    }
    const seq = chat.lastSeq + 1;
    const [message] = await tx
      .insert(msgMessages)
      .values({
        chatId: input.chatId,
        seq,
        kind: 'message',
        senderId: input.senderId,
        clientId: input.clientId,
        text: input.text,
        mentions: [...input.mentions],
        pageIds: [...input.pageIds],
        search: input.index.search,
        has: [...input.index.has],
      })
      .returning();
    if (!message) throw new Error('The message was not saved.');
    await tx
      .update(msgChats)
      .set({ lastSeq: seq, lastMessageAt: message.createdAt })
      .where(eq(msgChats.id, input.chatId));
    await tx
      .update(msgMembers)
      .set({ lastReadSeq: seq })
      .where(and(eq(msgMembers.chatId, input.chatId), eq(msgMembers.userId, input.senderId)));
    return { message, created: true };
  });
}

/** A message with its chat, or null. */
export async function findMessage(
  db: Executor,
  messageId: string,
): Promise<{ message: MessageRow; chat: ChatRow } | null> {
  const [found] = await db
    .select({ message: getTableColumns(msgMessages), chat: getTableColumns(msgChats) })
    .from(msgMessages)
    .innerJoin(msgChats, eq(msgChats.id, msgMessages.chatId))
    .where(eq(msgMessages.id, messageId));
  return found ?? null;
}

/** New text, mentions and cards; null when the message was deleted in the meantime. */
export async function editMessage(
  db: Executor,
  messageId: string,
  change: {
    text: string;
    mentions: readonly string[];
    pageIds: readonly string[];
    index: MessageIndex;
  },
  now: Date,
): Promise<MessageRow | null> {
  const [message] = await db
    .update(msgMessages)
    .set({
      text: change.text,
      mentions: [...change.mentions],
      pageIds: [...change.pageIds],
      search: change.index.search,
      has: [...change.index.has],
      editedAt: now,
    })
    .where(and(eq(msgMessages.id, messageId), isNull(msgMessages.deletedAt)))
    .returning();
  return message ?? null;
}

/**
 * Erases the text, mentions, cards and search index; "This message was deleted" stays in their
 * place.
 */
export async function deleteMessage(
  db: Executor,
  messageId: string,
  fields: { text: string; mentionedUserIds: string[]; pageIds: string[]; deletedAt: Date },
): Promise<void> {
  await db
    .update(msgMessages)
    .set({
      text: fields.text,
      mentions: fields.mentionedUserIds,
      pageIds: fields.pageIds,
      search: EMPTY_INDEX.search,
      has: [...EMPTY_INDEX.has],
      deletedAt: fields.deletedAt,
    })
    .where(and(eq(msgMessages.id, messageId), isNull(msgMessages.deletedAt)));
}

/** Up to `limit` messages before `before` (or the latest) or after `after`, oldest first. */
export async function listMessages(
  db: Executor,
  chatId: string,
  query: { before?: number; after?: number; limit: number },
): Promise<{ messages: MessageRow[]; hasMore: boolean }> {
  const newer = query.after !== undefined;
  const rows = await db
    .select()
    .from(msgMessages)
    .where(
      and(
        eq(msgMessages.chatId, chatId),
        query.after !== undefined ? gt(msgMessages.seq, query.after) : undefined,
        query.before !== undefined ? lt(msgMessages.seq, query.before) : undefined,
      ),
    )
    .orderBy(newer ? asc(msgMessages.seq) : desc(msgMessages.seq))
    .limit(query.limit + 1);
  const page = rows.slice(0, query.limit);
  return { messages: newer ? page : page.reverse(), hasMore: rows.length > query.limit };
}
