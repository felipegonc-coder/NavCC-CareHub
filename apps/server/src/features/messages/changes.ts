import type { SystemEvent } from '@carehub/team-chat';
import { and, eq, isNull, max, ne, or, sql } from 'drizzle-orm';
import { httpError } from '../../core/errors';
import type { Db, Tx } from '../../db';
import { msgChats, msgMembers, msgMessages, type ChatRow, type MemberRow } from './schema';
import { chatMembers } from './store';

type Executor = Db | Tx;

const currentMember = (chatId: string, userId: string) =>
  and(eq(msgMembers.chatId, chatId), eq(msgMembers.userId, userId), isNull(msgMembers.leftAt));

/** Moves the person's read marker forward to `seq`. Null when they aren't in the chat now. */
export async function markRead(
  db: Executor,
  chatId: string,
  userId: string,
  seq: number,
): Promise<number | null> {
  const [row] = await db
    .update(msgMembers)
    .set({ lastReadSeq: sql`greatest(${msgMembers.lastReadSeq}, ${seq})` })
    .where(currentMember(chatId, userId))
    .returning({ lastReadSeq: msgMembers.lastReadSeq });
  return row?.lastReadSeq ?? null;
}

/**
 * Mark as unread: the marker goes back to just before the newest message from someone else
 * (`markAsUnreadSeq`). Null when there's none, so nothing changes.
 */
export async function markUnread(
  db: Executor,
  chatId: string,
  userId: string,
): Promise<number | null> {
  const [newest] = await db
    .select({ seq: max(msgMessages.seq) })
    .from(msgMessages)
    .where(
      and(
        eq(msgMessages.chatId, chatId),
        eq(msgMessages.kind, 'message'),
        isNull(msgMessages.deletedAt),
        or(isNull(msgMessages.senderId), ne(msgMessages.senderId, userId)),
      ),
    );
  const seq = newest?.seq ?? null;
  if (seq === null) return null;
  const [row] = await db
    .update(msgMembers)
    .set({ lastReadSeq: seq - 1 })
    .where(currentMember(chatId, userId))
    .returning({ lastReadSeq: msgMembers.lastReadSeq });
  return row?.lastReadSeq ?? null;
}

/** Mutes or unmutes the chat for the person. */
export async function setMuted(
  db: Executor,
  chatId: string,
  userId: string,
  muted: boolean,
): Promise<void> {
  await db.update(msgMembers).set({ muted }).where(currentMember(chatId, userId));
}

/**
 * Runs `change` in a transaction with the chat's row locked (as sending does) and its members as
 * they are now, so two changes at once can't both work from the same old list.
 */
export async function changeChat<T>(
  db: Db,
  chatId: string,
  change: (tx: Tx, chat: ChatRow, members: MemberRow[]) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const [chat] = await tx.select().from(msgChats).where(eq(msgChats.id, chatId)).for('update');
    if (!chat) throw httpError(404, 'not_found');
    return change(tx, chat, await chatMembers(tx, chatId));
  });
}

/**
 * Adds system lines as the chat's next messages. Call it once per changeChat, with the chat it
 * locked. Returns the new last `seq`.
 */
export async function addSystemLines(
  tx: Tx,
  chat: ChatRow,
  events: readonly SystemEvent[],
): Promise<number> {
  if (events.length === 0) return chat.lastSeq;
  const rows = events.map((system, index) => ({
    chatId: chat.id,
    seq: chat.lastSeq + index + 1,
    kind: 'system' as const,
    system,
  }));
  const lastSeq = chat.lastSeq + rows.length;
  const [first] = await tx
    .insert(msgMessages)
    .values(rows)
    .returning({ createdAt: msgMessages.createdAt });
  await tx
    .update(msgChats)
    .set({ lastSeq, lastMessageAt: first?.createdAt ?? sql`now()` })
    .where(eq(msgChats.id, chat.id));
  return lastSeq;
}

/**
 * People join a group, or come back to it, having read up to `readSeq` (the "added" line). They
 * can scroll back through its earlier messages.
 */
export async function addMembers(
  tx: Tx,
  chatId: string,
  userIds: readonly string[],
  readSeq: number,
): Promise<void> {
  await tx
    .insert(msgMembers)
    .values(userIds.map((userId) => ({ chatId, userId, lastReadSeq: readSeq })))
    .onConflictDoUpdate({
      target: [msgMembers.chatId, msgMembers.userId],
      set: {
        joinedAt: sql`now()`,
        leftAt: null,
        canRemoveOthers: false,
        lastReadSeq: readSeq,
        muted: false,
      },
    });
}

/** The person left the group or was removed from it. */
export async function endMembership(tx: Tx, chatId: string, userId: string): Promise<void> {
  await tx
    .update(msgMembers)
    .set({ leftAt: sql`now()`, canRemoveOthers: false })
    .where(currentMember(chatId, userId));
}

/** The person takes over from the one who started the group: they can remove people. */
export async function giveRemoveRights(tx: Tx, chatId: string, userId: string): Promise<void> {
  await tx.update(msgMembers).set({ canRemoveOthers: true }).where(currentMember(chatId, userId));
}

/** A group's new name, or its new `membersKey` after people joined or left. */
export async function updateGroup(
  tx: Tx,
  chatId: string,
  fields: { name?: string | null; membersKey?: string },
): Promise<void> {
  await tx.update(msgChats).set(fields).where(eq(msgChats.id, chatId));
}
