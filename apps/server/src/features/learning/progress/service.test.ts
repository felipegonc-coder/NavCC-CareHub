import { randomUUID } from 'node:crypto';
import {
  sampleMicrolearningCourse,
  sampleRequiredReadCourse,
  type Course,
  type PublishNotify,
} from '@carehub/learning';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../../db';
import { createTestApp, hasDatabase, type TestApp } from '../../../testing';
import { bindMemoryNotices, type MemoryNoticeStore } from '../../notices/testing';
import { listCertificates } from '../certificates/service';
import { canSeeCourse } from '../courses/access';
import { LearningError } from '../errors';
import { onCoursePublished } from './on-publish';
import { learningProgressChanges as changes } from './schema';
import * as progress from './service';
import { bindMemoryCourseVersions, type MemoryCourseVersions } from './testing';

vi.mock('../courses/access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../courses/access')>()),
  canSeeCourse: vi.fn(async () => true),
}));

// Fictional people and courses only: mostly the microlearning sample, with one content lesson.
const LESSON = 'hold-lesson';

/** A trainer and learners in a workspace of their own, so each test starts empty. */
function workspace(size: number) {
  const workspaceId = randomUUID();
  const person = (): progress.Actor => ({ userId: randomUUID(), workspaceId });
  return { workspaceId, trainer: person(), learners: Array.from({ length: size }, person) };
}

/** The course's next version as an author might write it: one more lesson. */
const withSecondLesson = (course: Course): Course => ({
  ...structuredClone(course),
  lessons: [
    ...structuredClone(course.lessons),
    {
      id: 'hold-music',
      kind: 'content',
      title: 'Choosing hold music',
      blocks: [{ id: 'music-tip', type: 'statement', text: 'Keep it quiet and short.' }],
    },
  ],
});

const soon = (seconds = 0) => new Date(Date.now() + seconds * 1000).toISOString();
const event = (type: string, extra: object = {}, at = soon()) => ({
  id: randomUUID(),
  type,
  at,
  lessonId: LESSON,
  ...extra,
});
const opened = (at = soon(-30), lessonId = LESSON) => event('lesson_opened', { lessonId }, at);
const completed = (lessonId = LESSON) => event('lesson_completed', { lessonId });

async function failure(call: Promise<unknown>): Promise<LearningError> {
  const outcome = await call.then(
    () => new Error('Expected the call to fail.'),
    (error: unknown) => error,
  );
  if (outcome instanceof LearningError) return outcome;
  throw outcome;
}

