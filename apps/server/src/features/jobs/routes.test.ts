import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryJobStore } from './domain/memoryStore';
import { createJobRunner, type JobRunner } from './domain/runner';
import jobsRoutes, { type JobsRoutesOptions } from './routes';

let app: FastifyInstance | undefined;
let runner: JobRunner;

async function build(options: Partial<JobsRoutesOptions> = {}): Promise<FastifyInstance> {
  runner = createJobRunner({ store: createMemoryJobStore() });
  runner.registerHandler('automations.run', async () => ({ rows: 3 }));
  app = Fastify();
  await app.register(jobsRoutes, {
    prefix: '/api/jobs',
    runner,
    getUserId: (request) => {
      const user = request.headers['x-test-user'];
      return typeof user === 'string' ? user : null;
    },
    isSiteAdmin: (request) => request.headers['x-test-site-admin'] === '1',
    ...options,
  });
  return app;
}

const as = (user: string) => ({ 'x-test-user': user });
const asSiteAdmin = (user: string) => ({ ...as(user), 'x-test-site-admin': '1' });
const later = () => new Date(Date.now() + 60 * 60_000);

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('GET /api/jobs/:jobId', () => {
  it('shows the owner their job', async () => {
    const api = await build();
    const { jobId } = await runner.schedule({
      kind: 'automations.run',
      payload: { automationId: 'auto-1' },
      ownerUserId: 'user-avery',
      runAt: later(),
    });
    const response = await api.inject({
      method: 'GET',
      url: `/api/jobs/${jobId}`,
      headers: as('user-avery'),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      job: {
        jobId,
        kind: 'automations.run',
        status: 'queued',
        attempts: 0,
        cancelRequested: false,
        progress: null,
        result: null,
        error: null,
        startedAt: null,
        finishedAt: null,
      },
    });
    expect(response.json()).not.toHaveProperty('job.payload');
  });

  it('answers 401 when signed out, 404 for unknown jobs and 403 for other people', async () => {
    const api = await build();
    const { jobId } = await runner.schedule({
      kind: 'automations.run',
      payload: {},
      ownerUserId: 'user-avery',
      runAt: later(),
    });
    const get = (url: string, headers = {}) => api.inject({ method: 'GET', url, headers });
    expect((await get(`/api/jobs/${jobId}`)).statusCode).toBe(401);
    expect((await get('/api/jobs/no-such-job', as('user-avery'))).statusCode).toBe(404);
    expect((await get(`/api/jobs/${jobId}`, as('user-sam'))).statusCode).toBe(403);
  });
});

describe('POST /api/jobs/:jobId/cancel', () => {
  it('cancels the owner’s queued job', async () => {
    const api = await build();
    const { jobId } = await runner.schedule({
      kind: 'automations.run',
      payload: {},
      ownerUserId: 'user-avery',
      runAt: later(),
    });
    const refused = await api.inject({
      method: 'POST',
      url: `/api/jobs/${jobId}/cancel`,
      headers: as('user-riley'),
    });
    expect(refused.statusCode).toBe(403);
    const response = await api.inject({
      method: 'POST',
      url: `/api/jobs/${jobId}/cancel`,
      headers: as('user-avery'),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ job: { jobId, status: 'cancelled' } });
    expect((await runner.get(jobId))?.status).toBe('cancelled');
  });
});

describe('runner lifecycle', () => {
  it('runs jobs once the app is ready', async () => {
    const api = await build();
    await api.ready();
    const { jobId } = await runner.schedule({
      kind: 'automations.run',
      payload: {},
      ownerUserId: 'user-avery',
    });
    for (let i = 0; i < 100 && (await runner.get(jobId))?.status !== 'succeeded'; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(await runner.get(jobId)).toMatchObject({ status: 'succeeded', result: { rows: 3 } });
  });

  it('lets an app built while another is open share the running runner and its store', async () => {
    const first = await build();
    await first.ready();
    const second = Fastify();
    // Never used: the runner is running, so it keeps the first app's store.
    const sql = {} as NonNullable<JobsRoutesOptions['sql']>;
    await second.register(jobsRoutes, { prefix: '/api/jobs', runner, sql });
    await second.ready();
    await second.close();
    expect(runner.isRunning()).toBe(true);
    const { jobId } = await runner.schedule({
      kind: 'automations.run',
      payload: {},
      ownerUserId: 'user-avery',
      runAt: later(),
    });
    expect((await runner.get(jobId))?.status).toBe('queued');
  });
});

describe('POST /api/jobs/test/periodic/:name', () => {
  const MINUTE = 60_000;

  async function buildWithTask() {
    const api = await build({ testHooks: true });
    const times: string[] = [];
    runner.registerPeriodicTask('reminders.sweep', MINUTE, async (ctx) => {
      times.push(ctx.now.toISOString());
    });
    const post = (name: string, headers: Record<string, string>, payload?: object) =>
      api.inject({ method: 'POST', url: `/api/jobs/test/periodic/${name}`, headers, payload });
    return { times, post };
  }

  it('runs the task once at the given time for a site admin', async () => {
    const { times, post } = await buildWithTask();
    const now = '2026-10-26T15:00:00.000Z';
    const response = await post('reminders.sweep', asSiteAdmin('user-avery'), { now });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ task: 'reminders.sweep', now });
    expect(times).toEqual([now]);
  });

  it('uses the current time without one', async () => {
    const { times, post } = await buildWithTask();
    const before = Date.now();
    expect((await post('reminders.sweep', asSiteAdmin('user-avery'))).statusCode).toBe(200);
    expect(times).toHaveLength(1);
    const ran = Date.parse(times[0] ?? '');
    expect(ran >= before && ran <= Date.now()).toBe(true);
  });

  it('answers 401 signed out, 403 for others, 400 for a bad time and 404 for no such task', async () => {
    const { times, post } = await buildWithTask();
    expect((await post('reminders.sweep', {})).statusCode).toBe(401);
    expect((await post('reminders.sweep', as('user-sam'))).statusCode).toBe(403);
    const bad = await post('reminders.sweep', asSiteAdmin('user-avery'), { now: 'Monday' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ error: { code: 'invalid' } });
    const unknown = await post('reminders.nothing', asSiteAdmin('user-avery'));
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toMatchObject({ error: { code: 'not_found' } });
    expect(times).toEqual([]);
  });

  it('is there only with CAREHUB_TEST_HOOKS=1', async () => {
    const previous = process.env.CAREHUB_TEST_HOOKS;
    const post = (api: FastifyInstance) =>
      api.inject({
        method: 'POST',
        url: '/api/jobs/test/periodic/jobs.cleanup',
        headers: asSiteAdmin('user-avery'),
      });
    try {
      delete process.env.CAREHUB_TEST_HOOKS;
      expect((await post(await build())).statusCode).toBe(404);
      await app?.close();
      process.env.CAREHUB_TEST_HOOKS = '1';
      expect((await post(await build())).statusCode).toBe(200);
    } finally {
      if (previous === undefined) delete process.env.CAREHUB_TEST_HOOKS;
      else process.env.CAREHUB_TEST_HOOKS = previous;
    }
  });
});
