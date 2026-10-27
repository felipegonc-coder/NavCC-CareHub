// Threads and comments (Comments and mentions spec, sections 3.1 and 5; decision 0007, section
// 4.3). Every function checks the person's access to the page first.
import {
  atLeast,
  MAX_COMMENTS_PER_THREAD,
  MAX_THREADS_PER_PAGE,
  mentionedUserIds,
  spotOf,
  type AccessLevel,
  type CommentPerson,
  type CommentsResponse,
  type CommentThreadView,
  type CommentView,
  type CreateCommentInput,
} from '@carehub/shared';
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  sql,
  type SQL,
} from 'drizzle-orm';
import { httpError } from '../../core/errors';
import type { Db, Tx } from '../../db';
import { users } from '../auth/schema';
import { pageAccess, type PageAccess } from './pages';
import { comments, commentThreads, type Comment, type CommentThread } from './schema';

type Executor = Db | Tx;
export type ThreadStatus = 'open' | 'resolved' | 'all';
export type ListCommentsOptions = { limit?: number; status?: ThreadStatus };
/** What changed, for live updates and events. */
export type CommentChange = { id: string; threadId: string; pageId: string; workspaceId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: string) => UUID.test(value);
const notFound = () => httpError(404, 'not_found');
const forbidden = () => httpError(403, 'forbidden');
const iso = (date: Date | null) => date?.toISOString() ?? null;

/** The page for this person: 404 when it's missing or in Trash, 403 below `min`. */
async function openPage(db: Executor, userId: string, pageId: string, min: AccessLevel) {
  const page = await pageAccess(db, userId, pageId);
  if (!page) throw notFound();
  if (!atLeast(page.level, min)) throw forbidden();
  return page;
}

/** Its starter (while they can comment) or anyone with Can edit. */
function mayResolve(thread: CommentThread, userId: string, level: AccessLevel) {
  return atLeast(level, 'edit') || (thread.createdBy === userId && atLeast(level, 'comment'));
}

function commentView(comment: Comment, userId: string, level: AccessLevel): CommentView {
  const live = comment.deletedAt === null;
  const own = comment.authorId === userId;
  return {
    id: comment.id,
    authorId: comment.authorId,
    text: comment.body,
    createdAt: comment.createdAt.toISOString(),
    editedAt: iso(comment.editedAt),
    deleted: !live,
    canEdit: live && own,
    canDelete: live && (own || atLeast(level, 'full')),
  };
}

async function threadsOn(
  db: Executor,
  userId: string,
  pageId: string,
  level: AccessLevel,
  { limit, status = 'all' }: ListCommentsOptions,
): Promise<CommentThreadView[]> {
  const where: SQL[] = [eq(commentThreads.pageId, pageId)];
  if (status === 'open') where.push(isNull(commentThreads.resolvedAt));
  if (status === 'resolved') where.push(isNotNull(commentThreads.resolvedAt));
  const most = limit && Number.isInteger(limit) && limit > 0 ? limit : MAX_THREADS_PER_PAGE;
  const threads = await db
    .select()
    .from(commentThreads)
    .where(and(...where))
    .orderBy(desc(commentThreads.lastCommentAt), desc(commentThreads.id))
    .limit(Math.min(most, MAX_THREADS_PER_PAGE));
  if (threads.length === 0) return [];
  const rows = await db
    .select()
    .from(comments)
    .where(
      inArray(
        comments.threadId,
        threads.map((thread) => thread.id),
      ),
    )
    .orderBy(asc(comments.createdAt), asc(comments.id));
  const byThread = new Map<string, CommentView[]>(threads.map((thread) => [thread.id, []]));
  for (const row of rows) byThread.get(row.threadId)?.push(commentView(row, userId, level));
  return threads.map((thread) => ({
    id: thread.id,
    pageId: thread.pageId,
    spot: thread.spot,
    blockId: thread.blockId,
    propertyId: thread.propertyId,
    quote: thread.quote,
    createdBy: thread.createdBy,
    createdAt: thread.createdAt.toISOString(),
    lastCommentAt: thread.lastCommentAt.toISOString(),
    resolvedAt: iso(thread.resolvedAt),
    resolvedBy: thread.resolvedBy,
    canResolve: mayResolve(thread, userId, level),
    comments: byThread.get(thread.id) ?? [],
  }));
}

/** Names and pictures of the starters, resolvers, authors and mentioned people. */
async function peopleIn(
  db: Executor,
  threads: CommentThreadView[],
): Promise<Record<string, CommentPerson>> {
  const ids = new Set<string>();
  for (const thread of threads) {
    ids.add(thread.createdBy);
    if (thread.resolvedBy) ids.add(thread.resolvedBy);
    for (const comment of thread.comments) {
      ids.add(comment.authorId);
      for (const id of mentionedUserIds(comment.text)) ids.add(id);
    }
  }
  const wanted = [...ids].filter(isUuid);
  if (wanted.length === 0) return {};
  const rows = await db
    .select({ id: users.id, name: users.name, avatarUrl: users.avatarUrl })
    .from(users)
    .where(inArray(users.id, wanted));
  return Object.fromEntries(rows.map((person) => [person.id, person]));
}