describe.skipIf(!hasDatabase)('Learning progress', () => {
  let server: TestApp;
  let db: Db;
  let courses: MemoryCourseVersions;
  let notices: MemoryNoticeStore;
  const unbind: (() => void)[] = [];

  beforeAll(async () => {
    server = await createTestApp();
    db = server.db;
    const memory = bindMemoryCourseVersions();
    const sent = bindMemoryNotices();
    ({ courses } = memory);
    notices = sent.store;
    unbind.push(memory.unbind, sent.unbind);
  });

  afterAll(async () => {
    for (const done of unbind) done();
    await server?.close();
  });

  beforeEach(() => {
    vi.mocked(canSeeCourse).mockImplementation(async () => true);
  });

  /** A sample course under a new id, published once in the workspace. */
  function newCourse(workspaceId: string, sample: Course = sampleMicrolearningCourse): Course {
    const course = { ...structuredClone(sample), id: `course-${randomUUID()}` };
    courses.publish(workspaceId, course);
    return course;
  }

  /** Publishes `course` as its next version, with the publish hook in the same transaction. */
  async function republish(
    workspaceId: string,
    course: Course,
    notify: PublishNotify,
    note?: string,
  ): Promise<number> {
    const version = courses.publish(workspaceId, course);
    const published = { workspaceId, courseId: course.id, version, notify, note };
    await db.transaction((tx) => onCoursePublished(tx, published));
    return version;
  }

  const send = (learner: progress.Actor, course: Course, list: object[]) =>
    progress.recordEvents(db, learner, course.id, list);
  const versionOf = (learner: progress.Actor, course: Course) =>
    progress.runVersion(db, { ...learner, courseId: course.id });
  const noticesFor = (learner: progress.Actor) =>
    notices.records.filter((record) => record.userId === learner.userId);
  const changesOf = (workspaceId: string, course: Course) =>
    db
      .select()
      .from(changes)
      .where(and(eq(changes.workspaceId, workspaceId), eq(changes.courseId, course.id)));

  it('pins a first batch to the live version and saves the state reports read', async () => {
    const {
      workspaceId,
      learners: [ada, bo],
    } = workspace(2);
    if (!ada || !bo) throw new Error('Two learners expected.');
    const course = newCourse(workspaceId);
    const batch = [opened(soon(-60)), event('time_active', { seconds: 45 })];
    const reply = await send(ada, course, batch);
    expect(reply.rejected).toEqual([]);
    expect(reply.state).toMatchObject({ status: 'in_progress', activeSeconds: 45 });
    // Sent again: stored once.
    expect((await send(ada, course, batch)).state.activeSeconds).toBe(45);
    expect(await versionOf(ada, course)).toBe(1);
    expect(await versionOf(bo, course)).toBeNull();
    expect((await progress.getProgress(db, bo, course.id)).status).toBe('not_started');

    expect(await progress.listCourseStates(db, { workspaceId, courseIds: [course.id] })).toEqual([
      {
        userId: ada.userId,
        courseId: course.id,
        status: 'in_progress',
        percentComplete: 0,
        startedAt: batch[0]?.at,
        completedAt: null,
        lastActivityAt: reply.state.lastActivityAt,
        score: null,
        activeSeconds: 45,
        attempts: 0,
        lastLessonId: LESSON,
        previousFinishedAt: null,
      },
    ]);
    expect(await progress.listCourseStates(db, { workspaceId, userIds: [bo.userId] })).toEqual([]);
    expect(await progress.listCourseStates(db, { workspaceId, userIds: [] })).toEqual([]);
    expect(await progress.listCourseStates(db, { workspaceId: randomUUID() })).toEqual([]);
  });

  it('measures each run against the version it started on', async () => {
    const {
      workspaceId,
      learners: [ada, bo],
    } = workspace(2);
    if (!ada || !bo) throw new Error('Two learners expected.');
    const course = newCourse(workspaceId);
    await send(ada, course, [opened()]);
    expect(courses.publish(workspaceId, withSecondLesson(course))).toBe(2);
    await send(bo, course, [opened()]);
    expect(await versionOf(ada, course)).toBe(1);
    expect(await versionOf(bo, course)).toBe(2);

    // Version 1 has one lesson, so Ada is done; Bo's version 2 has another.
    const ada1 = (await send(ada, course, [completed()])).state;
    expect(ada1).toMatchObject({ status: 'completed', percentComplete: 100 });
    expect(ada1.lessons).toHaveLength(1);
    const bo1 = (await send(bo, course, [completed()])).state;
    expect(bo1).toMatchObject({ status: 'in_progress', percentComplete: 50 });
    expect((await progress.getProgress(db, bo, course.id)).lessons).toHaveLength(2);
    const states = await progress.listCourseStates(db, { workspaceId, courseIds: [course.id] });
    expect(states.find((state) => state.userId === ada.userId)).toMatchObject({
      status: 'completed',
      completedAt: ada1.completedAt,
    });
  });

  it("refuses what a browser can't send and hides courses the learner can't see", async () => {
    const {
      workspaceId,
      learners: [ada],
    } = workspace(1);
    if (!ada) throw new Error('A learner expected.');
    const course = newCourse(workspaceId);
    const plan = { attemptId: 'attempt-1', seed: 7, questionIds: [], optionOrder: {} };
    const started = event('quiz_attempt_started', { plan });
    const ahead = opened(soon(10 * 60));
    const reply = await send(ada, course, [started, ahead]);
    expect(reply.rejected).toMatchObject([
      { eventId: started.id, reason: 'server_only' },
      { eventId: ahead.id, reason: 'future' },
    ]);
    expect(reply.state.status).toBe('not_started');
    expect((await progress.getProgress(db, ada, course.id)).status).toBe('not_started');

    expect((await failure(send(ada, { ...course, id: 'course-nowhere' }, [opened()]))).status).toBe(
      404,
    );
    vi.mocked(canSeeCourse).mockImplementation(async () => false);
    expect((await failure(progress.getProgress(db, ada, course.id))).status).toBe(404);
    expect((await failure(send(ada, course, [opened()]))).status).toBe(404);
  });
  it('moves runs in progress to a version published with "tell", with an alert', async () => {
    const {
      workspaceId,
      learners: [ada, bo, cy],
    } = workspace(3);
    if (!ada || !bo || !cy) throw new Error('Three learners expected.');
    const course = newCourse(workspaceId);
    await send(ada, course, [opened()]);
    await send(bo, course, [opened(), completed()]);
    // Refused (no such lesson), so nothing counts yet.
    await send(cy, course, [opened(soon(-30), 'not-a-lesson')]);
    const next = withSecondLesson(course);
    expect(await republish(workspaceId, next, 'tell', 'Now with hold music.')).toBe(2);

    expect(await versionOf(ada, course)).toBe(2);
    expect((await progress.getProgress(db, ada, course.id)).lessons).toHaveLength(2);
    expect(noticesFor(ada)).toMatchObject([
      {
        kind: 'alert',
        title: 'Course updated',
        buttons: [{ label: 'Open course', href: `/learning/courses/${course.id}` }],
      },
    ]);
    expect(noticesFor(ada)[0]?.text).toContain('Now with hold music.');
    // Finished: keeps its version and result, and hears nothing.
    expect(await versionOf(bo, course)).toBe(1);
    const finished = await progress.getProgress(db, bo, course.id);
    expect(finished).toMatchObject({ status: 'completed', percentComplete: 100 });
    expect(finished.lessons).toHaveLength(1);
    expect(noticesFor(bo)).toEqual([]);
    // Nothing counted yet: moves quietly.
    expect(await versionOf(cy, course)).toBe(2);
    expect(noticesFor(cy)).toEqual([]);
  });

  it('starts everyone who started over on a version published with "retake"', async () => {
    const {
      workspaceId,
      learners: [ada, bo, cy],
    } = workspace(3);
    if (!ada || !bo || !cy) throw new Error('Three learners expected.');
    const course = newCourse(workspaceId);
    await send(ada, course, [opened()]);
    const finished = (await send(bo, course, [opened(), completed()])).state.completedAt;
    expect(finished).not.toBeNull();
    vi.mocked(canSeeCourse).mockImplementation(async (userId: string) => userId !== bo.userId);
    await republish(workspaceId, withSecondLesson(course), 'retake', 'Please take it again.');
    // Only the notice depends on it: Bo can see the course again, so his new run can be read.
    vi.mocked(canSeeCourse).mockImplementation(async () => true);

    for (const learner of [ada, bo]) {
      expect(await versionOf(learner, course)).toBe(2);
      const state = await progress.getProgress(db, learner, course.id);
      expect(state).toMatchObject({ status: 'not_started', completedAt: null });
      expect(state.lessons).toHaveLength(2);
    }
    expect(await versionOf(cy, course)).toBeNull();
    expect(noticesFor(ada)).toMatchObject([
      { kind: 'reminder', title: 'Please take this course again' },
    ]);
    // Someone who can't see the course any more isn't sent its title.
    expect(noticesFor(bo)).toEqual([]);
    const retakes = (await changesOf(workspaceId, course)).map((change) => [
      change.learnerId,
      change.kind,
      change.run,
      change.changedBy,
      change.note,
    ]);
    expect(retakes).toHaveLength(2);
    expect(retakes).toEqual(
      expect.arrayContaining([
        [ada.userId, 'retake', 2, null, 'Please take it again.'],
        [bo.userId, 'retake', 2, null, 'Please take it again.'],
      ]),
    );

    // An event that waited offline from before the retake doesn't count in the new run.
    const late = await send(ada, course, [opened(soon(-3600))]);
    expect(late.rejected).toMatchObject([{ reason: 'restarted' }]);
    expect(late.state.status).toBe('not_started');
    // Bo's earlier finish stays on record for assignments; Ada never finished.
    const states = await progress.listCourseStates(db, { workspaceId, courseIds: [course.id] });
    expect(states.find((state) => state.userId === bo.userId)).toMatchObject({
      status: 'not_started',
      completedAt: null,
      percentComplete: 0,
      previousFinishedAt: finished,
    });
    expect(states.find((state) => state.userId === ada.userId)?.previousFinishedAt).toBeNull();
  });

  it('keeps runs on their version after "none", until a reset', async () => {
    const {
      workspaceId,
      trainer,
      learners: [ada],
    } = workspace(1);
    if (!ada) throw new Error('A learner expected.');
    const course = newCourse(workspaceId);
    await send(ada, course, [opened()]);
    await republish(workspaceId, withSecondLesson(course), 'none');
    expect(await versionOf(ada, course)).toBe(1);
    // Measured against version 1, where this was the only lesson.
    const done = (await send(ada, course, [completed()])).state;
    expect(done).toMatchObject({ status: 'completed', percentComplete: 100 });
    expect(noticesFor(ada)).toEqual([]);

    const reset = await progress.resetProgress(db, trainer, ada.userId, course.id, 'Mixed up.');
    expect(reset).toMatchObject({ status: 'not_started' });
    expect(reset.lessons).toHaveLength(2);
    expect(await versionOf(ada, course)).toBe(2);
    const resets = (await changesOf(workspaceId, course)).map((change) => [
      change.kind,
      change.run,
      change.changedBy,
      change.note,
    ]);
    expect(resets).toEqual([['reset', 2, trainer.userId, 'Mixed up.']]);
    expect(
      await progress.listCourseStates(db, { workspaceId, userIds: [ada.userId] }),
    ).toMatchObject([
      { status: 'not_started', completedAt: null, previousFinishedAt: done.completedAt },
    ]);
  });

  it('marks a run complete by hand, keeping the first date', async () => {
    const {
      workspaceId,
      trainer,
      learners: [bo],
    } = workspace(1);
    if (!bo) throw new Error('A learner expected.');
    const course = newCourse(workspaceId);
    // Nothing to reset for someone who never started.
    expect(await progress.resetProgress(db, trainer, bo.userId, course.id)).toMatchObject({
      status: 'not_started',
    });
    expect(await versionOf(bo, course)).toBeNull();

    const at = new Date(Date.now() - 60_000);
    const done = await progress.completeProgress(
      db,
      trainer,
      bo.userId,
      course.id,
      'On paper.',
      at,
    );
    expect(done).toMatchObject({ status: 'completed', completedAt: at.toISOString() });
    const again = await progress.completeProgress(db, trainer, bo.userId, course.id);
    expect(again.completedAt).toBe(at.toISOString());
    expect((await progress.getProgress(db, bo, course.id)).completedAt).toBe(at.toISOString());
    expect(
      await progress.listCourseStates(db, { workspaceId, userIds: [bo.userId] }),
    ).toMatchObject([
      {
        status: 'completed',
        completedAt: at.toISOString(),
        percentComplete: 100,
        previousFinishedAt: null,
      },
    ]);
    const marks = (await changesOf(workspaceId, course)).map((change) => [
      change.learnerId,
      change.kind,
      change.run,
      change.changedBy,
      change.note,
    ]);
    expect(marks).toEqual([[bo.userId, 'complete', 1, trainer.userId, 'On paper.']]);
    expect(
      (await failure(progress.completeProgress(db, trainer, bo.userId, 'nowhere'))).status,
    ).toBe(404);
  });

  it('issues a certificate when a run finishes in a course that gives one', async () => {
    const {
      workspaceId,
      trainer,
      learners: [ada, bo],
    } = workspace(2);
    if (!ada || !bo) throw new Error('Two learners expected.');
    const { settings } = sampleMicrolearningCourse;
    const course = newCourse(workspaceId, {
      ...sampleMicrolearningCourse,
      settings: { ...settings, certificate: { enabled: true, validForMonths: 12 } },
    });
    const certificatesOf = (learner: progress.Actor) =>
      listCertificates(db, { ...learner, can: () => false }, {});

    await send(ada, course, [opened()]);
    expect(await certificatesOf(ada)).toEqual([]);
    const { state } = await send(ada, course, [completed()]);
    expect(state.status).toBe('completed');
    // More events after the finish don't earn another.
    await send(ada, course, [event('time_active', { seconds: 20 })]);
    expect(await certificatesOf(ada)).toMatchObject([
      { courseId: course.id, courseVersion: 1, completedAt: state.completedAt, status: 'valid' },
    ]);

    // A completion marked by hand earns it too.
    const at = new Date(Date.now() - 60_000);
    await progress.completeProgress(db, trainer, bo.userId, course.id, undefined, at);
    expect(await certificatesOf(bo)).toMatchObject([{ completedAt: at.toISOString() }]);
  });

  it('starts quiz attempts on the server and sends papers without answers', async () => {
    const {
      workspaceId,
      learners: [ada],
    } = workspace(1);
    if (!ada) throw new Error('A learner expected.');
    // Privacy basics: a content lesson, then a graded quiz that opens once the lesson is done.
    const course = newCourse(workspaceId, sampleRequiredReadCourse);
    const quiz = 'privacy-quiz';
    const start = (lessonId = quiz, at = soon()) =>
      progress.startQuizAttempt(db, ada, course.id, { lessonId, at });

    expect(await failure(start())).toMatchObject({ status: 409, code: 'locked' });
    await send(ada, course, [opened(soon(-30), 'privacy-rules'), completed('privacy-rules')]);
    expect(await failure(start(quiz, soon(10 * 60)))).toMatchObject({
      status: 409,
      code: 'future',
    });
    expect((await failure(start('privacy-rules'))).status).toBe(404);
    expect((await failure(start('not-a-lesson'))).status).toBe(404);

    const paper = await start();
    expect(paper.questions.map((question) => question.id)).toEqual([
      'privacy-q-neighbour',
      'privacy-q-check',
      'privacy-q-blank',
    ]);
    // Nothing on the paper gives an answer away (decision 0302).
    expect(JSON.stringify(paper)).not.toMatch(/"(correct|answer|answers)"/);
    // A reload gets the same attempt and paper.
    expect(await start()).toEqual(paper);
    const open = (await progress.getProgress(db, ada, course.id)).quizzes[0]?.openAttempt;
    expect(open?.plan.attemptId).toBe(paper.attemptId);

    // The browser sends the answers; the server scores them on the plan it made.
    const submitted = event('quiz_attempt_submitted', {
      lessonId: quiz,
      attemptId: paper.attemptId,
      responses: {
        'privacy-q-neighbour': { type: 'true_false', value: false },
        'privacy-q-check': { type: 'multiple_choice', optionIds: ['dob', 'postcode'] },
        'privacy-q-blank': { type: 'fill_blank', blanks: { consent: 'consent' } },
      },
    });
    const { state, rejected } = await send(ada, course, [submitted]);
    expect(rejected).toEqual([]);
    expect(state.quizzes[0]).toMatchObject({ passed: true, bestPercent: 100, openAttempt: null });
    expect(state.score).toBe(100);
    const [row] = await progress.listCourseStates(db, { workspaceId, userIds: [ada.userId] });
    expect(row).toMatchObject({ attempts: 1, score: 100 });
  });
});
