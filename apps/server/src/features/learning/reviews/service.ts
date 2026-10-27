import {
  isReviewTargetInCourse,
  newId,
  REVIEW_LIMITS,
  reviewCommentsCsv,
  reviewUrl,
  type Course,
  type CreateReviewCommentRequest,
  type CreateReviewLinkRequest,
  type NewReviewLink,
  type ReviewComment,
  type ReviewLink,
  type ReviewReply,
} from '@carehub/learning';
import { and, asc, count, desc, eq, gt, isNull, type SQL } from 'drizzle-orm';
import { users } from '../../auth/schema';
import { todayIn } from '../assignments/service';
import { learningCourses as courses } from '../courses/schema';
import type { Actor } from '../courses/service';
import type { Db, Tx } from '../db';
import { httpError } from '../errors';
import { learningReviewComments as comments, learningReviewLinks as links } from './schema';
import { hashReviewToken, isReviewToken, newReviewToken } from './tokens';

// Reviews (docs/learning/api.md, decision 0309): authors share a course's draft by link for 7, 30 or 90 days;
// signed-in colleagues with the link read the draft and comment on its lessons, blocks and questions; authors
// list the comments, resolve them and export them as CSV. Routes check permissions first; every function
// stays inside the actor's workspace.

const DAY_MS = 24 * 60 * 60 * 1000;
const SOMEONE = 'Someone';
const CHANGED =
  'That part of the course was changed or taken out a moment ago. Reload to see the latest version.';

type LinkRow = typeof links.$inferSelect;
type CommentRow = typeof comments.$inferSelect;

const courseKey = (workspaceId: string, courseId: string) =>
  and(eq(courses.workspaceId, workspaceId), eq(courses.id, courseId));
const isOpenAt = (now: Date) => and(isNull(links.stoppedAt), gt(links.expiresAt, now));

async function draftOf(db: Db | Tx, workspaceId: string, courseId: string): Promise<Course> {
  const [row] = await db
    .select({ draft: courses.draft })
    .from(courses)
    .where(courseKey(workspaceId, courseId));
  if (!row) throw httpError(404);
  return row.draft;
}

async function checkCourse(db: Db | Tx, workspaceId: string, courseId: string): Promise<void> {
  const [row] = await db
    .select({ id: courses.id })
    .from(courses)
    .where(courseKey(workspaceId, courseId));
  if (!row) throw httpError(404);
}

async function nameOf(db: Db | Tx, userId: string): Promise<string> {
  const [row] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId));
  return row?.name ?? SOMEONE;
}

const linkOf = (row: LinkRow, name: string | null): ReviewLink => ({
  id: row.id,
  createdAt: row.createdAt.toISOString(),
  expiresAt: row.expiresAt.toISOString(),
  createdBy: { id: row.createdBy, name: name ?? SOMEONE },
});

function commentOf(row: CommentRow, name: string | null): ReviewComment {
  return {
    id: row.id,
    lessonId: row.lessonId,
    ...(row.blockId === null ? {} : { blockId: row.blockId }),
    ...(row.questionId === null ? {} : { questionId: row.questionId }),
    body: row.body,
    author: { id: row.authorId, name: name ?? SOMEONE },
    createdAt: row.createdAt.toISOString(),
    resolved: row.resolvedAt !== null,
  };
}

async function commentsWhere(db: Db | Tx, where: SQL | undefined): Promise<ReviewComment[]> {
  const rows = await db
    .select({ comment: comments, name: users.name })
    .from(comments)
    .leftJoin(users, eq(users.id, comments.authorId))
    .where(where)
    .orderBy(asc(comments.createdAt), asc(comments.id));
  return rows.map(({ comment, name }) => commentOf(comment, name));
}

/** A new link to the course's draft. Its token is in `url` and is never shown again. */
export async function createReviewLink(
  db: Db,
  actor: Actor,
  courseId: string,
  input: CreateReviewLinkRequest,
  now = new Date(),
): Promise<NewReviewLink> {
  const { workspaceId } = actor;
  await checkCourse(db, workspaceId, courseId);
  const [open] = await db
    .select({ total: count() })
    .from(links)
    .where(and(eq(links.workspaceId, workspaceId), eq(links.courseId, courseId), isOpenAt(now)));
  if ((open?.total ?? 0) >= REVIEW_LIMITS.linksPerCourse) {
    throw httpError(
      409,
      `This course is shared by ${REVIEW_LIMITS.linksPerCourse} review links already. Stop sharing one first.`,
    );
  }
  const token = newReviewToken();
  const [row] = await db
    .insert(links)
    .values({
      workspaceId,
      id: newId(),
      courseId,
      tokenHash: hashReviewToken(token),
      createdBy: actor.userId,
      createdAt: now,
      expiresAt: new Date(now.getTime() + input.days * DAY_MS),
    })
    .returning();
  if (!row) throw new Error('The review link was not saved.');
  return { ...linkOf(row, await nameOf(db, actor.userId)), url: reviewUrl(token) };
}

