import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryJobStore } from './domain/memoryStore';
import { createJobRunner, type JobRunner } from './domain/runner';
import jobsRoutes from './routes';

let app: FastifyInstance | undefined;
let runner: JobRunner;

async function build(): Promise<FastifyInstance> {
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
  });
  return app;
}

const as = (user: string) => ({ 'x-test-user': user });
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
});
