// Mentions of people in page text and in comments (Comments and mentions spec, sections 3.3 and
// 5). Each sends its person one notice at most, through the `mentions.send` job, and only while
// they can open the page: for people who can't, the @ menu asks first.
import {
  atLeast,
  blockUrl,
  commentUrl,
  MENTION_DELAY_MS,
  MENTION_MAX_PEOPLE,
  mentionedUserIds,
  type CanOpenResponse,
  type CreateMentionInput,
  type MentionView,
} from '@carehub/shared';
import { and, desc, eq, gt, inArray, isNotNull, sql } from 'drizzle-orm';
import { httpError } from '../../core/errors';
import type { Db, Tx } from '../../db';
import { users } from '../auth/schema';
import { pageAccess } from '../comments/pages';
import { comments, commentThreads } from '../comments/schema';
import { scheduleJob } from '../jobs';
import { NOTICE_LIMITS, sendNotice, type SendNoticeInput } from '../notices';
import { mentions, type Mention } from './schema';

type Executor = Db | Tx;
type NewMention = typeof mentions.$inferInsert;
export const SEND_JOB = 'mentions.send';
export type SendPayload = { mentionId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: string) => UUID.test(value);
const TOKEN = /<@([\w-]{1,64})>/g;
const notFound = () => httpError(404, 'not_found');
/** The same person in the same block again this soon (an undo and redo, a re-render): no new notice. */
const REPEAT_MS = 5 * 60_000;
/**
 * Page text is the editor's word, so one person's mentions there notify at most 20 times a minute,
 * and the same person at most 30 times an hour (#224). Past that they're saved `quiet`, so typing
 * never fails.
 */
export const PAGE_MENTION_LIMITS = { perMinute: 20, perPersonPerHour: 30 } as const;

export function toMentionView(mention: Mention): MentionView {
  return {
    id: mention.id,
    pageId: mention.pageId,
    blockId: mention.blockId,
    commentId: mention.commentId,
    userId: mention.userId,
    status: mention.status,
    sendAt: mention.sendAt?.toISOString() ?? null,
  };
}

async function canOpen(db: Executor, userId: string, pageId: string) {
  const page = await pageAccess(db, userId, pageId);
  return page !== null && atLeast(page.level, 'view');
}

/** The page for someone mentioning people on it: 404 when they can't open it, 403 below `min`. */
async function openPage(db: Executor, userId: string, pageId: string, min: 'comment' | 'edit') {
  const page = await pageAccess(db, userId, pageId);
  if (!page || !atLeast(page.level, 'view')) throw notFound();
  if (!atLeast(page.level, min)) throw httpError(403, 'forbidden');
  return page;
}

/** Queued with the mention, so it exists only if the mention does. */
function queueSend(tx: Tx, mention: Mention) {
  const runAt = mention.sendAt ?? undefined;
  const payload: SendPayload = { mentionId: mention.id };
  const { workspaceId } = mention;
  return scheduleJob({ kind: SEND_JOB, payload, key: mention.id, runAt, workspaceId }, { db: tx });
}

/**
 * Someone typed @person into page text. The notice waits 10 seconds, so deleting the mention
 * (`cancelMention`) stops it. For someone who can't open the page it's 409 unless `notify` is
 * false ("Mention without notifying"): the editor asks first. Past `PAGE_MENTION_LIMITS` the
 * mention is saved `quiet`.
 */
