import { randomUUID } from 'node:crypto';
import { sampleMicrolearningCourse } from '@carehub/learning';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestApp, hasDatabase, type TestApp } from '../../../testing';
import { bindMemoryCourseVersions } from '../progress/testing';
import learningRoutes from '../routes';

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
  analyst: {
    id: randomUUID(),
    member: { roleId: 'role-analyst', permissions: ['learning.analytics', 'learning.assign'] },
  },
  learner: { id: randomUUID(), member: { roleId: 'role-viewer', permissions: [] } },
  guest: { id: randomUUID(), member: { roleId: null, permissions: [] } },
};
type Person = keyof typeof PEOPLE;
const course = { ...structuredClone(sampleMicrolearningCourse), id: `course-${randomUUID()}` };

describe.skipIf(!hasDatabase)('Learning paths API', () => {
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

  const call = (
    person: Person | null,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    body?: object,
  ) =>
    app.inject({
      method,
      url: `/api/learning${url}`,
      headers: person ? { 'x-test-person': person } : {},
      ...(body ? { payload: body } : {}),
    });

  it('lets people with learning.build make, change and delete paths', async () => {
    const made = await call('trainer', 'POST', '/studio/paths', { title: 'New agent basics' });
    expect(made.statusCode).toBe(201);
    const path = made.json();
    expect(path).toMatchObject({ title: 'New agent basics', courseIds: [], order: 'sequential' });

    const saved = await call('trainer', 'PUT', `/studio/paths/${path.id}`, {
      ...path,
      courseIds: [course.id, 'closing-calls'],
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ courseIds: [course.id, 'closing-calls'] });
    expect((await call('trainer', 'GET', `/studio/paths/${path.id}`)).json()).toEqual(saved.json());
    expect((await call('trainer', 'GET', '/studio/paths')).json()).toMatchObject([
      { id: path.id, title: 'New agent basics', courseCount: 2 },
    ]);

    // Bad input.
    expect((await call('trainer', 'POST', '/studio/paths', { title: '' })).statusCode).toBe(400);
    const twice = { ...path, courseIds: [course.id, course.id] };
    expect((await call('trainer', 'PUT', `/studio/paths/${path.id}`, twice)).statusCode).toBe(400);
    const elsewhere = { ...path, id: 'another-path' };
    const moved = await call('trainer', 'PUT', `/studio/paths/${path.id}`, elsewhere);
    expect(moved.statusCode).toBe(400);
    expect(moved.json()).toMatchObject({ error: { issues: [{ path: 'id' }] } });

    // Everyone in the workspace opens the path page; it shows only the courses they can open.
    const page = await call('learner', 'GET', `/paths/${path.id}`);
    expect(page.statusCode).toBe(200);
    expect(page.json()).toMatchObject({
      path: { id: path.id, courseIds: [course.id] },
      courses: [{ id: course.id, status: 'not_started', locked: false }],
      progress: { completed: 0, total: 1 },
    });

    const removed = await call('trainer', 'DELETE', `/studio/paths/${path.id}`);
    expect(removed.statusCode).toBe(204);
    const gone = await call('trainer', 'GET', `/studio/paths/${path.id}`);
    expect(gone.statusCode).toBe(404);
    expect(gone.json()).toMatchObject({ error: { code: 'not_found' } });
    expect((await call('learner', 'GET', `/paths/${path.id}`)).statusCode).toBe(404);
  });

  it('keeps Studio to learning.build, and everything to signed-in members', async () => {
    const { id } = (await call('trainer', 'POST', '/studio/paths', { title: 'Basics' })).json();
    for (const person of ['analyst', 'learner', 'guest'] as const) {
      expect((await call(person, 'GET', '/studio/paths')).statusCode, person).toBe(403);
      expect((await call(person, 'POST', '/studio/paths', { title: 'Mine' })).statusCode).toBe(403);
      expect((await call(person, 'GET', `/studio/paths/${id}`)).statusCode).toBe(403);
      expect((await call(person, 'DELETE', `/studio/paths/${id}`)).statusCode).toBe(403);
    }
    expect((await call('guest', 'GET', `/paths/${id}`)).statusCode).toBe(403);
    expect((await call(null, 'GET', `/paths/${id}`)).statusCode).toBe(401);
    expect((await call(null, 'GET', '/studio/paths')).statusCode).toBe(401);
    expect((await call('learner', 'GET', '/paths/not%20an%20id')).statusCode).toBe(400);
  });
});
