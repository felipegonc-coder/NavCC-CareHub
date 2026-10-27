import { randomUUID } from 'node:crypto';
import { sampleMicrolearningCourse } from '@carehub/learning';
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
  learner: { id: randomUUID(), member: { roleId: 'role-viewer', permissions: [] } },
  guest: { id: randomUUID(), member: { roleId: null, permissions: [] } },
};
type Person = keyof typeof PEOPLE;
const course = { ...structuredClone(sampleMicrolearningCourse), id: `course-${randomUUID()}` };

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
});
