import { randomUUID } from 'node:crypto';
import {
  addDays,
  CreateAssignmentsRequestSchema,
  sampleRequiredReadCourse,
  sampleStandardCourse,
} from '@carehub/learning';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, hasDatabase, type TestApp } from '../../../testing';
import { jobRunner } from '../../jobs';
import { seedCourse } from '../courses/service';
import { learningToday } from '../day';
import { errorReply } from '../errors';
import { learningProgress } from '../progress/schema';
import { isLearningEnabled } from '../public';
import learningRoutes from '../routes';
import { REMINDERS_TASK } from './reminders';
import assignmentsRoutes from './routes';
import { boundAssignmentSources, createAssignments } from './service';
import { assignmentStore } from './store';
import { memoryReminderSources, memorySources, only } from './testing';

// Core doesn't put the workspace member on requests yet (accounts 1b), so these apps do it from the
// x-test-person header, the way core's sessions will. Fictional people and courses only.
const workspaceId = randomUUID();
const PEOPLE = {
  trainer: {
    id: randomUUID(),
    member: { roleId: 'role-trainer', permissions: ['learning.assign'] },
  },
  tara: { id: randomUUID(), member: { roleId: 'role-viewer', permissions: [] } },
  guest: { id: randomUUID(), member: { roleId: null, permissions: [] } },
  outsider: { id: randomUUID(), member: null },
};
type Person = keyof typeof PEOPLE;

const calls = sampleStandardCourse;
const privacy = sampleRequiredReadCourse;
const SIGNED_OUT = { error: { code: 'signed_out', message: 'Sign in to continue.' } };
const FORBIDDEN = { error: { code: 'forbidden', message: "You don't have access to this." } };
const NOT_FOUND = {
  error: { code: 'not_found', message: 'This was deleted, or the link is wrong.' },
};

async function appWith(
  register: (app: FastifyInstance) => Promise<void>,
): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorateRequest('user', null);
  app.decorateRequest('member', null);
  app.addHook('onRequest', async (request) => {
    const person = PEOPLE[request.headers['x-test-person'] as Person] ?? null;
    if (!person) return;
    const { member } = person;
    Object.assign(request, {
      user: { id: person.id, timeZone: 'America/Denver' },
      member: member && { workspaceId, ...member, permissions: new Set(member.permissions) },
    });
  });
  await register(app);
  await app.ready();
  return app;
}

const caller =
  (app: () => FastifyInstance) =>
  (person: Person | null, method: 'GET' | 'POST' | 'DELETE', url: string, body?: object) =>
    app().inject({
      method,
      url: `/api/learning${url}`,
      headers: person ? { 'x-test-person': person } : {},
      ...(body ? { payload: body } : {}),
    });

const dayAfter = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