/** The course's links that still open, newest first, without their tokens. */
export async function listReviewLinks(
  db: Db | Tx,
  actor: Actor,
  courseId: string,
  now = new Date(),
): Promise<ReviewLink[]> {
  const { workspaceId } = actor;
  await checkCourse(db, workspaceId, courseId);
  const rows = await db
    .select({ link: links, name: users.name })
    .from(links)
    .leftJoin(users, eq(users.id, links.createdBy))
    .where(and(eq(links.workspaceId, workspaceId), eq(links.courseId, courseId), isOpenAt(now)))
    .orderBy(desc(links.createdAt), asc(links.id));
  return rows.map(({ link, name }) => linkOf(link, name));
}

/** Stops sharing: the link no longer opens. Its comments stay with the course. */
export async function stopReviewLink(
  db: Db | Tx,
  actor: Actor,
  linkId: string,
  now = new Date(),
): Promise<void> {
  const key = and(eq(links.workspaceId, actor.workspaceId), eq(links.id, linkId));
  const stopped = await db
    .update(links)
    .set({ stoppedAt: now })
    .where(and(key, isNull(links.stoppedAt)))
    .returning({ id: links.id });
  if (stopped.length > 0) return;
  const [known] = await db.select({ id: links.id }).from(links).where(key);
  if (!known) throw httpError(404);
}

/** The link a token opens in the actor's workspace; a stopped, expired or unknown one is a 404. */
async function openLink(db: Db | Tx, actor: Actor, token: unknown, now: Date): Promise<LinkRow> {
  if (!isReviewToken(token)) throw httpError(404);
  const [row] = await db
    .select()
    .from(links)
    .where(
      and(
        eq(links.tokenHash, hashReviewToken(token)),
        eq(links.workspaceId, actor.workspaceId),
        isOpenAt(now),
      ),
    );
  if (!row) throw httpError(404);
  return row;
}

/** What a reviewer sees: the draft as it is now, and the comments left through the same link. */
export async function openReview(
  db: Db | Tx,
  actor: Actor,
  token: unknown,
  now = new Date(),
): Promise<ReviewReply> {
  const link = await openLink(db, actor, token, now);
  const course = await draftOf(db, actor.workspaceId, link.courseId);
  const left = await commentsWhere(
    db,
    and(eq(comments.workspaceId, actor.workspaceId), eq(comments.linkId, link.id)),
  );
  return { course, comments: left, expiresAt: link.expiresAt.toISOString() };
}

/** A reviewer's comment on a lesson, block or question that is in the draft now (409 when it was taken out). */
export async function addReviewComment(
  db: Db | Tx,
  actor: Actor,
  token: unknown,
  input: CreateReviewCommentRequest,
  now = new Date(),
): Promise<ReviewComment> {
  const { workspaceId } = actor;
  const link = await openLink(db, actor, token, now);
  const course = await draftOf(db, workspaceId, link.courseId);
  if (!isReviewTargetInCourse(course, input)) throw httpError(409, CHANGED);
  const [kept] = await db
    .select({ total: count() })
    .from(comments)
    .where(and(eq(comments.workspaceId, workspaceId), eq(comments.courseId, link.courseId)));
  if ((kept?.total ?? 0) >= REVIEW_LIMITS.commentsPerCourse) {
    throw httpError(409, 'This course has as many review comments as it can keep.');
  }
  const [row] = await db
    .insert(comments)
    .values({
      workspaceId,
      id: newId(),
      courseId: link.courseId,
      linkId: link.id,
      lessonId: input.lessonId,
      blockId: input.blockId ?? null,
      questionId: input.questionId ?? null,
      body: input.body,
      authorId: actor.userId,
      createdAt: now,
    })
    .returning();
  if (!row) throw new Error('The comment was not saved.');
  return commentOf(row, await nameOf(db, actor.userId));
}

/** Every comment on the course, from every link, oldest first. */
export async function listReviewComments(
  db: Db | Tx,
  actor: Actor,
  courseId: string,
): Promise<ReviewComment[]> {
  await checkCourse(db, actor.workspaceId, courseId);
  return commentsWhere(
    db,
    and(eq(comments.workspaceId, actor.workspaceId), eq(comments.courseId, courseId)),
  );
}

/** The comments as CSV in course order, dated in the actor's own time zone (or Care Hub's default one). */
export async function reviewCommentsCsvFor(
  db: Db | Tx,
  actor: Actor,
  courseId: string,
): Promise<string> {
  const course = await draftOf(db, actor.workspaceId, courseId);
  const all = await commentsWhere(
    db,
    and(eq(comments.workspaceId, actor.workspaceId), eq(comments.courseId, courseId)),
  );
  const [person] = await db
    .select({ timeZone: users.timeZone })
    .from(users)
    .where(eq(users.id, actor.userId));
  const { timeZone } = todayIn(person?.timeZone);
  return reviewCommentsCsv(course, all, { timeZone, bom: true });
}

/** Marks a comment resolved, or open again. */
export async function setCommentResolved(
  db: Db | Tx,
  actor: Actor,
  commentId: string,
  resolved: boolean,
  now = new Date(),
): Promise<ReviewComment> {
  const key = and(eq(comments.workspaceId, actor.workspaceId), eq(comments.id, commentId));
  const [row] = await db
    .update(comments)
    .set(
      resolved
        ? { resolvedAt: now, resolvedBy: actor.userId }
        : { resolvedAt: null, resolvedBy: null },
    )
    .where(key)
    .returning({ id: comments.id });
  if (!row) throw httpError(404);
  const [comment] = await commentsWhere(db, key);
  if (!comment) throw httpError(404);
  return comment;
}
