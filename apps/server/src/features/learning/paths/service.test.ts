import { randomUUID } from 'node:crypto';
import {
  LEARNING_PATH_FORMAT_VERSION,
  sampleMicrolearningCourse,
  type Course,
} from '@carehub/learning';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../../db';
import { createTestApp, hasDatabase, type TestApp } from '../../../testing';
import { syncPathAssignments } from '../assignments';
import { canSeeCourse } from '../courses/access';
import { LearningError } from '../errors';
import { onCoursePublished } from '../progress/on-publish';
import { completeProgress } from '../progress/service';
import { bindMemoryCourseVersions, type MemoryCourseVersions } from '../progress/testing';
import * as paths from './service';

vi.mock('../assignments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../assignments')>()),
  syncPathAssignments: vi.fn(async () => {}),
}));
vi.mock('../courses/access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../courses/access')>()),
  canSeeCourse: vi.fn(async () => true),
}));

// Fictional people and courses only.

/** A trainer and a learner in a workspace of their own, so each test starts empty. */
function workspace() {
  const workspaceId = randomUUID();
  const person = (): paths.Actor => ({ userId: randomUUID(), workspaceId });
  return { workspaceId, trainer: person(), learner: person() };
}

async function failure(call: Promise<unknown>): Promise<LearningError> {
  const outcome = await call.then(
    () => new Error('Expected the call to fail.'),
    (error: unknown) => error,
  );
  if (outcome instanceof LearningError) return outcome;
  throw outcome;
}

/** The workspace ids and course ids `syncPathAssignments` was called with, per path id. */
function syncedPaths() {
  return vi
    .mocked(syncPathAssignments)
    .mock.calls.map(([, workspaceId, pathId, courseIds]) => ({ workspaceId, pathId, courseIds }));
}