export async function mentionInPage(db: Db, by: string, input: CreateMentionInput) {
  const page = await openPage(db, by, input.pageId, 'edit');
  const [person] = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.id, input.userId));
  if (!person) throw httpError(404, 'not_found', "That person isn't in Care Hub.");
  const notify = input.notify && person.id !== by;
  if (notify && !(await canOpen(db, person.id, input.pageId))) {
    throw httpError(409, 'conflict', `${person.name} can't open this page.`);
  }
  return db.transaction(async (tx) => {
    let quiet = !notify;
    if (notify) {
      // One mention at a time from each person, so the repeat check and the limits hold.
      const key = `mentions:${by}`;
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
      const [recent] = await tx
        .select()
        .from(mentions)
        .where(
          and(
            eq(mentions.pageId, input.pageId),
            eq(mentions.blockId, input.blockId),
            eq(mentions.userId, person.id),
            inArray(mentions.status, ['waiting', 'sent']),
            gt(mentions.createdAt, new Date(Date.now() - REPEAT_MS)),
          ),
        )
        .orderBy(desc(mentions.createdAt))
        .limit(1);
      if (recent) return { mention: recent, created: false };
      quiet = await pastLimits(tx, by, person.id);
    }
    const [mention] = await tx
      .insert(mentions)
      .values({
        workspaceId: page.workspaceId,
        pageId: input.pageId,
        blockId: input.blockId,
        userId: person.id,
        mentionedBy: by,
        snippet: input.snippet,
        status: quiet ? 'quiet' : 'waiting',
        sendAt: quiet ? null : new Date(Date.now() + MENTION_DELAY_MS),
      })
      .returning();
    if (!mention) throw new Error('The mention was not saved.');
    if (!quiet) await queueSend(tx, mention);
    return { mention, created: true };
  });
}

/** Whether one more page-text notice from `by` to `userId` is past `PAGE_MENTION_LIMITS`. */
async function pastLimits(tx: Tx, by: string, userId: string): Promise<boolean> {
  const lastMinute = gt(mentions.createdAt, sql`now() - interval '1 minute'`);
  const [row] = await tx
    .select({
      lastMinute: sql<number>`count(*) FILTER (WHERE ${lastMinute})`.mapWith(Number),
      toPerson: sql<number>`count(*) FILTER (WHERE ${eq(mentions.userId, userId)})`.mapWith(Number),
    })
    .from(mentions)
    .where(
      and(
        eq(mentions.mentionedBy, by),
        isNotNull(mentions.blockId),
        inArray(mentions.status, ['waiting', 'sent']),
        gt(mentions.createdAt, sql`now() - interval '1 hour'`),
      ),
    );
  return (
    (row?.lastMinute ?? 0) >= PAGE_MENTION_LIMITS.perMinute ||
    (row?.toPerson ?? 0) >= PAGE_MENTION_LIMITS.perPersonPerHour
  );
}

/** The mention was deleted from the page text: a notice still waiting won't go. */
export async function cancelMention(db: Db, by: string, mentionId: string): Promise<void> {
  const [mention] = isUuid(mentionId)
    ? await db.select().from(mentions).where(eq(mentions.id, mentionId))
    : [];
  if (!mention || mention.blockId === null) throw notFound();
  await openPage(db, by, mention.pageId, 'edit');
  await db
    .update(mentions)
    .set({ status: 'cancelled' })
    .where(and(eq(mentions.id, mention.id), eq(mentions.status, 'waiting')));
}

/**
 * The people a new or edited comment mentions, other than its author: each gets one notice when
 * they can open the page (`no_access` otherwise). After an edit, only people it newly mentions.
 */
export async function mentionInComment(db: Db, commentId: string): Promise<Mention[]> {
  const [comment] = await db
    .select({
      body: comments.body,
      authorId: comments.authorId,
      deletedAt: comments.deletedAt,
      pageId: commentThreads.pageId,
      workspaceId: commentThreads.workspaceId,
    })
    .from(comments)
    .innerJoin(commentThreads, eq(commentThreads.id, comments.threadId))
    .where(eq(comments.id, commentId));
  if (!comment || comment.deletedAt) return [];
  const ids = [...new Set(mentionedUserIds(comment.body).filter(isUuid).map(lowerCase))]
    .filter((id) => id !== comment.authorId)
    .slice(0, MENTION_MAX_PEOPLE);
  const people = ids.length
    ? await db.select({ id: users.id }).from(users).where(inArray(users.id, ids))
    : [];
  const rows: NewMention[] = [];
  for (const { id } of people) {
    const open = await canOpen(db, id, comment.pageId);
    rows.push({
      workspaceId: comment.workspaceId,
      pageId: comment.pageId,
      commentId,
      userId: id,
      mentionedBy: comment.authorId,
      status: open ? 'waiting' : 'no_access',
      sendAt: open ? new Date() : null,
    });
  }
  if (rows.length === 0) return [];
  return db.transaction(async (tx) => {
    const created = await tx.insert(mentions).values(rows).onConflictDoNothing().returning();
    for (const mention of created) {
      if (mention.status === 'waiting') await queueSend(tx, mention);
    }
    return created;
  });
}

