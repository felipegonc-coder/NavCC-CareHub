import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, createUser, hasDatabase, type TestApp } from '../../../testing';
import learningRoutes from '../routes';

// The person and team report routes, over HTTP. Core doesn't put the workspace member on requests
// yet (accounts 1b), so this app does it from the x-test-person header, the way core's sessions
// will. Groups and managers aren't on main yet either, so nobody has a team. Fictional people only.
const workspaceId = randomUUID();
const ROLES = {
  learner: { roleId: 'role-viewer', permissions: [] as string[] },
  colleague: { roleId: 'role-viewer', permissions: [] as string[] },
  analyst: { roleId: 'role-analyst', permissions: ['learning.analytics'] },
  guest: { roleId: null, permissions: [] as string[] },
};
type Person = keyof typeof ROLES;

describe.skipIf(!hasDatabase)('Learning person and team report routes', () => {
  let server: TestApp;
  let app: FastifyInstance;
  const ids: Partial<Record<Person, string>> = {};

  beforeAll(async () => {
    server = await createTestApp();
    ids.learner = (await createUser(server.db, { name: 'Ada Example' })).id;
    ids.colleague = (await createUser(server.db, { name: 'Bo Sample' })).id;
    ids.analyst = (await createUser(server.db, { name: 'Tara Trainer' })).id;
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
  const record = (person: Person) => `/reports/people/${ids[person]}`;

  it('answers only members of the workspace', async () => {
    for (const url of [record('learner'), '/reports/team']) {
      expect((await get(null, url)).statusCode).toBe(401);
      expect((await get('guest', url)).statusCode).toBe(403);
    }
  });

  it('gives a person their own record, as JSON or CSV', async () => {
    const own = await get('learner', record('learner'));
    expect(own.statusCode).toBe(200);
    expect(own.json()).toEqual({ person: { id: ids.learner, name: 'Ada Example' }, rows: [] });

    const csv = await get('learner', `${record('learner')}?format=csv`);
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toMatch(/^text\/csv/);
    expect(csv.headers['content-disposition']).toMatch(/^attachment; filename="learning-record-/);
    expect(csv.body.startsWith('\uFEFFCourse,Status,Score,')).toBe(true);
  });

  it("keeps other people's records to people who read reports", async () => {
    expect((await get('colleague', record('learner'))).statusCode).toBe(403);
    // Nothing here for this person yet, so analysts find nobody.
    expect((await get('analyst', record('learner'))).statusCode).toBe(404);
    expect((await get('analyst', '/reports/people/not-a-person')).statusCode).toBe(404);
    expect((await get('learner', `${record('learner')}?format=pdf`)).statusCode).toBe(400);
  });

  it('gives the team view to people who read reports, and refuses the rest', async () => {
    expect((await get('learner', '/reports/team')).statusCode).toBe(403);
    const team = await get('analyst', '/reports/team?courseId=calls-with-care');
    expect(team.statusCode).toBe(200);
    expect(team.json()).toEqual({ courses: [], groups: [], people: [] });

    const csv = await get('analyst', '/reports/team?format=csv');
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-disposition']).toMatch(/^attachment; filename="team-learning-/);
    expect(csv.body.startsWith('\uFEFFGroup,Learners,Enrollments,')).toBe(true);
    expect((await get('analyst', '/reports/team?courseId=no%20spaces')).statusCode).toBe(400);
  });
});
