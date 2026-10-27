import { randomUUID } from 'node:crypto';
import { sampleMicrolearningCourse, type Course } from '@carehub/learning';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../../db';
import { createTestApp, hasDatabase, type TestApp } from '../../../testing';
import { canSeeCourse } from '../courses/access';
import { LearningError } from '../errors';
import * as progress from './service';
import { bindMemoryCourseVersions, type MemoryCourseVersions } from './testing';

vi.mock('../courses/access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../courses/access')>()),
  canSeeCourse: vi.fn(async () => true),
}));

// Fictional people and courses only: the microlearning sample, with one content lesson.
const LESSON = 'hold-lesson';

/** Learners in a workspace of their own, so each test starts empty. */
function workspace(size: number) {
  const workspaceId = randomUUID();
  const person = (): progress.Actor => ({ userId: randomUUID(), workspaceId });
  return { workspaceId, learners: Array.from({ length: size }, person) };
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
  let courses: MemoryCourseVersions;
  let unbind: () => void;

  beforeAll(async () => {
    server = await createTestApp();
    db = server.db;
    ({ courses, unbind } = bindMemoryCourseVersions());
  });

  afterAll(async () => {
    unbind?.();
    await server?.close();
  });

  beforeEach(() => {
    vi.mocked(canSeeCourse).mockImplementation(async () => true);
  });

  /** The sample course under a new id, published once in the workspace. */
  function newCourse(workspaceId: string): Course {
    const course = { ...structuredClone(sampleMicrolearningCourse), id: `course-${randomUUID()}` };
    courses.publish(workspaceId, course);
    return course;
  }

  const send = (learner: progress.Actor, course: Course, list: object[]) =>
    progress.recordEvents(db, learner, course.id, list);
  const versionOf = (learner: progress.Actor, course: Course) =>
    progress.runVersion(db, { ...learner, courseId: course.id });

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
});
