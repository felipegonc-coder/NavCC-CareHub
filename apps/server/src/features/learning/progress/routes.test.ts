import { randomUUID } from 'node:crypto';
import { sampleMicrolearningCourse, sampleRequiredReadCourse } from '@carehub/learning';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestApp, hasDatabase, type TestApp } from '../../../testing';
import learningRoutes from '../routes';
import { bindMemoryCourseVersions } from './testing';

vi.mock('../courses/access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../courses/access')>()),
  canSeeCourse: vi.fn(async () => true),
}));

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
const course = { ...structuredClone(sampleMicrolearningCourse), id: `course-${randomUUID()}` };
const quizCourse = { ...structuredClone(sampleRequiredReadCourse), id: `course-${randomUUID()}` };

describe.skipIf(!hasDatabase)('Learning progress API', () => {
  let server: TestApp;
  let app: FastifyInstance;
  let unbind: () => void;

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
    const memory = bindMemoryCourseVersions();
    unbind = memory.unbind;
    memory.courses.publish(workspaceId, course);
    memory.courses.publish(workspaceId, quizCourse);
  });

  afterAll(async () => {
    unbind?.();
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
  });

  it('answers 400, 401, 403 and 404 in plain words', async () => {
    const events = `/courses/${course.id}/events`;
    expect((await call('learner', 'POST', events, {})).statusCode).toBe(400);
    expect((await call('learner', 'POST', events, { events: [] })).statusCode).toBe(400);
    const nowhere = await call('learner', 'GET', '/courses/course-nowhere/progress');
    expect(nowhere.statusCode).toBe(404);
    expect(nowhere.json()).toMatchObject({ error: { code: 'not_found' } });
    expect((await call('guest', 'GET', `/courses/${course.id}/progress`)).statusCode).toBe(403);
    expect((await call(null, 'GET', `/courses/${course.id}/progress`)).statusCode).toBe(401);
  });
  it('lets only people with learning.assign reset or mark complete', async () => {
    const person = PEOPLE.learner.id;
    const complete = `/people/${person}/courses/${course.id}/complete`;
    const reset = `/people/${person}/courses/${course.id}/reset`;
    for (const who of ['analyst', 'learner', 'trainer', 'guest'] as const) {
      expect((await call(who, 'POST', complete, {})).statusCode).toBe(403);
      expect((await call(who, 'POST', reset, {})).statusCode).toBe(403);
    }
    expect((await call(null, 'POST', reset, {})).statusCode).toBe(401);
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

  it('starts quiz attempts for the learner, with the reason when one cannot start', async () => {
    const attempts = `/courses/${quizCourse.id}/quizzes/privacy-quiz/attempts`;
    const at = () => ({ at: new Date().toISOString() });
    expect((await call('learner', 'POST', attempts, {})).statusCode).toBe(400);
    const locked = await call('learner', 'POST', attempts, at());
    expect(locked.statusCode).toBe(409);
    expect(locked.json()).toEqual({
      error: { code: 'locked', message: 'Finish the lessons before this quiz first.' },
    });
    const lesson = { lessonId: 'privacy-rules', at: new Date(Date.now() - 30_000).toISOString() };
    const done = { ...lesson, at: new Date().toISOString() };
    const sent = await call('learner', 'POST', `/courses/${quizCourse.id}/events`, {
      events: [
        { id: randomUUID(), type: 'lesson_opened', ...lesson },
        { id: randomUUID(), type: 'lesson_completed', ...done },
      ],
    });
    expect(sent.json()).toMatchObject({ rejected: [] });

    const started = await call('learner', 'POST', attempts, at());
    expect(started.statusCode).toBe(200);
    const paper = started.json();
    expect(paper).toMatchObject({ attemptId: expect.any(String) });
    expect(paper.questions).toHaveLength(3);
    expect((await call('learner', 'POST', attempts, at())).json()).toEqual(paper);
    const notAQuiz = `/courses/${course.id}/quizzes/hold-lesson/attempts`;
    expect((await call('learner', 'POST', notAQuiz, at())).statusCode).toBe(404);
    expect((await call('guest', 'POST', attempts, at())).statusCode).toBe(403);
  });
});
