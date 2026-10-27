import { randomUUID } from 'node:crypto';
import { sampleMicrolearningCourse, type Course } from '@carehub/learning';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, hasDatabase, type TestApp } from '../../../testing';
import * as courses from '../courses/service';
import learningRoutes from '../routes';

// Core doesn't put the workspace member on requests yet (accounts 1b), so this app does it from
// the x-test-person header, the way core's sessions will. Fictional people only.
const workspaceId = randomUUID();
const PEOPLE = {
  trainer: {
    id: randomUUID(),
    member: { roleId: 'role-trainer', permissions: ['learning.build'] },
  },
  assigner: {
    id: randomUUID(),
    member: { roleId: 'role-lead', permissions: ['learning.assign'] },
  },
  analyst: {
    id: randomUUID(),
    member: { roleId: 'role-analyst', permissions: ['learning.analytics'] },
  },
  learner: { id: randomUUID(), member: { roleId: 'role-viewer', permissions: [] } },
  guest: { id: randomUUID(), member: { roleId: null, permissions: [] } },
};
type Person = keyof typeof PEOPLE;

describe.skipIf(!hasDatabase)('Learning progress API', () => {
  let server: TestApp;
  let app: FastifyInstance;
  let course: Course;

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
        member: { workspaceId, ...member, permissions: new Set(member.permissions) },
      });
    });
    await app.register(learningRoutes, { prefix: '/api/learning' });
    await app.ready();

    const trainer = { userId: PEOPLE.trainer.id, workspaceId };
    const blank = await courses.createStudioCourse(server.db, trainer, { type: 'microlearning' });
    course = { ...structuredClone(sampleMicrolearningCourse), id: blank.course.id };
    await courses.saveDraft(server.db, trainer, course.id, { course, revision: blank.revision });
    await courses.publishCourse(server.db, trainer, course.id, { notify: 'none' });
  });

  afterAll(async () => {
    await app?.close();
    await server?.close();
  });

  const call = (person: Person | null, method: 'GET' | 'POST', url: string, body?: object) =>
    app.inject({
      method,
      url: `/api/learning${url}`,
      headers: person ? { 'x-test-person': person } : {},
      ...(body ? { payload: body } : {}),
    });

  it("takes the learner's events and answers with their state", async () => {
    const opened = {
      id: randomUUID(),
      type: 'lesson_opened',
      at: new Date().toISOString(),
      lessonId: 'hold-lesson',
    };
    const sent = await call('learner', 'POST', `/courses/${course.id}/events`, {
      events: [opened, { id: 'x' }],
    });
    expect(sent.statusCode).toBe(200);
    expect(sent.json()).toMatchObject({
      state: { courseId: course.id, status: 'in_progress' },
      rejected: [{ eventId: 'x', reason: 'invalid_event' }],
    });
    const state = await call('learner', 'GET', `/courses/${course.id}/progress`);
    expect(state.statusCode).toBe(200);
    expect(state.json()).toMatchObject({ status: 'in_progress', percentComplete: 0 });
    expect((await call('learner', 'POST', `/courses/${course.id}/events`, {})).statusCode).toBe(
      400,
    );
    expect((await call('learner', 'GET', '/courses/course-nowhere/progress')).statusCode).toBe(404);
    expect((await call('guest', 'GET', `/courses/${course.id}/progress`)).statusCode).toBe(403);
    expect((await call(null, 'GET', `/courses/${course.id}/progress`)).statusCode).toBe(401);
  });

  it('lets only people with learning.assign reset or mark complete', async () => {
    const person = PEOPLE.learner.id;
    const complete = `/people/${person}/courses/${course.id}/complete`;
    const reset = `/people/${person}/courses/${course.id}/reset`;
    for (const who of ['analyst', 'learner', 'trainer'] as const) {
      expect((await call(who, 'POST', complete, {})).statusCode).toBe(403);
      expect((await call(who, 'POST', reset, {})).statusCode).toBe(403);
    }
    const tooLong = await call('assigner', 'POST', complete, { note: 'x'.repeat(501) });
    expect(tooLong.statusCode).toBe(400);
    const notAPerson = `/people/not-a-person/courses/${course.id}/complete`;
    expect((await call('assigner', 'POST', notAPerson, {})).statusCode).toBe(400);

    const marked = await call('assigner', 'POST', complete, { note: 'Took it on paper.' });
    expect(marked.statusCode).toBe(200);
    expect(marked.json()).toMatchObject({ status: 'completed', percentComplete: 100 });
    const started = await call('assigner', 'POST', reset, {});
    expect(started.statusCode).toBe(200);
    expect(started.json()).toMatchObject({ status: 'not_started', completedAt: null });
    const own = await call('learner', 'GET', `/courses/${course.id}/progress`);
    expect(own.json()).toMatchObject({ status: 'not_started' });
  });
});