describe.skipIf(!hasDatabase)('Learning paths', () => {
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
    vi.mocked(syncPathAssignments).mockClear();
    vi.mocked(canSeeCourse).mockImplementation(async () => true);
  });

  /** The microlearning sample under a new id and title, published once unless `live` is false. */
  function newCourse(workspaceId: string, title: string, live = true): Course {
    const course = {
      ...structuredClone(sampleMicrolearningCourse),
      id: `c-${randomUUID()}`,
      title,
    };
    if (live) courses.publish(workspaceId, course);
    return course;
  }

  it('creates, lists, saves and deletes paths in Studio', async () => {
    const { workspaceId, trainer } = workspace();
    const [a, b, c] = ['Greeting callers', 'Hold etiquette', 'Closing calls'].map((title) =>
      newCourse(workspaceId, title),
    );
    if (!a || !b || !c) throw new Error('Three courses expected.');

    const made = await paths.createPath(db, trainer, {
      title: 'New agent basics',
      courseIds: [a.id, b.id],
      order: 'sequential',
    });
    expect(made).toEqual({
      formatVersion: LEARNING_PATH_FORMAT_VERSION,
      id: expect.stringMatching(/^path-/),
      title: 'New agent basics',
      courseIds: [a.id, b.id],
      order: 'sequential',
    });
    const empty = await paths.createPath(db, trainer, {
      title: 'Empty for now',
      description: 'Courses come later.',
      courseIds: [],
      order: 'free',
    });
    expect(await paths.getPath(db, workspaceId, empty.id)).toEqual(empty);
    expect(syncedPaths()).toEqual([]);

    // Renaming leaves the assignments alone; changing the courses brings them in step.
    const minutesOn = (minutes: number) => new Date(Date.now() + minutes * 60_000);
    const renamed = { ...made, title: 'Agent basics' };
    await paths.savePath(db, trainer, made.id, renamed, minutesOn(1));
    expect(syncedPaths()).toEqual([]);
    const changed = { ...renamed, courseIds: [c.id, a.id], order: 'free' as const };
    const saved = await paths.savePath(db, trainer, made.id, changed, minutesOn(2));
    expect(saved).toMatchObject({ title: 'Agent basics', courseIds: [c.id, a.id], order: 'free' });
    expect(syncedPaths()).toEqual([{ workspaceId, pathId: made.id, courseIds: [c.id, a.id] }]);
    expect(await paths.pathCourseIds(db, workspaceId, made.id)).toEqual([c.id, a.id]);
    expect(await paths.listPaths(db, workspaceId)).toMatchObject([
      { id: made.id, title: 'Agent basics', courseCount: 2, order: 'free' },
      { id: empty.id, title: 'Empty for now', courseCount: 0, order: 'free' },
    ]);

    // Another workspace sees none of it.
    const other = workspace();
    expect(await paths.listPaths(db, other.workspaceId)).toEqual([]);
    expect(await failure(paths.getPath(db, other.workspaceId, made.id))).toMatchObject({
      status: 404,
    });
    expect(await failure(paths.savePath(db, other.trainer, made.id, saved))).toMatchObject({
      status: 404,
    });
    expect(await failure(paths.deletePath(db, other.workspaceId, made.id))).toMatchObject({
      status: 404,
    });
    // A body naming another path is refused.
    const moved = paths.savePath(db, trainer, made.id, { ...saved, id: empty.id });
    expect(await failure(moved)).toMatchObject({ status: 400, issues: [{ path: 'id' }] });

    vi.mocked(syncPathAssignments).mockClear();
    await paths.deletePath(db, workspaceId, made.id);
    expect(syncedPaths()).toEqual([{ workspaceId, pathId: made.id, courseIds: [] }]);
    expect(await failure(paths.getPath(db, workspaceId, made.id))).toMatchObject({ status: 404 });
    expect(await paths.pathCourseIds(db, workspaceId, made.id)).toBeNull();
    expect((await paths.listPaths(db, workspaceId)).map((path) => path.id)).toEqual([empty.id]);
  });

  it('shows learners only the courses they can open, with their progress', async () => {
    const { workspaceId, trainer, learner } = workspace();
    const greeting = newCourse(workspaceId, 'Greeting callers');
    const hidden = newCourse(workspaceId, 'Supervisor escalations');
    const draft = newCourse(workspaceId, 'Billing questions', false);
    const closing = newCourse(workspaceId, 'Closing calls');
    vi.mocked(canSeeCourse).mockImplementation(async (_userId, courseId) => courseId !== hidden.id);
    const path = await paths.createPath(db, trainer, {
      title: 'New agent basics',
      courseIds: [greeting.id, hidden.id, draft.id, closing.id],
      order: 'sequential',
    });

    const page = await paths.getPathPage(db, learner, path.id);
    expect(page.path).toMatchObject({ id: path.id, courseIds: [greeting.id, closing.id] });
    expect(page.courses).toEqual([
      expect.objectContaining({ id: greeting.id, status: 'not_started', locked: false }),
      expect.objectContaining({ id: closing.id, status: 'not_started', locked: true }),
    ]);
    expect(page.progress).toMatchObject({ completed: 0, total: 2, nextCourseId: greeting.id });
    expect(JSON.stringify(page)).not.toContain('Supervisor escalations');
    expect(JSON.stringify(page)).not.toContain('Billing questions');

    await completeProgress(db, trainer, learner.userId, greeting.id);
    const after = await paths.getPathPage(db, learner, path.id);
    expect(after.courses.map((course) => [course.status, course.locked])).toEqual([
      ['completed', false],
      ['not_started', false],
    ]);
    expect(after.progress).toMatchObject({
      completed: 1,
      total: 2,
      percent: 50,
      nextCourseId: closing.id,
      status: 'in_progress',
    });
    expect(await failure(paths.getPathPage(db, learner, 'path-unknown'))).toMatchObject({
      status: 404,
    });
  });

  it('brings the assignments of the paths holding a course in step on publish', async () => {
    const { workspaceId, trainer } = workspace();
    const greeting = newCourse(workspaceId, 'Greeting callers');
    const closing = newCourse(workspaceId, 'Closing calls', false);
    const basics = await paths.createPath(db, trainer, {
      title: 'New agent basics',
      courseIds: [greeting.id, closing.id],
      order: 'sequential',
    });
    await paths.createPath(db, trainer, {
      title: 'Greetings only',
      courseIds: [greeting.id],
      order: 'free',
    });

    const version = courses.publish(workspaceId, closing);
    await db.transaction((tx) =>
      onCoursePublished(tx, { workspaceId, courseId: closing.id, version, notify: 'none' }),
    );
    expect(syncedPaths()).toEqual([
      { workspaceId, pathId: basics.id, courseIds: [greeting.id, closing.id] },
    ]);
  });
});
