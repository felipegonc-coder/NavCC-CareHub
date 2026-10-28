import { randomUUID } from 'node:crypto';
import { sampleStandardCourse, type Course } from '@carehub/learning';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../../db';
import { createTestApp, hasDatabase, type TestApp } from '../../../testing';
import * as courses from '../courses/service';
import { LearningError } from '../errors';
import { learningReviewLinks } from './schema';
import * as reviews from './service';
import { hashReviewToken } from './tokens';

const someone = (): courses.Actor => ({ userId: randomUUID(), workspaceId: randomUUID() });
const colleagueOf = (actor: courses.Actor): courses.Actor => ({ ...actor, userId: randomUUID() });
const NOW = new Date('2026-10-27T10:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const later = (days: number) => new Date(NOW.getTime() + days * DAY_MS);
const tokenOf = (url: string) => url.slice('/learning/review#'.length);

async function failure(call: Promise<unknown>): Promise<LearningError> {
  const outcome = await call.then(
    () => new Error('Expected the call to fail.'),
    (error: unknown) => error,
  );
  if (outcome instanceof LearningError) return outcome;
  throw outcome;
}

describe.skipIf(!hasDatabase)('Learning reviews', () => {
  let server: TestApp;
  let db: Db;

  beforeAll(async () => {
    server = await createTestApp();
    db = server.db;
  });

  afterAll(async () => {
    await server?.close();
  });

  /** A draft with the sample course in it, and a review link to it. */
  async function shared(author = someone(), days: 7 | 30 | 90 = 30) {
    const blank = await courses.createStudioCourse(db, author, { type: 'standard' });
    const course: Course = { ...structuredClone(sampleStandardCourse), id: blank.course.id };
    await courses.saveDraft(db, author, course.id, { course, revision: blank.revision });
    const link = await reviews.createReviewLink(db, author, course.id, { days }, NOW);
    return { author, course, link, token: tokenOf(link.url) };
  }

  it('makes a link whose token is shown once and stored only as a hash', async () => {
    const { author, course, link, token } = await shared(undefined, 7);
    expect(link.url).toMatch(/^\/learning\/review#[A-Za-z0-9_-]{43}$/);
    expect(link).toMatchObject({
      createdAt: NOW.toISOString(),
      expiresAt: later(7).toISOString(),
      createdBy: { id: author.userId, name: 'Someone' },
    });
    const [row] = await db
      .select()
      .from(learningReviewLinks)
      .where(eq(learningReviewLinks.id, link.id));
    expect(row?.tokenHash).toBe(hashReviewToken(token));
    expect(JSON.stringify(row)).not.toContain(token);
    const listed = await reviews.listReviewLinks(db, author, course.id, NOW);
    expect(listed).toEqual([
      {
        id: link.id,
        createdAt: link.createdAt,
        expiresAt: link.expiresAt,
        createdBy: link.createdBy,
      },
    ]);
  });

  it('opens the draft for a colleague with the link, until it expires or is stopped', async () => {
    const { author, course, link, token } = await shared();
    const colleague = colleagueOf(author);
    const review = await reviews.openReview(db, colleague, token, later(1));
    expect(review).toEqual({ course, comments: [], expiresAt: later(30).toISOString() });

    expect((await failure(reviews.openReview(db, colleague, token, later(30)))).status).toBe(404);
    expect(await reviews.listReviewLinks(db, author, course.id, later(30))).toEqual([]);

    await reviews.stopReviewLink(db, author, link.id, later(2));
    await reviews.stopReviewLink(db, author, link.id, later(3));
    expect((await failure(reviews.openReview(db, colleague, token, later(2)))).status).toBe(404);
    expect(await reviews.listReviewLinks(db, author, course.id, later(2))).toEqual([]);
  });

  it('never opens for another workspace, a wrong token or a token-shaped guess', async () => {
    const { author, course, link, token } = await shared();
    const outsider = someone();
    for (const [person, value] of [
      [outsider, token],
      [author, `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`],
      [author, 'Ab0-_'.repeat(8) + 'Ab0'],
      [author, undefined],
      [author, [token]],
    ] as const) {
      const error = await failure(reviews.openReview(db, person, value, NOW));
      expect(error.status).toBe(404);
      expect(error.message).toBe('This was deleted, or the link is wrong.');
    }
    expect((await failure(reviews.stopReviewLink(db, outsider, link.id, NOW))).status).toBe(404);
    expect(
      (await failure(reviews.createReviewLink(db, outsider, course.id, { days: 30 }, NOW))).status,
    ).toBe(404);
  });

  it('keeps comments on lessons, blocks and questions that are in the draft', async () => {
    const { author, course, token } = await shared();
    const colleague = colleagueOf(author);
    const [lesson] = course.lessons;
    const quiz = course.lessons.find((each) => each.kind === 'quiz');
    const blockId = lesson?.kind === 'content' ? lesson.blocks[0]?.id : undefined;
    const questionId = quiz?.kind === 'quiz' ? quiz.questions[0]?.id : undefined;
    const onBlock = await reviews.addReviewComment(
      db,
      colleague,
      token,
      { lessonId: lesson?.id ?? '', blockId, body: 'Say who to call first.' },
      later(1),
    );
    expect(onBlock).toEqual({
      id: onBlock.id,
      lessonId: lesson?.id,
      blockId,
      body: 'Say who to call first.',
      author: { id: colleague.userId, name: 'Someone' },
      createdAt: later(1).toISOString(),
      resolved: false,
    });
    const onQuestion = await reviews.addReviewComment(
      db,
      colleague,
      token,
      { lessonId: quiz?.id ?? '', questionId, body: 'Two answers look right.' },
      later(2),
    );
    expect(onQuestion).toMatchObject({ questionId });
    expect(onQuestion).not.toHaveProperty('blockId');

    for (const input of [
      { lessonId: 'gone', body: 'Here.' },
      { lessonId: lesson?.id ?? '', blockId: 'gone', body: 'Here.' },
      { lessonId: lesson?.id ?? '', questionId, body: 'Here.' },
    ]) {
      const error = await failure(reviews.addReviewComment(db, colleague, token, input, later(2)));
      expect(error.status).toBe(409);
      expect(error.message).toMatch(/Reload to see the latest version/);
    }
    const review = await reviews.openReview(db, colleague, token, later(3));
    expect(review.comments.map((each) => each.id)).toEqual([onBlock.id, onQuestion.id]);
  });

  it("shows reviewers only their link's comments, and the author every link's", async () => {
    const first = await shared();
    const second = await reviews.createReviewLink(
      db,
      first.author,
      first.course.id,
      { days: 30 },
      NOW,
    );
    const colleague = colleagueOf(first.author);
    const lessonId = first.course.lessons[0]?.id ?? '';
    const a = await reviews.addReviewComment(
      db,
      colleague,
      first.token,
      { lessonId, body: 'A' },
      later(1),
    );
    const b = await reviews.addReviewComment(
      db,
      colleague,
      tokenOf(second.url),
      { lessonId, body: 'B' },
      later(2),
    );
    const review = await reviews.openReview(db, colleague, tokenOf(second.url), later(3));
    expect(review.comments.map((each) => each.id)).toEqual([b.id]);
    const all = await reviews.listReviewComments(db, first.author, first.course.id);
    expect(all.map((each) => each.id)).toEqual([a.id, b.id]);

    await reviews.stopReviewLink(db, first.author, first.link.id, later(4));
    const kept = await reviews.listReviewComments(db, first.author, first.course.id);
    expect(kept.map((each) => each.id)).toEqual([a.id, b.id]);
    expect((await failure(reviews.listReviewComments(db, someone(), first.course.id))).status).toBe(
      404,
    );
  });

  it('resolves comments and opens them again', async () => {
    const { author, course, token } = await shared();
    const lessonId = course.lessons[0]?.id ?? '';
    const made = await reviews.addReviewComment(
      db,
      colleagueOf(author),
      token,
      { lessonId, body: 'Typo.' },
      NOW,
    );
    expect(await reviews.setCommentResolved(db, author, made.id, true, later(1))).toEqual({
      ...made,
      resolved: true,
    });
    expect((await reviews.setCommentResolved(db, author, made.id, false, later(2))).resolved).toBe(
      false,
    );
    expect((await failure(reviews.setCommentResolved(db, someone(), made.id, true))).status).toBe(
      404,
    );
  });

  it('exports the comments as CSV in course order', async () => {
    const { author, course, token } = await shared();
    const [lesson, next] = course.lessons;
    const colleague = colleagueOf(author);
    await reviews.addReviewComment(
      db,
      colleague,
      token,
      { lessonId: next?.id ?? '', body: 'Second.' },
      NOW,
    );
    await reviews.addReviewComment(
      db,
      colleague,
      token,
      { lessonId: lesson?.id ?? '', body: 'First.' },
      later(1),
    );
    const csv = await reviews.reviewCommentsCsvFor(db, author, course.id);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('\uFEFFLesson,Part,Comment,From,Date,Status');
    expect(lines[1]).toContain(',Whole lesson,First.,Someone,2026-10-28,Open');
    expect(lines[2]).toContain(',Whole lesson,Second.,Someone,2026-10-27,Open');
  });

  it('shares a course by at most 20 links that still open', async () => {
    const { author, course, link } = await shared();
    for (let made = 1; made < 20; made += 1) {
      await reviews.createReviewLink(db, author, course.id, { days: 7 }, NOW);
    }
    const tooMany = await failure(
      reviews.createReviewLink(db, author, course.id, { days: 7 }, NOW),
    );
    expect(tooMany.status).toBe(409);
    expect(tooMany.message).toBe(
      'This course is shared by 20 review links already. Stop sharing one first.',
    );
    await reviews.stopReviewLink(db, author, link.id, NOW);
    await reviews.createReviewLink(db, author, course.id, { days: 7 }, NOW);
    expect(
      await reviews.createReviewLink(db, author, course.id, { days: 7 }, later(7)),
    ).toMatchObject({
      expiresAt: later(14).toISOString(),
    });
  });
});
