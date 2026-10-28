import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, createUser, hasDatabase, type TestApp } from '../../../testing';
import learningRoutes from '../routes';
import * as paths from './service';

// The path report route, over HTTP. This app puts the workspace member on requests from the
// x-test-person header, as core's sessions do, so each person has exactly the permissions named
// here. Groups and managers aren't on main yet, so nobody has a team. Fictional people only.
const workspaceId = randomUUID();
const ROLES = {
  learner: { roleId: 'role-viewer', permissions: [] as string[] },
  trainer: { roleId: 'role-trainer', permissions: ['learning.build'] },
  analyst: { roleId: 'role-analyst', permissions: ['learning.analytics'] },
  guest: { roleId: null, permissions: [] as string[] },
};
type Person = keyof typeof ROLES;

describe.skipIf(!hasDatabase)('Learning path report route', () => {
  let server: TestApp;
  let app: FastifyInstance;
  let pathId = '';
  const ids: Partial<Record<Person, string>> = {};

  beforeAll(async () => {
    server = await createTestApp();
    ids.learner = (await createUser(server.db, { name: 'Ada Example' })).id;
    ids.trainer = (await createUser(server.db, { name: 'Tara Trainer' })).id;
    ids.analyst = (await createUser(server.db, { name: 'Ana Lyst' })).id;
    ids.guest = (await createUser(server.db, { name: 'Gus Guest' })).id;
    app = Fastify();
    app.decorate('db', server.db);
    app.decorateRequest('user', null);
    app.decorateRequest('member', null);
    app.addHook('onRequest', async (request) => {
      const person = request.headers['x-test-person'] as Person | undefined;
      const id = person && ids[person];
      if (!person || !id) return;
      const { roleId, permissions } = ROLES[person];
      Object.assign(request, {
        user: { id },
        member: { workspaceId, roleId, permissions: new Set<string>(permissions) },
      });
    });
    await app.register(learningRoutes, { prefix: '/api/learning' });
    await app.ready();
    const path = await paths.createPath(
      server.db,
      { userId: ids.trainer, workspaceId },
      { title: 'New agent basics', courseIds: ['greeting-callers'], order: 'sequential' },
    );
    pathId = path.id;
  });

  afterAll(async () => {
    await app?.close();
    await server?.close();
  });

  const get = (person: Person | null, url: string) =>
    app.inject({
      method: 'GET',
      url: `/api/learning${url}`,
      headers: person ? { 'x-test-person': person } : {},
    });

  it('answers only people who read reports', async () => {
    const url = `/reports/paths/${pathId}`;
    expect((await get(null, url)).statusCode).toBe(401);
    expect((await get('guest', url)).statusCode).toBe(403);
    expect((await get('learner', url)).statusCode).toBe(403);
    expect((await get('trainer', url)).statusCode).toBe(403);
  });

  it('gives analysts the path report, as JSON or CSV', async () => {
    const report = await get('analyst', `/reports/paths/${pathId}`);
    expect(report.statusCode).toBe(200);
    // Greeting callers has no live version here, so the path has no course to report on yet.
    expect(report.json()).toEqual({
      path: { id: pathId, title: 'New agent basics' },
      courses: [],
      learners: 0,
      notStarted: 0,
      inProgress: 0,
      completed: 0,
      completionPercent: 0,
      rows: [],
    });

    const csv = await get('analyst', `/reports/paths/${pathId}?format=csv`);
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toMatch(/^text\/csv/);
    expect(csv.headers['content-disposition']).toMatch(/^attachment; filename="path-report-/);
    expect(csv.body.startsWith('\uFEFFName,Status,Courses finished,')).toBe(true);

    expect((await get('analyst', '/reports/paths/path-unknown')).statusCode).toBe(404);
    expect((await get('analyst', '/reports/paths/not%20an%20id')).statusCode).toBe(400);
    expect((await get('analyst', `/reports/paths/${pathId}?format=pdf`)).statusCode).toBe(400);
  });
});