/** For the @ menu: which of these people can open the page. Needs Can comment. */
export async function whoCanOpen(
  db: Db,
  by: string,
  pageId: string,
  userIds: readonly string[],
): Promise<CanOpenResponse> {
  await openPage(db, by, pageId, 'comment');
  const answer: CanOpenResponse = { canOpen: [], cantOpen: [] };
  for (const id of userIds) {
    if (await canOpen(db, id, pageId)) answer.canOpen.push(id);
    else answer.cantOpen.push(id);
  }
  return answer;
}

/**
 * The `mentions.send` job: the notice, if the mention still waits and its person can still open
 * the page. Jobs run at least once, so it holds the mention's row lock until it's marked sent, and
 * the group key makes a repeat update the same notice instead of sending a second one.
 */
export async function sendMention(db: Db, { mentionId }: SendPayload): Promise<void> {
  await db.transaction(async (tx) => {
    const [mention] = isUuid(mentionId)
      ? await tx.select().from(mentions).where(eq(mentions.id, mentionId)).for('update')
      : [];
    if (!mention || mention.status !== 'waiting') return;
    const notice = (await canOpen(tx, mention.userId, mention.pageId))
      ? await noticeFor(tx, mention)
      : 'no_access';
    if (notice === 'no_access' || notice === 'cancelled') {
      await tx.update(mentions).set({ status: notice }).where(eq(mentions.id, mention.id));
      return;
    }
    const { noticeId } = await sendNotice(notice);
    await tx
      .update(mentions)
      .set({ status: 'sent', sentAt: new Date(), noticeId })
      .where(eq(mentions.id, mention.id));
  });
}

/** The notice, or 'cancelled' when its comment was deleted in the meantime. */
async function noticeFor(tx: Tx, mention: Mention): Promise<SendNoticeInput | 'cancelled'> {
  const [sender] = await tx
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, mention.mentionedBy));
  const notice = {
    workspaceId: mention.workspaceId,
    userId: mention.userId,
    kind: 'mention' as const,
    sender: cut(sender?.name ?? 'Care Hub', NOTICE_LIMITS.sender),
    actorUserId: mention.mentionedBy,
    card: { type: 'page' as const, pageId: mention.pageId },
    groupKey: `mention:${mention.id}`,
  };
  if (mention.blockId !== null) {
    const href = blockUrl(mention.pageId, mention.blockId);
    const text = mention.snippet === '' ? undefined : mention.snippet;
    return {
      ...notice,
      title: 'Mentioned you on a page',
      text,
      buttons: [{ label: 'Open', href }],
    };
  }
  const [comment] = mention.commentId
    ? await tx
        .select({ body: comments.body, deletedAt: comments.deletedAt })
        .from(comments)
        .where(eq(comments.id, mention.commentId))
    : [];
  if (!comment || comment.deletedAt || !mention.commentId) return 'cancelled';
  const href = commentUrl(mention.pageId, mention.commentId);
  const text = await readable(tx, comment.body);
  return {
    ...notice,
    title: 'Mentioned you in a comment',
    text,
    buttons: [{ label: 'Open', href }],
  };
}

/** Comment text as people read it: `<@id>` becomes @Name, or "@(removed)". */
async function readable(db: Executor, body: string): Promise<string> {
  const ids = [...new Set(mentionedUserIds(body).filter(isUuid).map(lowerCase))];
  const named = ids.length
    ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids))
    : [];
  const names = new Map(named.map((person) => [person.id, person.name]));
  const text = body.replace(
    TOKEN,
    (_, id: string) => `@${names.get(id.toLowerCase()) ?? '(removed)'}`,
  );
  return cut(text, NOTICE_LIMITS.text);
}

function lowerCase(text: string) {
  return text.toLowerCase();
}

/** At most `max` UTF-16 code units, cut between characters, ending in "…" when it's cut. */
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  let kept = '';
  for (const char of text) {
    if (kept.length + char.length > max - 1) break;
    kept += char;
  }
  return `${kept}…`;
}
