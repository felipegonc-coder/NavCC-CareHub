import { randomUUID } from 'node:crypto';
import { sampleMicrolearningCourse, type Course, type PublishNotify } from '@carehub/learning';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../../db';
import { createTestApp, hasDatabase, type TestApp } from '../../../testing';
import { bindMemoryNotices, type MemoryNoticeStore } from '../../notices/testing';
import { listCertificates } from '../certificates/service';
import { canSeeCourse } from '../courses/access';
import * as courses from '../courses/service';
import { LearningError } from '../errors';
import { learningProgressChanges as changes } from './schema';
import * as progress from './service';

vi.mock('../courses/access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../courses/access')>()),
  canSeeCourse: vi.fn(async () => true),
}));

// Fictional people and courses only: the microlearning sample, with one content lesson.
const LESSON = 'hold-lesson';

/** A trainer and learners in a workspace of their own, so each test starts empty. */
function workspace(size: number) {
  const workspaceId = randomUUID();
  const person = (): courses.Actor => ({ userId: randomUUID(), workspaceId });
  return { trainer: person(), learners: Array.from({ length: size }, person) };
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
const opened = (at = soon(-30)) => event('lesson_opened', {}, at);
const completed = () => event('lesson_completed');

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
  let notices: MemoryNoticeStore;
  let unbind: () => void;

  beforeAll(async () => {
    server = await createTestApp();
    db = server.db;
    ({ store: notices, unbind } = bindMemoryNotices());
  });

  afterAll(async () => {
    unbind?.();
    await server?.close();
  });

  beforeEach(() => {
    vi.mocked(canSeeCourse).mockImplementation(async () => true);
  });

  /** A new course with the sample's content (changed by `edit`), published once. */
  async function newCourse(
    trainer: courses.Actor,
    edit: (course: Course) => Course = (course) => course,
  ): Promise<Course> {
    const blank = await courses.createStudioCourse(db, trainer, { type: 'microlearning' });
    const course = edit({ ...structuredClone(sampleMicrolearningCourse), id: blank.course.id });
    await courses.saveDraft(db, trainer, course.id, { course, revision: blank.revision });
    await courses.publishCourse(db, trainer, course.id, { notify: 'none' });
    return course;
  }

  /** Saves `course` as the draft and publishes it as the next version. */
  async function republish(
    trainer: courses.Actor,
    course: Course,
    notify: PublishNotify,
    note?: string,
  ) {
    const { revision } = await courses.getStudioCourse(db, trainer, course.id);
    await courses.saveDraft(db, trainer, course.id, { course, revision });
    return courses.publishCourse(db, trainer, course.id, { notify, note });
  }

  const send = (learner: courses.Actor, course: Course, events: object[]) =>
    progress.recordEvents(db, learner, course.id, events);
  const versionOf = (learner: courses.Actor, course: Course) =>
    progress.runVersion(db, { ...learner, courseId: course.id });
  const noticesFor = (learner: courses.Actor) =>
    notices.records.filter((record) => record.userId === learner.userId);
  const changesOf = (trainer: courses.Actor, course: Course) =>
    db
      .select()
      .from(changes)
      .where(and(eq(changes.workspaceId, trainer.workspaceId), eq(changes.courseId, course.id)));

  it('pins a first batch to the live version and saves the state reports read', async () => {
    const {
      trainer,
      learners: [ada, bo],
    } = workspace(2);
    if (!ada || !bo) throw new Error('Two learners expected.');
    const course = await newCourse(trainer);
    const batch = [opened(soon(-60)), event('time_active', { seconds: 45 })];
    const reply = await send(ada, course, batch);
    expect(reply.rejected).toEqual([]);
    expect(reply.state).toMatchObject({ status: 'in_progress', activeSeconds: 45 });
    expect((await send(ada, course, batch)).state.activeSeconds).toBe(45);
    expect(await versionOf(ada, course)).toBe(1);
    expect(await versionOf(bo, course)).toBeNull();
    expect((await progress.getProgress(db, bo, course.id)).status).toBe('not_started');

    const { workspaceId } = trainer;
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
    expect(await progress.listCourseStates(db, { workspaceId, userIds: [] })).toEqual([]);
    expect(await progress.listCourseStates(db, { workspaceId: randomUUID() })).toEqual([]);
    expect((await failure(send(ada, { ...course, id: 'course-nowhere' }, batch))).status).toBe(404);
  });

  it('moves runs in progress to a version published with "tell", with an alert', async () => {
    const {
      trainer,
      learners: [ada, bo, cy],
    } = workspace(3);
    if (!ada || !bo || !cy) throw new Error('Three learners expected.');
    const course = await newCourse(trainer);
    await send(ada, course, [opened()]);
    await send(bo, course, [opened(), completed()]);
    // Refused (no such lesson), so nothing counts yet.
    await send(cy, course, [{ ...opened(), lessonId: 'not-a-lesson' }]);
    const next = withSecondLesson(course);
    expect(await republish(trainer, next, 'tell', 'Now with hold music.')).toEqual({ version: 2 });

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
    // Not started: moves quietly.
    expect(await versionOf(cy, course)).toBe(2);
    expect(noticesFor(cy)).toEqual([]);
  });

  it('starts everyone who started over on a version published with "retake"', async () => {
    const {
      trainer,
      learners: [ada, bo, cy],
    } = workspace(3);
    if (!ada || !bo || !cy) throw new Error('Three learners expected.');
    const course = await newCourse(trainer);
    await send(ada, course, [opened()]);
    const finished = (await send(bo, course, [opened(), completed()])).state.completedAt;
    expect(finished).not.toBeNull();
    vi.mocked(canSeeCourse).mockImplementation(async (userId: string) => userId !== bo.userId);
    await republish(trainer, withSecondLesson(course), 'retake', 'Please take it again.');

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
    const retakes = (await changesOf(trainer, course)).map((change) => [
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
    const { workspaceId } = trainer;
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
      trainer,
      learners: [ada],
    } = workspace(1);
    if (!ada) throw new Error('A learner expected.');
    const course = await newCourse(trainer);
    await send(ada, course, [opened()]);
    await republish(trainer, withSecondLesson(course), 'none');
    expect(await versionOf(ada, course)).toBe(1);
    // Measured against version 1, where this was the only lesson.
    const done = (await send(ada, course, [completed()])).state;
    expect(done).toMatchObject({ status: 'completed', percentComplete: 100 });
    expect(noticesFor(ada)).toEqual([]);

    const reset = await progress.resetProgress(db, trainer, ada.userId, course.id, 'Mixed up.');
    expect(reset).toMatchObject({ status: 'not_started' });
    expect(reset.lessons).toHaveLength(2);
    expect(await versionOf(ada, course)).toBe(2);
    expect((await changesOf(trainer, course)).map((change) => change.kind)).toEqual(['reset']);
    const { workspaceId } = trainer;
    expect(
      await progress.listCourseStates(db, { workspaceId, userIds: [ada.userId] }),
    ).toMatchObject([
      { status: 'not_started', completedAt: null, previousFinishedAt: done.completedAt },
    ]);
  });

  it('marks a run complete by hand, keeping the first date', async () => {
    const {
      trainer,
      learners: [ada, bo],
    } = workspace(2);
    if (!ada || !bo) throw new Error('Two learners expected.');
    const course = await newCourse(trainer);
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
    const { workspaceId } = trainer;
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
    const marks = (await changesOf(trainer, course)).map((change) => [
      change.learnerId,
      change.kind,
      change.run,
      change.changedBy,
      change.note,
    ]);
    expect(marks).toEqual([[bo.userId, 'complete', 1, trainer.userId, 'On paper.']]);
  });

  it('issues a certificate when a run finishes in a course that gives one', async () => {
    const {
      trainer,
      learners: [ada, bo],
    } = workspace(2);
    if (!ada || !bo) throw new Error('Two learners expected.');
    const course = await newCourse(trainer, (sample) => ({
      ...sample,
      settings: { ...sample.settings, certificate: { enabled: true, validForMonths: 12 } },
    }));
    const certificatesOf = (learner: courses.Actor) =>
      listCertificates(db, { ...learner, can: () => false }, {});

    await send(ada, course, [opened()]);
    expect(await certificatesOf(ada)).toEqual([]);
    const { state } = await send(ada, course, [completed()]);
    expect(state.status).toBe('completed');
    await send(ada, course, [event('time_active', { seconds: 20 })]);
    expect(await certificatesOf(ada)).toMatchObject([
      { courseId: course.id, courseVersion: 1, completedAt: state.completedAt, status: 'valid' },
    ]);

    // A completion marked by hand earns it too.
    const at = new Date(Date.now() - 60_000);
    await progress.completeProgress(db, trainer, bo.userId, course.id, undefined, at);
    expect(await certificatesOf(bo)).toMatchObject([{ completedAt: at.toISOString() }]);
  });
});
