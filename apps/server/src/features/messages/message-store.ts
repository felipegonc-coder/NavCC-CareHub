import { and, asc, desc, eq, getTableColumns, gt, isNull, lt } from 'drizzle-orm';
import { httpError } from '../../core/errors';
import type { Db, Tx } from '../../db';
import { msgChats, msgMembers, msgMessages, type ChatRow, type MessageRow } from './schema';
import { EMPTY_INDEX, type MessageIndex } from './search';

// The messages in a chat: sending, editing, deleting and history. Chats are in store.ts.

type Executor = Db | Tx;

/** A clientId is the sender's for one message, in one chat. */
export const CLIENT_ID_USED = 'That message ID was used in another chat. Send it again.';

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
