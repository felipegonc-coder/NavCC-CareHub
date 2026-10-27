import { randomUUID } from 'node:crypto';
import { sampleCourses, sampleScenarioLabCourse, sampleStandardCourse } from '@carehub/learning';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../../db';
import { createTestApp, hasDatabase, type TestApp } from '../../../testing';
import { LearningError } from '../errors';
import * as courses from './service';

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

describe.skipIf(!hasDatabase)('Examples, copies, archive and the catalog', () => {
  let server: TestApp;
  let db: Db;

  beforeAll(async () => {
    server = await createTestApp();
    db = server.db;
  });

  afterAll(async () => {
    await server?.close();
  });

  it('starts a course from an example of the same type, as a new draft', async () => {
    const actor = someone();
    const examples = courses.listExamples();
    expect(examples.map((example) => example.id)).toEqual(sampleCourses.map((course) => course.id));
    expect(examples[0]).toEqual({
      id: sampleStandardCourse.id,
      title: sampleStandardCourse.title,
      type: 'standard',
      summary: sampleStandardCourse.summary,
      lessonCount: sampleStandardCourse.lessons.length,
    });

    const copy = await courses.createStudioCourse(db, actor, {
      type: 'standard',
      exampleId: sampleStandardCourse.id,
      title: 'Our phone course',
    });
    expect(copy).toMatchObject({ revision: 1, liveVersion: null });
    expect(copy.course.id).not.toBe(sampleStandardCourse.id);
    expect(copy.course).toEqual({
      ...sampleStandardCourse,
      id: copy.course.id,
      title: 'Our phone course',
    });
    const keepsTitle = await courses.createStudioCourse(db, actor, {
      type: 'scenario_lab',
      exampleId: sampleScenarioLabCourse.id,
      title: ' ',
    });
    expect(keepsTitle.course.title).toBe(sampleScenarioLabCourse.title);

    const unknown = courses.createStudioCourse(db, actor, { type: 'standard', exampleId: 'nope' });
    expect(await failure(unknown)).toMatchObject({ status: 404 });
    const otherType = courses.createStudioCourse(db, actor, {
      type: 'microlearning',
      exampleId: sampleStandardCourse.id,
    });
    expect(await failure(otherType)).toMatchObject({
      status: 400,
      issues: [{ path: 'exampleId' }],
    });
  });

  it('duplicates a course as a new draft that was never published', async () => {
    const actor = someone();
    await courses.seedCourse(db, actor, sampleStandardCourse);
    const copy = await courses.duplicateCourse(db, actor, sampleStandardCourse.id);
    expect(copy).toMatchObject({
      title: `Copy of ${sampleStandardCourse.title}`,
      state: 'draft',
      version: null,
      archived: false,
    });
    expect(copy.id).not.toBe(sampleStandardCourse.id);
    const { course } = await courses.getStudioCourse(db, actor, copy.id);
    expect(course.lessons).toEqual(sampleStandardCourse.lessons);
    expect(await courses.getLiveCourse(db, actor.workspaceId, copy.id)).toBeNull();
    expect(
      await failure(courses.duplicateCourse(db, someone(), sampleStandardCourse.id)),
    ).toMatchObject({ status: 404 });
  });

  it('archives and unarchives; an archived course leaves the lists but still opens by link', async () => {
    const actor = someone();
    const { id } = sampleStandardCourse;
    await courses.seedCourse(db, actor, sampleStandardCourse);
    expect(await courses.setArchived(db, actor, id, true)).toMatchObject({
      id,
      archived: true,
      state: 'live',
    });
    expect(await courses.listStudioCourses(db, actor, { archived: false })).toEqual([]);
    const archived = await courses.listStudioCourses(db, actor, { archived: true });
    expect(archived.map((course) => course.id)).toEqual([id]);
    expect(await courses.listCatalog(db, actor.workspaceId, {})).toEqual([]);
    expect(await courses.getLiveCourse(db, actor.workspaceId, id)).toMatchObject({ version: 1 });

    expect(await courses.setArchived(db, actor, id, false)).toMatchObject({ archived: false });
    const catalog = await courses.listCatalog(db, actor.workspaceId, {});
    expect(catalog.map((entry) => entry.id)).toEqual([id]);
    expect(await failure(courses.setArchived(db, actor, 'no-such-course', true))).toMatchObject({
      status: 404,
    });
  });

  it('lists live, listed courses by title, found by words and by topic', async () => {
    const actor = someone();
    for (const sample of sampleCourses) await courses.seedCourse(db, actor, sample);
    await courses.createStudioCourse(db, actor, { type: 'standard', title: 'Never published' });

    const catalog = await courses.listCatalog(db, actor.workspaceId, {});
    expect(catalog.map((entry) => entry.title)).toEqual([
      'Escalations certification',
      'Handling calls with care',
      'Practice: an upset member',
      'Two-minute tip: putting a call on hold',
    ]);
    expect(catalog[1]).toEqual({
      id: sampleStandardCourse.id,
      title: sampleStandardCourse.title,
      type: 'standard',
      summary: sampleStandardCourse.summary,
      cover: sampleStandardCourse.cover,
      topics: sampleStandardCourse.topics,
      estimatedMinutes: sampleStandardCourse.estimatedMinutes,
      lessonCount: sampleStandardCourse.lessons.length,
      version: 1,
    });

    const ids = async (query: { q?: string; topic?: string }) =>
      (await courses.listCatalog(db, actor.workspaceId, query)).map((entry) => entry.id);
    expect(await ids({ q: 'CALLS care' })).toEqual([sampleStandardCourse.id]);
    expect(await ids({ topic: 'Phones' })).toEqual([sampleStandardCourse.id]);
    expect(await ids({ q: 'privacy' })).toEqual([]);
    expect(await courses.listCatalog(db, someone().workspaceId, {})).toEqual([]);
  });
});