describe('Learning assignments API', () => {
  let app: FastifyInstance;
  const sources = memorySources({ courses: [calls, privacy] });
  const call = caller(() => app);

  beforeAll(async () => {
    app = await appWith(async (server) => {
      server.setErrorHandler((error, _request, reply) => {
        const { status, body } = errorReply(error);
        return reply.code(status).send(body);
      });
      await server.register(assignmentsRoutes, { prefix: '/api/learning', sources });
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('lets in only members, and only people who may assign to the assignments', async () => {
    for (const url of ['/me', '/assignments']) {
      const signedOut = await call(null, 'GET', url);
      expect(signedOut.statusCode).toBe(401);
      expect(signedOut.json()).toEqual(SIGNED_OUT);
      for (const person of ['guest', 'outsider'] as const) {
        expect((await call(person, 'GET', url)).json()).toEqual(FORBIDDEN);
      }
    }
    const assignment = { target: { type: 'course', id: calls.id }, people: [PEOPLE.tara.id] };
    expect((await call('tara', 'GET', '/assignments')).statusCode).toBe(403);
    expect((await call('tara', 'POST', '/assignments', assignment)).statusCode).toBe(403);
    expect((await call('tara', 'DELETE', `/assignments/${randomUUID()}`)).statusCode).toBe(403);
    expect((await call('tara', 'GET', '/me')).statusCode).toBe(200);
    expect(sources.store.rows).toEqual([]);
  });

  it('assigns, lists and removes assignments', async () => {
    const created = await call('trainer', 'POST', '/assignments', {
      target: { type: 'course', id: calls.id },
      people: [PEOPLE.tara.id],
      dueDate: dayAfter(7),
    });
    expect(created.statusCode).toBe(201);
    const [assignment] = created.json();
    expect(assignment).toMatchObject({
      courseId: calls.id,
      courseTitle: calls.title,
      people: [PEOPLE.tara.id],
      groups: [],
      required: true,
      createdBy: PEOPLE.trainer.id,
    });
    const other = await call('trainer', 'POST', '/assignments', {
      target: { type: 'course', id: privacy.id },
      groups: ['group-front-desk'],
      dueInDays: 30,
      required: false,
    });
    expect(other.statusCode).toBe(201);

    const listed = await call('trainer', 'GET', '/assignments');
    expect(listed.json().map((row: { courseId: string }) => row.courseId)).toEqual([
      calls.id,
      privacy.id,
    ]);
    const one = await call('trainer', 'GET', `/assignments?courseId=${calls.id}`);
    expect(one.json()).toEqual([assignment]);

    const mine = (await call('tara', 'GET', '/me')).json();
    expect(mine.assigned).toMatchObject([
      { courseId: calls.id, dueDate: dayAfter(7), href: `/learning/courses/${calls.id}` },
    ]);
    expect(mine).toMatchObject({ continue: [], overdue: [], finished: [] });

    const removed = await call('trainer', 'DELETE', `/assignments/${assignment.id}`);
    expect(removed.statusCode).toBe(204);
    expect(removed.body).toBe('');
    expect((await call('trainer', 'DELETE', `/assignments/${assignment.id}`)).json()).toEqual(
      NOT_FOUND,
    );
    expect((await call('tara', 'GET', '/me')).json().assigned).toEqual([]);
  });

  it('says what is wrong with an assignment', async () => {
    const issuesOf = async (body: object) => {
      const reply = await call('trainer', 'POST', '/assignments', body);
      expect(reply.statusCode).toBe(400);
      return reply.json().error.issues;
    };
    const course = { type: 'course', id: calls.id };

    expect(await issuesOf({ target: course })).toEqual([
      { path: 'people', message: 'Choose at least one person or group.' },
    ]);
    expect(await issuesOf({ target: course, people: ['everyone'] })).toEqual([
      { path: 'people[0]', message: 'Choose people from the workspace.' },
    ]);
    expect(
      await issuesOf({
        target: course,
        people: [PEOPLE.tara.id],
        dueDate: dayAfter(3),
        dueInDays: 3,
      }),
    ).toEqual([{ path: 'dueInDays', message: 'Give a due date or a number of days, not both.' }]);
    expect(
      await issuesOf({ target: course, people: [PEOPLE.tara.id], dueDate: dayAfter(-2) }),
    ).toEqual([{ path: 'dueDate', message: 'Choose today or a later day.' }]);
    const unpublished = await call('trainer', 'POST', '/assignments', {
      target: { type: 'course', id: 'course-not-published' },
      people: [PEOPLE.tara.id],
    });
    expect(unpublished.json()).toEqual(NOT_FOUND);
    expect((await call('trainer', 'GET', '/assignments?courseId=has%20spaces')).statusCode).toBe(
      400,
    );
    expect((await call('trainer', 'DELETE', '/assignments/not-an-id')).statusCode).toBe(400);
  });

  it('shares its data with public.ts until the server closes', async () => {
    expect(boundAssignmentSources()).toBe(sources);
    expect(await isLearningEnabled(workspaceId)).toBe(true);
    const other = memorySources();
    const second = await appWith(async (server) => {
      await server.register(assignmentsRoutes, { sources: other });
    });
    expect(boundAssignmentSources()).toBe(other);
    await second.close();
    expect(boundAssignmentSources()).toBe(null);
    expect(await isLearningEnabled(workspaceId)).toBe(false);
  });
});

describe.skipIf(!hasDatabase)('Learning assignments API on Postgres', () => {
  let server: TestApp;
  let app: FastifyInstance;
  const call = caller(() => app);

  beforeAll(async () => {
    server = await createTestApp();
    app = await appWith(async (fastify) => {
      fastify.decorate('db', server.db);
      await fastify.register(learningRoutes, { prefix: '/api/learning' });
    });
  });

  afterAll(async () => {
    await app?.close();
    await server?.close();
  });

  it('lists and removes the assignments in the tables', async () => {
    const row = only(
      await assignmentStore(server.db).insert([
        {
          workspaceId,
          courseId: privacy.id,
          pathId: null,
          userIds: [PEOPLE.tara.id],
          groupIds: [],
          dueDate: null,
          dueInDays: 10,
          required: true,
          createdBy: PEOPLE.trainer.id,
        },
      ]),
    );
    expect((await call('tara', 'GET', '/assignments')).json()).toEqual(FORBIDDEN);
    expect((await call('trainer', 'GET', '/assignments')).json()).toMatchObject([
      { id: row.id, courseId: privacy.id, courseTitle: null, people: [PEOPLE.tara.id] },
    ]);
    // A course that was never published can't be assigned, and My learning leaves it out.
    const assign = { target: { type: 'course', id: privacy.id }, people: [PEOPLE.tara.id] };
    expect((await call('trainer', 'POST', '/assignments', assign)).json()).toEqual(NOT_FOUND);
    expect((await call('tara', 'GET', '/me')).json()).toEqual({
      continue: [],
      assigned: [],
      overdue: [],
      finished: [],
    });

    expect((await call('trainer', 'DELETE', `/assignments/${row.id}`)).statusCode).toBe(204);
    expect((await call('trainer', 'GET', '/assignments')).json()).toEqual([]);
  });

  it('assigns a published course and reads progress from the progress tables', async () => {
    // Published by the courses server; the progress row is the one the progress server keeps.
    await seedCourse(server.db, { userId: PEOPLE.trainer.id, workspaceId }, calls);
    const assign = { target: { type: 'course', id: calls.id }, people: [PEOPLE.tara.id] };
    const made = await call('trainer', 'POST', '/assignments', assign);
    expect(made.statusCode).toBe(201);
    expect((await call('trainer', 'GET', '/assignments')).json()).toMatchObject([
      { courseId: calls.id, courseTitle: calls.title, people: [PEOPLE.tara.id] },
    ]);
    const entry = { courseId: calls.id, title: calls.title, assigned: true };
    expect((await call('tara', 'GET', '/me')).json()).toMatchObject({
      continue: [],
      assigned: [{ ...entry, status: 'not_started', progressPercent: 0 }],
    });

    const at = new Date();
    await server.db.insert(learningProgress).values({
      workspaceId,
      learnerId: PEOPLE.tara.id,
      courseId: calls.id,
      version: 1,
      status: 'in_progress',
      percentComplete: 50,
      startedAt: at,
      lastActivityAt: at,
    });
    expect((await call('tara', 'GET', '/me')).json()).toMatchObject({
      continue: [{ ...entry, status: 'in_progress', progressPercent: 50 }],
      assigned: [],
    });
  });
});

describe('Learning assignment notices', () => {
  let app: FastifyInstance;
  const memory = memoryReminderSources({ courses: [calls] }, [`${PEOPLE.tara.id} ${calls.id}`]);
  const call = caller(() => app);

  beforeAll(async () => {
    app = await appWith(async (server) => {
      server.setErrorHandler((error, _request, reply) => {
        const { status, body } = errorReply(error);
        return reply.code(status).send(body);
      });
      const { sources } = memory;
      await server.register(assignmentsRoutes, {
        prefix: '/api/learning',
        sources,
        reminders: sources,
      });
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('tell the people assigned at once, and the assignment stands when they cannot', async () => {
    const assignment = { target: { type: 'course', id: calls.id }, people: [PEOPLE.tara.id] };
    expect((await call('trainer', 'POST', '/assignments', assignment)).statusCode).toBe(201);
    expect(memory.notices).toMatchObject([
      {
        userId: PEOPLE.tara.id,
        title: 'New course assigned',
        text: `You've been assigned “${calls.title}”.`,
        buttons: [{ label: 'Open course', href: `/learning/courses/${calls.id}` }],
      },
    ]);

    memory.outbox.failing = true;
    const stranger = randomUUID();
    const someoneElse = { ...assignment, people: [stranger] };
    expect((await call('trainer', 'POST', '/assignments', someoneElse)).statusCode).toBe(201);
    expect(memory.store.rows).toHaveLength(2);
    expect(memory.notices).toHaveLength(1);

    // The reminders job sends the one that didn't go out. It runs here as the jobs runner's test
    // hook runs it, as of the time it is given: at night in Denver nothing goes out, at midday it
    // does.
    memory.outbox.failing = false;
    const at = (time: string) => ({ now: new Date(`${learningToday()}T${time}:00Z`) });
    expect(await jobRunner.runPeriodicTask(REMINDERS_TASK, at('08:00'))).toBe(true);
    expect(memory.notices).toHaveLength(1);
    expect(await jobRunner.runPeriodicTask(REMINDERS_TASK, at('18:00'))).toBe(true);
    expect(memory.notices.map((notice) => notice.userId)).toEqual([PEOPLE.tara.id, stranger]);
  });
});

describe('Learning test hooks', () => {
  let off: FastifyInstance;
  let on: FastifyInstance;
  const memory = memoryReminderSources({ courses: [calls, privacy] });
  const callOff = caller(() => off);
  const call = caller(() => on);
  const otherWorkspace = randomUUID();
  const today = learningToday();
  const assignIn = async (workspace: string, courseId: string) =>
    only(
      await createAssignments(
        memory.sources,
        { userId: PEOPLE.trainer.id, workspaceId: workspace },
        CreateAssignmentsRequestSchema.parse({
          target: { type: 'course', id: courseId },
          people: [PEOPLE.tara.id],
        }),
        today,
      ),
    );
  const build = () =>
    appWith(async (server) => {
      server.setErrorHandler((error, _request, reply) => {
        const { status, body } = errorReply(error);
        return reply.code(status).send(body);
      });
      const { sources } = memory;
      await server.register(assignmentsRoutes, {
        prefix: '/api/learning',
        sources,
        reminders: sources,
      });
    });

  beforeAll(async () => {
    const before = process.env.CAREHUB_TEST_HOOKS;
    try {
      delete process.env.CAREHUB_TEST_HOOKS;
      off = await build();
      process.env.CAREHUB_TEST_HOOKS = '1';
      on = await build();
    } finally {
      if (before === undefined) delete process.env.CAREHUB_TEST_HOOKS;
      else process.env.CAREHUB_TEST_HOOKS = before;
    }
  });

  afterAll(async () => {
    await off?.close();
    await on?.close();
  });

  it('are not there without CAREHUB_TEST_HOOKS=1', async () => {
    const backdate = { dueDate: addDays(today, -1) };
    const url = `/test/assignments/${randomUUID()}`;
    expect((await callOff('trainer', 'POST', url, backdate)).statusCode).toBe(404);
  });

  it("move a due date into the past in the caller's workspace only", async () => {
    const created = await call('trainer', 'POST', '/assignments', {
      target: { type: 'course', id: privacy.id },
      people: [PEOPLE.tara.id],
      dueInDays: 7,
    });
    const { id } = only<{ id: string }>(created.json());
    const yesterday = addDays(today, -1);
    const url = `/test/assignments/${id}`;

    expect((await call(null, 'POST', url, { dueDate: yesterday })).json()).toEqual(SIGNED_OUT);
    expect((await call('tara', 'POST', url, { dueDate: yesterday })).json()).toEqual(FORBIDDEN);
    expect((await call('trainer', 'POST', url, { dueDate: 'yesterday' })).statusCode).toBe(400);
    const moved = await call('trainer', 'POST', url, { dueDate: yesterday });
    expect(moved.statusCode).toBe(200);
    expect(moved.json()).toMatchObject({
      id,
      courseId: privacy.id,
      dueDate: yesterday,
      dueInDays: null,
    });
    expect((await call('tara', 'GET', '/me')).json().overdue).toMatchObject([
      { courseId: privacy.id, dueDate: yesterday },
    ]);

    const elsewhere = await assignIn(otherWorkspace, privacy.id);
    const otherUrl = `/test/assignments/${elsewhere.id}`;
    expect((await call('trainer', 'POST', otherUrl, { dueDate: yesterday })).json()).toEqual(
      NOT_FOUND,
    );
    expect(memory.store.rows.find((row) => row.id === elsewhere.id)?.dueDate).toBe(null);
  });
});
