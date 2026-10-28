import { randomUUID } from 'node:crypto';
import { sampleMicrolearningCourse, type Course } from '@carehub/learning';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, hasDatabase, type TestApp } from '../../../testing';
import learningRoutes from '../routes';
import { issueCertificate } from './service';

// Core doesn't put the workspace member on requests yet (accounts 1b), so this app does it from
// the x-test-person header, the way core's sessions will. Fictional people only.
const workspaceId = randomUUID();
const PEOPLE = {
  learner: { id: randomUUID(), member: { roleId: 'role-viewer', permissions: [] } },
  colleague: { id: randomUUID(), member: { roleId: 'role-viewer', permissions: [] } },
  analyst: {
    id: randomUUID(),
    member: { roleId: 'role-analyst', permissions: ['learning.analytics'] },
  },
  guest: { id: randomUUID(), member: { roleId: null, permissions: [] } },
};
type Person = keyof typeof PEOPLE;

describe.skipIf(!hasDatabase)('Learning certificates API', () => {
  let server: TestApp;
  let app: FastifyInstance;
  let certificate: { id: string; code: string };

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
        member: { workspaceId, ...member, permissions: new Set<string>(member.permissions) },
      });
    });
    await app.register(learningRoutes, { prefix: '/api/learning' });
    await app.ready();

    const sample = structuredClone(sampleMicrolearningCourse);
    const course: Course = {
      ...sample,
      settings: { ...sample.settings, certificate: { enabled: true, validForMonths: 12 } },
    };
    const issued = await issueCertificate(server.db, {
      workspaceId,
      learnerId: PEOPLE.learner.id,
      course,
      version: 1,
      finish: { status: 'passed', completedAt: new Date().toISOString(), score: 95 },
    });
    if (!issued) throw new Error('The certificate was not issued.');
    certificate = issued;
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

  it('answers only members of the workspace', async () => {
    expect((await get(null, '/certificates')).statusCode).toBe(401);
    expect((await get('guest', '/certificates')).statusCode).toBe(403);
  });

  it('shows learners their own certificates and analysts anyone’s', async () => {
    const mine = await get('learner', '/certificates');
    expect(mine.statusCode).toBe(200);
    expect(mine.json()).toMatchObject([{ id: certificate.id, status: 'valid', score: 95 }]);
    expect((await get('colleague', '/certificates')).json()).toEqual([]);

    expect((await get('learner', `/certificates/${certificate.id}`)).statusCode).toBe(200);
    expect((await get('colleague', `/certificates/${certificate.id}`)).statusCode).toBe(404);
    expect((await get('analyst', `/certificates/${certificate.id}`)).statusCode).toBe(200);
    expect((await get('learner', '/certificates/not-a-certificate')).statusCode).toBe(404);

    const theirs = `/certificates?personId=${PEOPLE.learner.id}`;
    expect((await get('colleague', theirs)).statusCode).toBe(403);
    expect((await get('analyst', theirs)).json()).toMatchObject([{ id: certificate.id }]);
  });

  it('looks a code up in any spelling, and refuses what can’t be a code', async () => {
    const typed = certificate.code.toLowerCase().replaceAll('-', ' ');
    const found = await get('analyst', `/certificates?code=${encodeURIComponent(typed)}`);
    expect(found.statusCode).toBe(200);
    expect(found.json()).toMatchObject([{ id: certificate.id, code: certificate.code }]);
    expect((await get('colleague', `/certificates?code=${certificate.code}`)).json()).toEqual([]);

    const bad = await get('analyst', '/certificates?code=12345');
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ error: { code: expect.any(String) } });
    expect((await get('learner', '/certificates?sort=newest')).statusCode).toBe(400);
  });
});