/**
 * 0007: the page's threads with their comments, the newest activity first, or none when the
 * person can't open the page.
 */
export async function listComments(
  db: Executor,
  userId: string,
  pageId: string,
  options: ListCommentsOptions = {},
): Promise<CommentThreadView[]> {
  const page = isUuid(pageId) ? await pageAccess(db, userId, pageId) : null;
  if (!page || !atLeast(page.level, 'view')) return [];
  return threadsOn(db, userId, pageId, page.level, options);
}

/** GET /api/comments: the threads, the people in them, and whether the person can comment. */
export async function commentsForPage(
  db: Executor,
  userId: string,
  pageId: string,
  status: ThreadStatus,
): Promise<CommentsResponse> {
  const page = await openPage(db, userId, pageId, 'view');
  const threads = await threadsOn(db, userId, pageId, page.level, { status });
  const people = await peopleIn(db, threads);
  return { threads, people, canComment: atLeast(page.level, 'comment') };
}

async function replyTo(tx: Tx, pageId: string, threadId: string) {
  // Locked, so the limit holds when people reply at the same time.
  const [thread] = await tx
    .select({ id: commentThreads.id })
    .from(commentThreads)
    .where(and(eq(commentThreads.id, threadId), eq(commentThreads.pageId, pageId)))
    .for('update');
  if (!thread) throw notFound();
  const [row] = await tx
    .select({ n: count() })
    .from(comments)
    .where(eq(comments.threadId, threadId));
  if ((row?.n ?? 0) >= MAX_COMMENTS_PER_THREAD) {
    throw httpError(413, 'too_large', 'This thread has 500 comments, the most it can have.');
  }
  // Replying reopens a resolved thread.
  await tx
    .update(commentThreads)
    .set({ lastCommentAt: sql`now()`, resolvedAt: null, resolvedBy: null })
    .where(eq(commentThreads.id, threadId));
  return threadId;
}

async function startThread(tx: Tx, userId: string, page: PageAccess, input: CreateCommentInput) {
  // One new thread at a time on each page, so the limit holds.
  const key = `comment_threads:${input.pageId}`;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
  const [row] = await tx
    .select({ n: count() })
    .from(commentThreads)
    .where(eq(commentThreads.pageId, input.pageId));
  if ((row?.n ?? 0) >= MAX_THREADS_PER_PAGE) {
    throw httpError(413, 'too_large', 'This page has 1,000 comment threads, the most it can have.');
  }
  const spot = spotOf(input);
  const [thread] = await tx
    .insert(commentThreads)
    .values({
      workspaceId: page.workspaceId,
      pageId: input.pageId,
      spot,
      blockId: spot === 'text' || spot === 'block' ? input.blockId : null,
      propertyId: spot === 'property' ? input.propertyId : null,
      quote: spot === 'text' ? input.quote : null,
      createdBy: userId,
    })
    .returning({ id: commentThreads.id });
  if (!thread) throw new Error('The comment thread was not saved.');
  return thread.id;
}

/** A reply in `input.threadId` (which reopens it), or the first comment of a new thread. */
export async function addComment(
  db: Executor,
  userId: string,
  input: CreateCommentInput,
): Promise<CommentChange & { newThread: boolean }> {
  const page = await openPage(db, userId, input.pageId, 'comment');
  return (db as Db).transaction(async (tx) => {
    const threadId = input.threadId
      ? await replyTo(tx, input.pageId, input.threadId)
      : await startThread(tx, userId, page, input);
    const [comment] = await tx
      .insert(comments)
      .values({ threadId, authorId: userId, body: input.text })
      .returning({ id: comments.id });
    if (!comment) throw new Error('The comment was not saved.');
    const { workspaceId } = page;
    return {
      id: comment.id,
      threadId,
      pageId: input.pageId,
      workspaceId,
      newThread: !input.threadId,
    };
  });
}

/** The comment and the person's level on its page: 404 when it's gone or they can't open it. */
async function openComment(db: Executor, userId: string, commentId: string) {
  const [found] = isUuid(commentId)
    ? await db
        .select({ comment: comments, thread: commentThreads })
        .from(comments)
        .innerJoin(commentThreads, eq(commentThreads.id, comments.threadId))
        .where(eq(comments.id, commentId))
    : [];
  if (!found || found.comment.deletedAt) throw notFound();
  const page = await pageAccess(db, userId, found.thread.pageId);
  if (!page || !atLeast(page.level, 'view')) throw notFound();
  const { thread } = found;
  const change = { id: commentId, threadId: thread.id, pageId: thread.pageId };
  return { ...found, level: page.level, change: { ...change, workspaceId: thread.workspaceId } };
}

