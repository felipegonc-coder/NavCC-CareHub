import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, createUser, hasDatabase, type TestApp } from '../../../testing';
import learningRoutes from '../routes';

// The reports overview, course report and overdue routes, over HTTP. This app puts the workspace
// member on requests from the x-test-person header, as core's sessions do, so each person has
// exactly the permissions named here. Groups and managers aren't on main yet, so nobody has a
// team. The workspace is new, so it has no live course and nobody is enrolled. Fictional people
// only.
const workspaceId = randomUUID();
const ROLES = {
  learner: { roleId: 'role-viewer', permissions: [] as string[] },
  trainer: { roleId: 'role-trainer', permissions: ['learning.build', 'learning.assign'] },
  analyst: { roleId: 'role-analyst', permissions: ['learning.analytics'] },
  guest: { roleId: null, permissions: [] as string[] },
};
type Person = keyof typeof ROLES;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

describe.skipIf(!hasDatabase)('Learning reports routes', () => {
  let server: TestApp;
  let app: FastifyInstance;
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
    for (const url of [
      '/reports/overview',
      '/reports/courses/greeting-callers',
      '/reports/overdue',
    ]) {
      expect((await get(null, url)).statusCode).toBe(401);
      expect((await get('guest', url)).statusCode).toBe(403);
      expect((await get('learner', url)).statusCode).toBe(403);
      expect((await get('trainer', url)).statusCode).toBe(403);
    }
  });

  it('gives analysts the overview and the overdue list, as JSON or CSV', async () => {
    const overview = await get('analyst', '/reports/overview');
    expect(overview.statusCode).toBe(200);
    const { today } = overview.json();
    expect(today).toMatch(DAY);
    expect(overview.json()).toEqual({
      today,
      overview: {
        learners: 0,
        activeLearners: 0,
        completions: 0,
        completionsThisWeek: 0,
        passRate: null,
        overdue: 0,
      },
      courses: [],
    });
    const overdue = await get('analyst', '/reports/overdue');
    expect(overdue.statusCode).toBe(200);
    expect(overdue.json().today).toMatch(DAY);
    expect(overdue.json().entries).toEqual([]);

    const overviewCsv = await get('analyst', '/reports/overview?format=csv');
    expect(overviewCsv.statusCode).toBe(200);
    expect(overviewCsv.headers['content-type']).toMatch(/^text\/csv/);
    expect(overviewCsv.headers['content-disposition']).toMatch(
      /^attachment; filename="learning-overview-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    expect(overviewCsv.body.startsWith('\uFEFFCourse,Learners,Not started,')).toBe(true);
    const overdueCsv = await get('analyst', '/reports/overdue?format=csv');
    expect(overdueCsv.statusCode).toBe(200);
    expect(overdueCsv.headers['content-disposition']).toMatch(/filename="overdue-learning-/);
    expect(overdueCsv.body).toBe('\uFEFFName,Course,Status,Due,Days overdue\r\n');
  });

  it('turns down courses without a live version and bad input', async () => {
    const notLive = await get('analyst', '/reports/courses/greeting-callers');
    expect(notLive.statusCode).toBe(404);
    expect(notLive.json().error.message).toBe(
      "This course isn't published, so it has no report yet.",
    );
    expect((await get('analyst', '/reports/courses/greeting-callers?format=csv')).statusCode).toBe(
      404,
    );
    expect((await get('analyst', '/reports/courses/not%20an%20id')).statusCode).toBe(400);
    expect((await get('analyst', '/reports/overview?format=pdf')).statusCode).toBe(400);
    expect((await get('analyst', '/reports/overdue?format=xlsx')).statusCode).toBe(400);
  });
});
