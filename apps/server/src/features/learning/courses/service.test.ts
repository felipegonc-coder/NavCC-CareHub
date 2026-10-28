import { randomUUID } from 'node:crypto';
import { learnerCourse, sampleCourses, sampleStandardCourse, type Course } from '@carehub/learning';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../../db';
import { createTestApp, hasDatabase, type TestApp } from '../../../testing';
import { LearningError } from '../errors';
import { onCoursePublished } from '../progress/on-publish';
import { runVersion } from '../progress/run-version';
import { learningCourses, learningCourseVersions } from './schema';
import * as courses from './service';

vi.mock('../progress/on-publish', () => ({ onCoursePublished: vi.fn(async () => {}) }));
vi.mock('../progress/run-version', () => ({ runVersion: vi.fn(async () => null) }));

/** Someone in a workspace of their own, so each test starts empty. */
const someone = (): courses.Actor => ({ userId: randomUUID(), workspaceId: randomUUID() });

async function failure(call: Promise<unknown>): Promise<LearningError> {
  const outcome = await call.then(
    () => new Error('Expected the call to fail.'),
    (error: unknown) => error,
  );
  if (outcome instanceof LearningError) return outcome;
  throw outcome;
}

describe.skipIf(!hasDatabase)('Learning courses', () => {
  let server: TestApp;
  let db: Db;

  beforeAll(async () => {
    server = await createTestApp();
    db = server.db;
  });

  afterAll(async () => {
    await server?.close();
  });

  /** A saved draft with a publishable sample course in it. */
  async function sampleDraft(actor: courses.Actor, sample: Course = sampleStandardCourse) {
    const blank = await courses.createStudioCourse(db, actor, { type: sample.type });
    const course: Course = { ...structuredClone(sample), id: blank.course.id };
    const saved = await courses.saveDraft(db, actor, course.id, {
      course,
      revision: blank.revision,
    });
    return { course, revision: saved.revision };
  }

  const summary = async (actor: courses.Actor) =>
    (await courses.listStudioCourses(db, actor, { archived: false }))[0];

  it('creates a blank draft with its preset, seen only in its own workspace', async () => {
    const actor = someone();
    const created = await courses.createStudioCourse(db, actor, {
      type: 'certification',
      title: '  ',
    });
    expect(created).toMatchObject({ revision: 1, liveVersion: null });
    expect(created.course).toMatchObject({
      title: 'Untitled course',
      type: 'certification',
      lessons: [],
    });
    expect(await courses.getStudioCourse(db, actor, created.course.id)).toEqual(created);
    expect(await courses.listStudioCourses(db, actor, { archived: false })).toEqual([
      {
        id: created.course.id,
        title: 'Untitled course',
        type: 'certification',
        state: 'draft',
        version: null,
        updatedAt: expect.any(String),
        archived: false,
        listed: true,
      },
    ]);

    const outsider = someone();
    expect(await failure(courses.getStudioCourse(db, outsider, created.course.id))).toMatchObject({
      status: 404,
      code: 'not_found',
    });
    expect(await courses.listStudioCourses(db, outsider, { archived: false })).toEqual([]);
  });

  it('lists archived courses apart, most recently changed first', async () => {
    const actor = someone();
    const first = await courses.createStudioCourse(db, actor, { type: 'standard', title: 'First' });
    const second = await courses.createStudioCourse(db, actor, {
      type: 'standard',
      title: 'Second',
    });
    const third = await courses.createStudioCourse(db, actor, { type: 'standard', title: 'Third' });
    const ids = async (archived: boolean) =>
      (await courses.listStudioCourses(db, actor, { archived })).map((course) => course.id);
    expect(await ids(false)).toEqual([third.course.id, second.course.id, first.course.id]);

    await courses.saveDraft(db, actor, first.course.id, { course: first.course, revision: 1 });
    await db
      .update(learningCourses)
      .set({ archived: true })
      .where(
        and(
          eq(learningCourses.workspaceId, actor.workspaceId),
          eq(learningCourses.id, second.course.id),
        ),
      );
    expect(await ids(false)).toEqual([first.course.id, third.course.id]);
    expect(await ids(true)).toEqual([second.course.id]);
  });

  it('saves a draft only from the latest revision, and only a valid course', async () => {
    const actor = someone();
    const { course, revision } = await courses.createStudioCourse(db, actor, { type: 'standard' });
    const renamed = { ...course, title: 'Escalation basics' };
    expect(await courses.saveDraft(db, actor, course.id, { course: renamed, revision })).toEqual({
      revision: 2,
    });
    expect(await courses.getStudioCourse(db, actor, course.id)).toEqual({
      course: renamed,
      revision: 2,
      liveVersion: null,
    });

    const stale = await failure(courses.saveDraft(db, actor, course.id, { course, revision }));
    expect(stale).toMatchObject({ status: 409, code: 'conflict' });

    const invalid = await failure(
      courses.saveDraft(db, actor, course.id, { course: { ...renamed, title: '' }, revision: 2 }),
    );
    expect(invalid).toMatchObject({ status: 400, code: 'invalid' });
    expect(invalid.issues?.map((issue) => issue.path)).toEqual(['title']);

    const moved = await failure(
      courses.saveDraft(db, actor, course.id, {
        course: { ...renamed, id: 'elsewhere' },
        revision: 2,
      }),
    );
    expect(moved).toMatchObject({ status: 400, issues: [{ path: 'id' }] });

    const unknown = { ...renamed, id: 'no-such-course' };
    expect(
      await failure(courses.saveDraft(db, actor, unknown.id, { course: unknown, revision: 1 })),
    ).toMatchObject({ status: 404 });
    expect(await courses.getStudioCourse(db, actor, course.id)).toMatchObject({ revision: 2 });
  });

  it('refuses to publish a draft with problems, and lists them', async () => {
    const actor = someone();
    const { course } = await courses.createStudioCourse(db, actor, { type: 'standard' });
    const refused = await failure(courses.publishCourse(db, actor, course.id, { notify: 'none' }));
    expect(refused).toMatchObject({ status: 422, code: 'cannot_publish' });
    expect(refused.message).toMatch(/^Fix (this problem|these \d+ problems) before publishing\.$/);
    expect(refused.issues?.length).toBeGreaterThan(0);
    expect(await courses.getStudioCourse(db, actor, course.id)).toMatchObject({
      liveVersion: null,
    });
    expect(await courses.listVersions(db, actor, course.id)).toEqual([]);
    expect(await courses.getLiveCourse(db, actor.workspaceId, course.id)).toBeNull();
  });

  it('publishes numbered versions; learners keep the live one while the draft changes', async () => {
    const actor = someone();
    const { course, revision } = await sampleDraft(actor);
    expect(await summary(actor)).toMatchObject({ state: 'draft', version: null });

    vi.mocked(onCoursePublished).mockClear();
    expect(
      await courses.publishCourse(db, actor, course.id, { notify: 'tell', note: 'New intro' }),
    ).toEqual({ version: 1 });
    expect(onCoursePublished).toHaveBeenCalledWith(expect.anything(), {
      workspaceId: actor.workspaceId,
      courseId: course.id,
      version: 1,
      notify: 'tell',
      note: 'New intro',
    });
    expect(await summary(actor)).toMatchObject({ state: 'live', version: 1 });
    expect(await courses.getLiveCourse(db, actor.workspaceId, course.id)).toEqual({
      course,
      version: 1,
    });

    const edited = { ...course, title: 'Calls, again' };
    await courses.saveDraft(db, actor, course.id, { course: edited, revision });
    expect(await summary(actor)).toMatchObject({
      state: 'changed',
      version: 1,
      title: edited.title,
    });
    expect((await courses.getLiveCourse(db, actor.workspaceId, course.id))?.course).toEqual(course);

    expect(await courses.publishCourse(db, actor, course.id, { notify: 'none' })).toEqual({
      version: 2,
    });
    expect(await summary(actor)).toMatchObject({ state: 'live', version: 2 });
    expect(await courses.getLiveCourse(db, actor.workspaceId, course.id)).toEqual({
      course: edited,
      version: 2,
    });
    const published = { publishedAt: expect.any(String), publishedBy: actor.userId };
    expect(await courses.listVersions(db, actor, course.id)).toEqual([
      { version: 2, notify: 'none', ...published },
      { version: 1, notify: 'tell', note: 'New intro', ...published },
    ]);
    expect(await courses.getLiveCourse(db, someone().workspaceId, course.id)).toBeNull();
  });

  it('publishes nothing when updating learners fails in the same transaction', async () => {
    const actor = someone();
    const { course } = await sampleDraft(actor);
    vi.mocked(onCoursePublished).mockRejectedValueOnce(new Error('Progress was not updated.'));
    await expect(courses.publishCourse(db, actor, course.id, { notify: 'retake' })).rejects.toThrow(
      'Progress was not updated.',
    );
    expect(await courses.getStudioCourse(db, actor, course.id)).toMatchObject({
      liveVersion: null,
    });
    expect(await courses.listVersions(db, actor, course.id)).toEqual([]);
  });

  it('answers 409 when someone else published that version first', async () => {
    const actor = someone();
    const { course } = await sampleDraft(actor);
    // As if another publish wrote version 1 after this one read the course.
    await db.insert(learningCourseVersions).values({
      workspaceId: actor.workspaceId,
      courseId: course.id,
      version: 1,
      course,
      publishedBy: randomUUID(),
      notify: 'none',
    });
    expect(
      await failure(courses.publishCourse(db, actor, course.id, { notify: 'none' })),
    ).toMatchObject({ status: 409, code: 'conflict' });
    expect(await courses.getStudioCourse(db, actor, course.id)).toMatchObject({
      liveVersion: null,
    });
  });

  it('rolls back by publishing a copy; the draft follows unless it has unpublished edits', async () => {
    const actor = someone();
    const { course, revision } = await sampleDraft(actor);
    await courses.publishCourse(db, actor, course.id, { notify: 'none' });
    const second = { ...course, title: 'Second' };
    const latest = await courses.saveDraft(db, actor, course.id, { course: second, revision });
    await courses.publishCourse(db, actor, course.id, { notify: 'none' });

    expect(
      await courses.rollBack(db, actor, course.id, { version: 1, notify: 'tell', note: 'Back' }),
    ).toEqual({ version: 3 });
    expect(await courses.getLiveCourse(db, actor.workspaceId, course.id)).toEqual({
      course,
      version: 3,
    });
    expect(await courses.getStudioCourse(db, actor, course.id)).toEqual({
      course,
      revision: latest.revision + 1,
      liveVersion: 3,
    });
    expect(await summary(actor)).toMatchObject({ state: 'live', version: 3 });
    expect((await courses.listVersions(db, actor, course.id))[0]).toMatchObject({
      version: 3,
      notify: 'tell',
      note: 'Back',
      rolledBackFrom: 1,
    });

    const unpublished = { ...course, title: 'Work in progress' };
    await courses.saveDraft(db, actor, course.id, {
      course: unpublished,
      revision: latest.revision + 1,
    });
    expect(await courses.rollBack(db, actor, course.id, { version: 2, notify: 'none' })).toEqual({
      version: 4,
    });
    expect((await courses.getLiveCourse(db, actor.workspaceId, course.id))?.course).toEqual(second);
    expect(await courses.getStudioCourse(db, actor, course.id)).toMatchObject({
      course: unpublished,
      liveVersion: 4,
    });
    expect(await summary(actor)).toMatchObject({ state: 'changed', version: 4 });

    expect(
      await failure(courses.rollBack(db, actor, course.id, { version: 4, notify: 'none' })),
    ).toMatchObject({ status: 409 });
    expect(
      await failure(courses.rollBack(db, actor, course.id, { version: 9, notify: 'none' })),
    ).toMatchObject({ status: 404 });
  });

  it("sends learners their run's version, else the live one, without quiz questions", async () => {
    const actor = someone();
    const { course, revision } = await sampleDraft(actor);
    await courses.publishCourse(db, actor, course.id, { notify: 'none' });
    const second = { ...course, title: 'Calls, second version' };
    await courses.saveDraft(db, actor, course.id, { course: second, revision });
    await courses.publishCourse(db, actor, course.id, { notify: 'none' });

    expect(await courses.getCourseVersion(db, actor.workspaceId, course.id, 1)).toEqual(course);
    expect(await courses.getCourseVersion(db, actor.workspaceId, course.id, 2)).toEqual(second);
    expect(await courses.getCourseVersion(db, actor.workspaceId, course.id, 3)).toBeNull();
    expect(await courses.getCourseVersion(db, someone().workspaceId, course.id, 1)).toBeNull();

    const learner = { userId: randomUUID(), workspaceId: actor.workspaceId };
    const live = await courses.getLearnerCourse(db, learner, course.id);
    expect(live).toEqual({ course: learnerCourse(second), version: 2 });
    expect(runVersion).toHaveBeenLastCalledWith(expect.anything(), {
      workspaceId: actor.workspaceId,
      userId: learner.userId,
      courseId: course.id,
    });
    const quiz = live?.course.lessons.find((lesson) => lesson.kind === 'quiz');
    expect(quiz).toMatchObject({ id: 'calls-quiz', questionCount: 5 });
    expect(quiz).not.toHaveProperty('questions');

    vi.mocked(runVersion).mockResolvedValueOnce(1);
    expect(await courses.getLearnerCourse(db, learner, course.id)).toEqual({
      course: learnerCourse(course),
      version: 1,
    });

    const draft = await courses.createStudioCourse(db, actor, { type: 'standard' });
    expect(await courses.getLearnerCourse(db, learner, draft.course.id)).toBeNull();
    expect(await courses.getLearnerCourse(db, someone(), course.id)).toBeNull();
  });

  it('seeds each sample course once, published as version 1', async () => {
    const actor = someone();
    for (const sample of sampleCourses)
      expect(await courses.seedCourse(db, actor, sample)).toBe(true);
    expect(await courses.seedCourse(db, actor, sampleStandardCourse)).toBe(false);

    const list = await courses.listStudioCourses(db, actor, { archived: false });
    expect(list.map((course) => course.id).sort()).toEqual(
      sampleCourses.map((course) => course.id).sort(),
    );
    for (const course of list) expect(course).toMatchObject({ state: 'live', version: 1 });
    expect(await courses.getLiveCourse(db, actor.workspaceId, sampleStandardCourse.id)).toEqual({
      course: sampleStandardCourse,
      version: 1,
    });
  });
});
