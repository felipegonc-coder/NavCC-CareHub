import { randomUUID } from 'node:crypto';
import { sampleStandardCourse, type StudioCourse } from '@carehub/learning';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, hasDatabase, type TestApp } from '../../../testing';
import learningRoutes from '../routes';

// Core's sessions put the workspace member on each request; this app does it from the
// x-test-person header.
const workspaceId = randomUUID();
const PEOPLE = {
  trainer: {
    id: randomUUID(),
    member: { roleId: 'role-trainer', permissions: ['learning.build'] },
  },
  learner: { id: randomUUID(), member: { roleId: 'role-viewer', permissions: [] } },
  guest: { id: randomUUID(), member: { roleId: null, permissions: [] } },
};
type Person = keyof typeof PEOPLE;

const NOT_FOUND = {
  error: { code: 'not_found', message: 'This was deleted, or the link is wrong.' },
};

describe.skipIf(!hasDatabase)('Learning reviews API', () => {
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
      Object.assign(request, {
        user: { id: person.id },
        member: {
          workspaceId,
          ...person.member,
          permissions: new Set(person.member.permissions),
        },
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
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    options: { body?: object; token?: string } = {},
  ) =>
    app.inject({
      method,
      url: `/api/learning${url}`,
      headers: {
        ...(person ? { 'x-test-person': person } : {}),
        ...(options.token === undefined ? {} : { 'x-review-token': options.token }),
      },
      ...(options.body ? { payload: options.body } : {}),
    });

  /** A sample draft shared by a new review link. */
  async function sharedCourse() {
    const created = await call('trainer', 'POST', '/studio/courses', {
      body: { type: 'standard' },
    });
    const { course: blank, revision } = created.json() as StudioCourse;
    const course = { ...structuredClone(sampleStandardCourse), id: blank.id };
    const saved = await call('trainer', 'PUT', `/studio/courses/${course.id}`, {
      body: { course, revision },
    });
    expect(saved.statusCode).toBe(200);
    const made = await call('trainer', 'POST', `/studio/courses/${course.id}/review-links`, {
      body: {},
    });
    expect(made.statusCode).toBe(201);
    const link = made.json() as { id: string; url: string; expiresAt: string };
    return { course, link, made, token: link.url.slice('/learning/review#'.length) };
  }

  it('lets builders share drafts, and any signed-in member with the link review them', async () => {
    const { course, link, made, token } = await sharedCourse();
    expect(made.headers['cache-control']).toBe('no-store');
    expect(link.url).toMatch(/^\/learning\/review#[A-Za-z0-9_-]{43}$/);

    const review = await call('learner', 'GET', '/review', { token });
    expect(review.statusCode).toBe(200);
    expect(review.headers['cache-control']).toBe('no-store');
    expect(review.json()).toEqual({ course, comments: [], expiresAt: link.expiresAt });

    expect((await call(null, 'GET', '/review', { token })).statusCode).toBe(401);
    expect((await call('guest', 'GET', '/review', { token })).statusCode).toBe(403);
    const learnerShares = await call(
      'learner',
      'POST',
      `/studio/courses/${course.id}/review-links`,
      {
        body: {},
      },
    );
    expect(learnerShares.statusCode).toBe(403);
    expect((await call('learner', 'GET', `/studio/courses/${course.id}/comments`)).statusCode).toBe(
      403,
    );
  });

  it('reads the token from the header only', async () => {
    const { token } = await sharedCourse();
    const inQuery = await call('learner', 'GET', `/review?token=${token}`);
    expect(inQuery.statusCode).toBe(404);
    expect(inQuery.json()).toEqual(NOT_FOUND);
    const unknown = await call('learner', 'GET', '/review', { token: 'Ab0-_'.repeat(8) + 'Ab0' });
    expect(unknown.json()).toEqual(NOT_FOUND);
    expect((await call('learner', 'GET', `/review/${token}`)).statusCode).toBe(404);
  });

  it('takes comments through the link, and lists, resolves and exports them in Studio', async () => {
    const { course, token } = await sharedCourse();
    const lessonId = course.lessons[0]?.id ?? '';
    const posted = await call('learner', 'POST', '/review/comments', {
      token,
      body: { lessonId, body: 'Say who to call first.' },
    });
    expect(posted.statusCode).toBe(201);
    const comment = posted.json() as { id: string };
    expect(posted.json()).toMatchObject({
      lessonId,
      body: 'Say who to call first.',
      resolved: false,
    });

    const noLink = await call('learner', 'POST', '/review/comments', {
      body: { lessonId, body: 'Here.' },
    });
    expect(noLink.statusCode).toBe(404);
    const empty = await call('learner', 'POST', '/review/comments', {
      token,
      body: { lessonId, body: ' ' },
    });
    expect(empty.statusCode).toBe(400);

    const listed = await call('trainer', 'GET', `/studio/courses/${course.id}/comments`);
    expect(listed.json()).toEqual([posted.json()]);
    const resolved = await call('trainer', 'PATCH', `/studio/comments/${comment.id}`, {
      body: { resolved: true },
    });
    expect(resolved.json()).toMatchObject({ id: comment.id, resolved: true });
    const notAllowed = await call('learner', 'PATCH', `/studio/comments/${comment.id}`, {
      body: { resolved: false },
    });
    expect(notAllowed.statusCode).toBe(403);

    const csv = await call('trainer', 'GET', `/studio/courses/${course.id}/comments.csv`);
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(csv.headers['content-disposition']).toBe(
      `attachment; filename="review-comments-${course.id}.csv"`,
    );
    expect(csv.body).toContain('Say who to call first.');
    expect(csv.body).toContain(',Resolved\r\n');
  });

  it('lists links without their tokens and stops sharing one', async () => {
    const { course, link, token } = await sharedCourse();
    const listed = await call('trainer', 'GET', `/studio/courses/${course.id}/review-links`);
    expect(listed.json()).toEqual([
      {
        id: link.id,
        createdAt: expect.any(String),
        expiresAt: link.expiresAt,
        createdBy: expect.any(Object),
      },
    ]);
    expect(listed.body).not.toContain(token);

    expect((await call('trainer', 'DELETE', `/studio/review-links/${link.id}`)).statusCode).toBe(
      204,
    );
    expect((await call('learner', 'GET', '/review', { token })).json()).toEqual(NOT_FOUND);
    expect(
      (await call('trainer', 'GET', `/studio/courses/${course.id}/review-links`)).json(),
    ).toEqual([]);
    expect((await call('trainer', 'DELETE', '/studio/review-links/unknown-link')).statusCode).toBe(
      404,
    );
    const badDays = await call('trainer', 'POST', `/studio/courses/${course.id}/review-links`, {
      body: { days: 365 },
    });
    expect(badDays.statusCode).toBe(400);
  });
});
