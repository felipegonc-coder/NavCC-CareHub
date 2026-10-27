import { randomUUID } from 'node:crypto';
import { sampleStandardCourse, type Course } from '@carehub/learning';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../../db';
import type { SendNoticeInput, SendNoticeResult } from '../../notices';
import { createTestApp, hasDatabase, type TestApp } from '../../../testing';
import { learningCourses, learningCourseVersions } from '../courses/schema';
import * as courses from '../courses/service';
import { sendReviewReminders } from './reminders';
import { learningReviewReminders } from './schema';

const { sendNotice, isLearningEnabled } = vi.hoisted(() => ({
  sendNotice: vi.fn<(input: SendNoticeInput) => Promise<SendNoticeResult>>(async () => ({
    noticeId: 'notice',
    grouped: false,
  })),
  isLearningEnabled: vi.fn<(workspaceId: string) => Promise<boolean>>(async () => true),
}));
vi.mock('../../notices', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../notices')>()),
  sendNotice,
}));
vi.mock('../public', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../public')>()),
  isLearningEnabled,
}));
vi.mock('../progress/on-publish', () => ({ onCoursePublished: vi.fn(async () => {}) }));

const someone = (): courses.Actor => ({ userId: randomUUID(), workspaceId: randomUUID() });
// Dates well after today, so nothing here is due when the hourly task runs for real.
const at = (instant: string) => new Date(instant);
const sentTo = () => sendNotice.mock.calls.map(([input]) => input);

describe.skipIf(!hasDatabase)('Learning review reminders', () => {
  let server: TestApp;
  let db: Db;

  beforeAll(async () => {
    server = await createTestApp();
    db = server.db;
  });

  afterAll(async () => {
    await server?.close();
  });

  beforeEach(async () => {
    await db.delete(learningCourses);
    sendNotice.mockClear();
    isLearningEnabled.mockImplementation(async () => true);
  });

  /** The sample course, live since `publishedAt` and checked every `everyMonths` (none when null). */
  async function live(everyMonths: number | null, publishedAt: string, author = someone()) {
    const course: Course = structuredClone(sampleStandardCourse);
    delete course.settings.reviewEveryMonths;
    if (everyMonths !== null) course.settings.reviewEveryMonths = everyMonths;
    await courses.seedCourse(db, author, course);
    await publishedOn(author, course.id, 1, publishedAt);
    return { author, course };
  }

  /** Moves a version's publishing time. */
  async function publishedOn(
    author: courses.Actor,
    courseId: string,
    version: number,
    publishedAt: string,
  ) {
    await db
      .update(learningCourseVersions)
      .set({ publishedAt: at(publishedAt) })
      .where(
        and(
          eq(learningCourseVersions.workspaceId, author.workspaceId),
          eq(learningCourseVersions.courseId, courseId),
          eq(learningCourseVersions.version, version),
        ),
      );
  }

  it('reminds whoever published the course once its interval has passed, once per due day', async () => {
    // Published late on 15 January as Learning counts days (America/Denver, decision 0317).
    const { author, course } = await live(6, '2031-01-16T03:00:00.000Z');

    expect(await sendReviewReminders(db, { now: at('2031-07-15T05:00:00.000Z') })).toBe(0);
    expect(await sendReviewReminders(db, { now: at('2031-07-15T07:00:00.000Z') })).toBe(1);
    expect(sentTo()).toEqual([
      {
        workspaceId: author.workspaceId,
        userId: author.userId,
        kind: 'reminder',
        sender: 'Learning',
        title: 'Time to check a course',
        text: "It's been 6 months since one of your courses was published or last checked. Make sure it's still right, and publish any changes.",
        buttons: [{ label: 'Open in Studio', href: `/learning/studio/courses/${course.id}` }],
        groupKey: `learning:review-due:${course.id}`,
        idempotencyKey: `learning:review-due:${course.id}:2031-07-15`,
      },
    ]);
    expect(await sendReviewReminders(db, { now: at('2031-07-20T18:00:00.000Z') })).toBe(0);
    expect(await db.select().from(learningReviewReminders)).toEqual([
      expect.objectContaining({
        workspaceId: author.workspaceId,
        courseId: course.id,
        dueOn: '2031-07-15',
        sentOn: '2031-07-15',
        userId: author.userId,
      }),
    ]);
  });

  it('repeats every interval after the last reminder, until the course is published again', async () => {
    const { author, course } = await live(1, '2031-01-15T18:00:00.000Z');
    expect(await sendReviewReminders(db, { now: at('2031-02-20T18:00:00.000Z') })).toBe(1);
    expect(await sendReviewReminders(db, { now: at('2031-03-19T18:00:00.000Z') })).toBe(0);
    expect(await sendReviewReminders(db, { now: at('2031-03-20T18:00:00.000Z') })).toBe(1);
    expect(sentTo()[1]?.text).toMatch(/^It's been a month since /);

    const colleague = { ...author, userId: randomUUID() };
    expect(await courses.publishCourse(db, colleague, course.id, { notify: 'none' })).toEqual({
      version: 2,
    });
    await publishedOn(colleague, course.id, 2, '2031-03-25T18:00:00.000Z');
    sendNotice.mockClear();
    expect(await sendReviewReminders(db, { now: at('2031-04-24T18:00:00.000Z') })).toBe(0);
    expect(await sendReviewReminders(db, { now: at('2031-04-25T18:00:00.000Z') })).toBe(1);
    expect(sentTo().map((input) => input.userId)).toEqual([colleague.userId]);
  });

  it('skips archived and unpublished courses, courses without an interval and workspaces without Learning', async () => {
    const archived = await live(3, '2031-01-15T18:00:00.000Z');
    await courses.setArchived(db, archived.author, archived.course.id, true);
    await live(null, '2031-01-15T18:00:00.000Z');
    const switchedOff = await live(3, '2031-01-15T18:00:00.000Z');
    isLearningEnabled.mockImplementation(
      async (workspaceId) => workspaceId !== switchedOff.author.workspaceId,
    );
    const author = someone();
    const blank = await courses.createStudioCourse(db, author, { type: 'standard' });
    const draft: Course = {
      ...structuredClone(sampleStandardCourse),
      id: blank.course.id,
      settings: { ...sampleStandardCourse.settings, reviewEveryMonths: 1 },
    };
    await courses.saveDraft(db, author, draft.id, { course: draft, revision: blank.revision });

    expect(await sendReviewReminders(db, { now: at('2031-12-01T18:00:00.000Z') })).toBe(0);
    expect(sendNotice).not.toHaveBeenCalled();
    expect(await db.select().from(learningReviewReminders)).toEqual([]);
  });

  it('sends the others when one notice fails, and tries that one again next time', async () => {
    await live(6, '2031-01-15T18:00:00.000Z');
    await live(6, '2031-01-15T18:00:00.000Z');
    sendNotice.mockRejectedValueOnce(new Error('Notices are down.'));
    const now = at('2031-07-15T18:00:00.000Z');

    await expect(sendReviewReminders(db, { now })).rejects.toThrow('Notices are down.');
    expect(sendNotice).toHaveBeenCalledTimes(2);
    expect(await db.select().from(learningReviewReminders)).toHaveLength(1);
    expect(await sendReviewReminders(db, { now })).toBe(1);
    expect(await sendReviewReminders(db, { now })).toBe(0);
    expect(await db.select().from(learningReviewReminders)).toHaveLength(2);
  });
});