/** Its author changes the text ("edited"). */
export async function editComment(db: Executor, userId: string, commentId: string, text: string) {
  const { comment, change } = await openComment(db, userId, commentId);
  if (comment.authorId !== userId) throw forbidden();
  const [edited] = await db
    .update(comments)
    .set({ body: text, editedAt: sql`now()` })
    .where(and(eq(comments.id, comment.id), isNull(comments.deletedAt)))
    .returning({ editedAt: comments.editedAt });
  if (!edited) throw notFound();
  return { ...change, editedAt: iso(edited.editedAt) };
}

/**
 * Its author, or anyone with Full access, deletes a comment. A thread's first comment stays as
 * "This comment was deleted" while the thread has others; a thread with none left goes.
 */
export async function deleteComment(
  db: Executor,
  userId: string,
  commentId: string,
): Promise<CommentChange> {
  const { comment, thread, level, change } = await openComment(db, userId, commentId);
  if (comment.authorId !== userId && !atLeast(level, 'full')) throw forbidden();
  await (db as Db).transaction(async (tx) => {
    // Locked, so deletes in one thread at the same time see each other.
    await tx
      .select({ id: commentThreads.id })
      .from(commentThreads)
      .where(eq(commentThreads.id, thread.id))
      .for('update');
    const list = await tx
      .select({ id: comments.id, deletedAt: comments.deletedAt })
      .from(comments)
      .where(eq(comments.threadId, thread.id))
      .orderBy(asc(comments.createdAt), asc(comments.id));
    const live = list.filter((row) => row.deletedAt === null);
    if (!live.some((row) => row.id === comment.id)) throw notFound();
    if (live.length === 1) {
      await tx.delete(commentThreads).where(eq(commentThreads.id, thread.id));
    } else if (list[0]?.id === comment.id) {
      await tx
        .update(comments)
        .set({ body: '', deletedAt: sql`now()`, deletedBy: userId })
        .where(eq(comments.id, comment.id));
    } else {
      await tx.delete(comments).where(eq(comments.id, comment.id));
    }
  });
  return change;
}

/** Resolves or reopens a thread (see `mayResolve`). Already so: no change. */
export async function setThreadResolved(
  db: Executor,
  userId: string,
  threadId: string,
  resolved: boolean,
) {
  const [thread] = isUuid(threadId)
    ? await db.select().from(commentThreads).where(eq(commentThreads.id, threadId))
    : [];
  if (!thread) throw notFound();
  const page = await pageAccess(db, userId, thread.pageId);
  if (!page || !atLeast(page.level, 'view')) throw notFound();
  if (!mayResolve(thread, userId, page.level)) throw forbidden();
  const [changed] = await db
    .update(commentThreads)
    .set(
      resolved
        ? { resolvedAt: sql`now()`, resolvedBy: userId }
        : { resolvedAt: null, resolvedBy: null },
    )
    .where(
      and(
        eq(commentThreads.id, thread.id),
        resolved ? isNull(commentThreads.resolvedAt) : isNotNull(commentThreads.resolvedAt),
      ),
    )
    .returning();
  return changed ?? thread;
}

/**
 * For live editing: may `userId` take the comment marks of `threadIds` off the page's text, on a
 * connection that can only comment? Only as far as they could remove those threads: every comment
 * still in each one is theirs, or they have Full access. IDs that aren't threads on the page are
 * fine (nothing is left to keep), since a deleted thread's mark comes off after it's gone.
 */
export async function mayRemoveThreads(
  db: Executor,
  userId: string,
  pageId: string,
  threadIds: Iterable<string>,
): Promise<boolean> {
  const page = await pageAccess(db, userId, pageId);
  if (!page || !atLeast(page.level, 'comment')) return false;
  if (atLeast(page.level, 'full')) return true;
  const ids = [...new Set([...threadIds].filter(isUuid).map((id) => id.toLowerCase()))];
  if (ids.length === 0) return true;
  // More than a page can have at once: refused, so one check stays small.
  if (ids.length > MAX_THREADS_PER_PAGE) return false;
  const [someoneElses] = await db
    .select({ id: comments.id })
    .from(comments)
    .innerJoin(commentThreads, eq(commentThreads.id, comments.threadId))
    .where(
      and(
        eq(commentThreads.pageId, pageId),
        inArray(commentThreads.id, ids),
        isNull(comments.deletedAt),
        ne(comments.authorId, userId),
      ),
    )
    .limit(1);
  return someoneElses === undefined;
}
