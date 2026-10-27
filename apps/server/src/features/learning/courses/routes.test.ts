import { randomUUID } from 'node:crypto';
import { sampleStandardCourse, type StudioCourse } from '@carehub/learning';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, hasDatabase, type TestApp } from '../../../testing';
import learningRoutes from '../routes';

// Core doesn't put the workspace member on requests yet (accounts 1b), so this app does it from the
// x-test-person header, the way core's sessions will.
const workspaceId = randomUUID();
const PEOPLE = {
  trainer: {
    id: randomUUID(),
    member: { roleId: 'role-trainer', permissions: ['learning.build'] },
  },
  learner: { id: randomUUID(), member: { roleId: 'role-viewer', permissions: [] } },
  guest: { id: randomUUID(), member: { roleId: null, permissions: [] } },
  outsider: { id: randomUUID(), member: null },
};
type Person = keyof typeof PEOPLE;

const NOT_FOUND = {
  error: { code: 'not_found', message: 'This was deleted, or the link is wrong.' },
};
const FORBIDDEN = { error: { code: 'forbidden', message: "You don't have access to this." } };

describe.skipIf(!hasDatabase)('Learning courses API', () => {
  let server: TestApp;
  let app: FastifyInstance;

  beforeAll(async () => {
    server = await createTestApp();
    app = Fastify();
    app.decorate('db', server.db);
    app.decorateRequest('user', null);
    app.decorateRequest('member', null);
    app.addHook('onRequest', async (request) => {
      const person = PEOPLE[request.headers['x-test-person'] as Person] ?? null;
      if (!person) return;
      const { member } = person;
      Object.assign(request, {
        user: { id: person.id },
        member: member && { workspaceId, ...member, permissions: new Set(member.permissions) },
      });
    });
    await app.register(learningRoutes, { prefix: '/api/learning' });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await server?.close();
  });

  const call = (
    person: Person | null,
    method: 'GET' | 'POST' | 'PUT',
    url: string,
    body?: object,
  ) =>
    app.inject({
      method,
      url: `/api/learning${url}`,
      headers: person ? { 'x-test-person': person } : {},
      ...(body ? { payload: body } : {}),
    });

  async function newCourse(title?: string): Promise<StudioCourse> {
    const created = await call('trainer', 'POST', '/studio/courses', { type: 'standard', title });
    expect(created.statusCode).toBe(201);
    return created.json();
  }

  it('lets in only signed-in members, and only builders into Studio', async () => {
    const signedOut = await call(null, 'GET', '/studio/courses');
    expect(signedOut.statusCode).toBe(401);
    expect(signedOut.json()).toEqual({
      error: { code: 'signed_out', message: 'Sign in to continue.' },
    });
    for (const person of ['learner', 'guest', 'outsider'] as const) {
      const studio = await call(person, 'GET', '/studio/courses');
      expect(studio.statusCode).toBe(403);
      expect(studio.json()).toEqual(FORBIDDEN);
    }
    for (const person of ['guest', 'outsider'] as const) {
      expect((await call(person, 'GET', '/courses/course-calls-with-care')).json()).toEqual(
        FORBIDDEN,
      );
    }
    expect((await call('trainer', 'GET', '/studio/courses')).statusCode).toBe(200);
  });

  it('takes a course from a blank draft to live; learners only ever get the live version', async () => {
    const { course, revision } = await newCourse('Calls');
    expect(course).toMatchObject({ title: 'Calls', type: 'standard' });
    expect((await call('trainer', 'GET', `/studio/courses/${course.id}`)).json()).toEqual({
      course,
      revision,
      liveVersion: null,
    });

    const content = { ...structuredClone(sampleStandardCourse), id: course.id };
    const saved = await call('trainer', 'PUT', `/studio/courses/${course.id}`, {
      course: content,
      revision,
    });
    expect(saved.json()).toEqual({ revision: 2 });
    expect((await call('learner', 'GET', `/courses/${course.id}`)).json()).toEqual(NOT_FOUND);

    const publish = { notify: 'tell', note: 'First version' };
    const published = await call(
      'trainer',
      'POST',
      `/studio/courses/${course.id}/publish`,
      publish,
    );
    expect(published.json()).toEqual({ version: 1 });
    const live = await call('learner', 'GET', `/courses/${course.id}`);
    expect(live.statusCode).toBe(200);
    expect(live.json()).toEqual({ course: content, version: 1 });

    const list = await call('trainer', 'GET', '/studio/courses?archived=false');
    expect(list.json()).toContainEqual(
      expect.objectContaining({ id: course.id, title: content.title, state: 'live', version: 1 }),
    );
    expect((await call('trainer', 'GET', '/studio/courses?archived=true')).json()).toEqual([]);
    expect((await call('trainer', 'GET', `/studio/courses/${course.id}/versions`)).json()).toEqual([
      {
        version: 1,
        publishedAt: expect.any(String),
        publishedBy: PEOPLE.trainer.id,
        ...publish,
      },
    ]);
    const rollback = await call('trainer', 'POST', `/studio/courses/${course.id}/rollback`, {
      version: 1,
    });
    expect(rollback.statusCode).toBe(409);
    expect(rollback.json()).toEqual({
      error: { code: 'conflict', message: 'That version is already live.' },
    });
  });

  it('answers bad input, unknown courses, stale saves and publish problems in the error shape', async () => {
    const badType = await call('trainer', 'POST', '/studio/courses', { type: 'webinar' });
    expect(badType.statusCode).toBe(400);
    expect(badType.json()).toMatchObject({
      error: { code: 'invalid', issues: [expect.objectContaining({ path: 'type' })] },
    });
    expect((await call('trainer', 'GET', '/studio/courses?archived=maybe')).statusCode).toBe(400);
    expect((await call('trainer', 'GET', '/studio/courses/not%20an%20id')).statusCode).toBe(400);
    const missing = await call('trainer', 'GET', '/studio/courses/no-such-course');
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual(NOT_FOUND);
    expect((await call('learner', 'GET', '/courses/no-such-course')).json()).toEqual(NOT_FOUND);

    const { course } = await newCourse();
    const stale = await call('trainer', 'PUT', `/studio/courses/${course.id}`, {
      course,
      revision: 2,
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ error: { code: 'conflict' } });
    const notACourse = await call('trainer', 'PUT', `/studio/courses/${course.id}`, {
      course: { ...course, lessons: 'none' },
      revision: 1,
    });
    expect(notACourse.statusCode).toBe(400);
    expect(notACourse.json()).toMatchObject({
      error: { code: 'invalid', issues: expect.any(Array) },
    });

    const loudly = await call('trainer', 'POST', `/studio/courses/${course.id}/publish`, {
      notify: 'loudly',
    });
    expect(loudly.statusCode).toBe(400);
    const refused = await call('trainer', 'POST', `/studio/courses/${course.id}/publish`, {
      notify: 'none',
    });
    expect(refused.statusCode).toBe(422);
    const { error } = refused.json();
    expect(error).toMatchObject({
      code: 'cannot_publish',
      message: expect.stringMatching(/^Fix /),
    });
    expect(error.issues.length).toBeGreaterThan(0);
  });
});
