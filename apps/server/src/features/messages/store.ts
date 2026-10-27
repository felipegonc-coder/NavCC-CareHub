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
  ne,
  or,
  sql,
} from 'drizzle-orm';
import type { Db, Tx } from '../../db';
import {
  msgChats,
  msgMembers,
  msgMessages,
  type ChatRow,
  type MemberRow,
  type MessageRow,
} from './schema';

type Executor = Db | Tx;

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
