// The person's chats (spec 3.3 and 4; CL-11, CL-D3). Every function here works on one person's own
// chats: only their owner can list, open, rename or delete them, Admins included.
import {
  ASSISTANT_TEXTS,
  CHAT_QUESTIONS_MAX,
  chatTitleFrom,
  type AssistantChat,
  type AssistantMessage,
  type AssistantPageLink,
  type AssistantScope,
} from '@carehub/extras/claude/assistant';
import { CLAUDE_CHAT_RETENTION_KEY, chatRetentionSchema } from '@carehub/extras/claude/settings';
import { and, asc, desc, eq, lt, sql } from 'drizzle-orm';
import { httpError } from '../../../core/errors';
import type { Db, Tx } from '../../../db';
import { getWorkspaceSetting } from '../server/workspace-settings';
import { openNow, type Asker } from './pages';
import { claudeChats, claudeMessages } from './schema';

type ChatRow = typeof claudeChats.$inferSelect;
type MessageRow = typeof claudeMessages.$inferSelect;

const DAY_MS = 24 * 60 * 60 * 1000;
/** The chats list shows the newest this many. */
const LISTED_CHATS = 500;

export function chatView(row: ChatRow): AssistantChat {
  return {
    id: row.id,
    title: row.title,
    questions: row.questions,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** A message with only the pages the person can open now (CL-10). */
export function messageView(row: MessageRow, open: ReadonlySet<string>): AssistantMessage {
  const visible = (links: AssistantPageLink[]) => links.filter((link) => open.has(link.id));
  return {
    id: row.id,
    role: row.role,
    text: row.text,
    scope: row.scope,
    pages: visible(row.pages),
    sources: visible(row.sources),
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Deletes the workspace's chats whose last question is older than the days an Admin chose in
 * Settings → Claude. Kept until deleted (null) leaves them alone.
 */
export async function removeExpiredChats(db: Db | Tx, workspaceId: string, now: Date) {
  const saved = await getWorkspaceSetting(db, workspaceId, CLAUDE_CHAT_RETENTION_KEY);
  const days = chatRetentionSchema.safeParse(saved ?? null);
  if (!days.success || days.data === null) return;
  const before = new Date(now.getTime() - days.data * DAY_MS);
  await db
    .delete(claudeChats)
    .where(and(eq(claudeChats.workspaceId, workspaceId), lt(claudeChats.updatedAt, before)));
}

/** The jobs runner's name for the hourly removeAllExpiredChats. */
export const CHAT_RETENTION_TASK = 'claude.chat-retention';

/**
 * removeExpiredChats in every workspace that has chats, for the hourly task: expired chats go
 * within the hour, also where nobody opens the assistant any more.
 */
export async function removeAllExpiredChats(
  db: Db,
  now: Date,
  signal?: AbortSignal,
): Promise<void> {
  const workspaces = await db.selectDistinct({ id: claudeChats.workspaceId }).from(claudeChats);
  for (const { id } of workspaces) {
    if (signal?.aborted) return;
    await removeExpiredChats(db, id, now);
  }
}

/** The person's chats in this workspace, last used first. */
export async function listChats(db: Db | Tx, asker: Asker): Promise<ChatRow[]> {
  return db
    .select()
    .from(claudeChats)
    .where(
      and(eq(claudeChats.ownerId, asker.userId), eq(claudeChats.workspaceId, asker.workspaceId)),
    )
    .orderBy(desc(claudeChats.updatedAt), desc(claudeChats.id))
    .limit(LISTED_CHATS);
}

/** The person's own chat: 404 when it isn't in this workspace, 403 when it's someone else's. */
export async function ownChat(db: Db | Tx, asker: Asker, chatId: string): Promise<ChatRow> {
  const [chat] = await db.select().from(claudeChats).where(eq(claudeChats.id, chatId));
  if (!chat || chat.workspaceId !== asker.workspaceId) throw httpError(404, 'not_found');
  if (chat.ownerId !== asker.userId) throw httpError(403, 'forbidden');
  return chat;
}

export async function chatMessages(db: Db | Tx, chatId: string): Promise<MessageRow[]> {
  return db
    .select()
    .from(claudeMessages)
    .where(eq(claudeMessages.chatId, chatId))
    .orderBy(asc(claudeMessages.turn), desc(claudeMessages.role));
}

/** The chat's messages in order, each showing only pages the person can still open. */
export async function chatMessageViews(
  db: Db | Tx,
  asker: Asker,
  chatId: string,
): Promise<AssistantMessage[]> {
  const rows = await chatMessages(db, chatId);
  const ids = rows.flatMap((row) => [...row.pages, ...row.sources].map((link) => link.id));
  const open = await openNow(db, asker, ids);
  return rows.map((row) => messageView(row, open));
}

export async function renameChat(db: Db | Tx, chatId: string, title: string): Promise<ChatRow> {
  const [chat] = await db
    .update(claudeChats)
    .set({ title })
    .where(eq(claudeChats.id, chatId))
    .returning();
  if (!chat) throw httpError(404, 'not_found');
  return chat;
}

/** Deletes the chat and its messages for good. */
export async function deleteChat(db: Db | Tx, chatId: string): Promise<void> {
  await db.delete(claudeChats).where(eq(claudeChats.id, chatId));
}

export interface Turn {
  /** Null for a new chat, titled from the question. */
  chatId: string | null;
  question: string;
  scope: AssistantScope;
  /** What Claude could read. */
  pages: AssistantPageLink[];
  answer: string;
  sources: AssistantPageLink[];
  askedAt: Date;
  answeredAt: Date;
}

/** Saves a question and its answer together: 409 once the chat has CHAT_QUESTIONS_MAX questions. */
export async function saveTurn(db: Db, asker: Asker, turn: Turn) {
  return db.transaction(async (tx) => {
    let chat: ChatRow | undefined;
    if (turn.chatId) {
      [chat] = await tx
        .update(claudeChats)
        .set({ questions: sql`${claudeChats.questions} + 1`, updatedAt: turn.answeredAt })
        .where(
          and(
            eq(claudeChats.id, turn.chatId),
            eq(claudeChats.ownerId, asker.userId),
            lt(claudeChats.questions, CHAT_QUESTIONS_MAX),
          ),
        )
        .returning();
      if (!chat) {
        // Deleted while Claude was writing, or full.
        const [still] = await tx
          .select({ id: claudeChats.id })
          .from(claudeChats)
          .where(eq(claudeChats.id, turn.chatId));
        throw still
          ? httpError(409, 'conflict', ASSISTANT_TEXTS.chatFull)
          : httpError(404, 'not_found');
      }
    } else {
      [chat] = await tx
        .insert(claudeChats)
        .values({
          workspaceId: asker.workspaceId,
          ownerId: asker.userId,
          title: chatTitleFrom(turn.question),
          questions: 1,
          createdAt: turn.askedAt,
          updatedAt: turn.answeredAt,
        })
        .returning();
      if (!chat) throw new Error('The chat was not saved.');
    }
    const rows = await tx
      .insert(claudeMessages)
      .values([
        {
          chatId: chat.id,
          turn: chat.questions,
          role: 'question',
          text: turn.question,
          scope: turn.scope,
          pages: turn.pages,
          createdAt: turn.askedAt,
        },
        {
          chatId: chat.id,
          turn: chat.questions,
          role: 'answer',
          text: turn.answer,
          sources: turn.sources,
          createdAt: turn.answeredAt,
        },
      ])
      .returning();
    const question = rows.find((row) => row.role === 'question');
    const answer = rows.find((row) => row.role === 'answer');
    if (!question || !answer) throw new Error('The question was not saved.');
    return { chat, question, answer };
  });
}
