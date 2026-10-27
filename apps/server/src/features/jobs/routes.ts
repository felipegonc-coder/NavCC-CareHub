import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { readSettings } from '../../core/settings';
import type { JobRunner } from './domain/runner';
import type { Job, JobProgress, JobStatus, JsonValue } from './domain/types';
import { jobRunner } from './index';
import { createPostgresJobStore, type SqlRunner } from './store';
import { sqlRunnerFor } from './sql';
import { runTestHook } from './testHook';

export interface JobsRoutesOptions {
  /** The signed-in user's id, or null (401). Defaults to `request.user?.id`. */
  getUserId?: (
    request: FastifyRequest,
  ) => string | null | undefined | Promise<string | null | undefined>;
  /** The database. Defaults to `app.db`; without either, jobs live in memory (unit tests). */
  sql?: SqlRunner;
  /** Defaults to the app-wide runner. */
  runner?: JobRunner;
  /** Adds the test hook below. Defaults to the CAREHUB_TEST_HOOKS setting. */
  testHooks?: boolean;
  /** Whether the signed-in user is a site admin. Defaults to `request.user?.isSiteAdmin`. */
  isSiteAdmin?: (request: FastifyRequest) => boolean | Promise<boolean>;
  /** The test hook's allow-list. Defaults to `TEST_HOOK_TASKS` (`testHookTasks.ts`). */
  testHookTasks?: Readonly<Record<string, string>>;
}

/** Decision 0007, section 2.3. Only end-to-end test servers set it; never production. */
const testSettings = z.object({
  /** "1" adds `POST /api/jobs/test/periodic/:name`. */
  CAREHUB_TEST_HOOKS: z.enum(['0', '1']).optional(),
});

/** What the owner sees of a job. */
export interface JobView {
  jobId: string;
  kind: string;
  status: JobStatus;
  attempts: number;
  cancelRequested: boolean;
  progress: JobProgress | null;
  result: JsonValue | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export function toJobView(job: Job): JobView {
  return {
    jobId: job.id,
    kind: job.kind,
    status: job.status,
    attempts: job.attempts,
    cancelRequested: job.cancelRequested,
    progress: job.progress,
    result: job.result,
    error: job.error,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
  };
}

const params = z.object({ jobId: z.string().min(1).max(100) });

/** Sends the shared error shape, `{ error: { code, message } }`. */
function sendError(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
): FastifyReply {
  return reply.code(status).send({ error: { code, message } });
}

/** Starts the runner when the app is ready and stops it on close. Owners read and cancel jobs. */
const jobsRoutes: FastifyPluginAsync<JobsRoutesOptions> = async (app, options) => {
  const runner = options.runner ?? jobRunner;
  const sql = options.sql ?? (app.hasDecorator('db') ? sqlRunnerFor(app.db) : undefined);
  if (sql) runner.useStore(createPostgresJobStore(sql));
  const getUserId = options.getUserId ?? ((request: FastifyRequest) => request.user?.id);
  runner.setLogger(app.log);
  app.addHook('onReady', async () => {
    await runner.start();
  });
  app.addHook('preClose', (done) => {
    runner.stop().then(() => done(), done);
  });

  /** The job, if it's the signed-in user's; otherwise sends the error and returns null. */
  async function ownJob(request: FastifyRequest, reply: FastifyReply): Promise<Job | null> {
    const userId = await getUserId(request);
    if (!userId) {
      sendError(reply, 401, 'signed_out', 'Sign in to continue.');
      return null;
    }
    const parsed = params.safeParse(request.params);
    const job = parsed.success ? await runner.get(parsed.data.jobId) : null;
    if (!job) {
      sendError(reply, 404, 'not_found', 'This was deleted, or the link is wrong.');
      return null;
    }
    if (job.ownerUserId !== userId) {
      sendError(reply, 403, 'forbidden', "You don't have access to this.");
      return null;
    }
    return job;
  }

  app.get('/:jobId', async (request, reply) => {
    const job = await ownJob(request, reply);
    return job ? { job: toJobView(job) } : reply;
  });

  app.post('/:jobId/cancel', async (request, reply) => {
    const job = await ownJob(request, reply);
    if (!job) return reply;
    return { job: toJobView((await runner.cancel(job.id)) ?? job) };
  });

  const testHooks =
    options.testHooks ?? readSettings(testSettings, { log: app.log }).CAREHUB_TEST_HOOKS === '1';
  if (!testHooks) return;
  const isSiteAdmin =
    options.isSiteAdmin ?? ((request: FastifyRequest) => request.user?.isSiteAdmin === true);

  /** Test hook: runs an allow-listed periodic task once now, as if it were `now` (`testHook.ts`). */
  app.post('/test/periodic/:name', async (request, reply) => {
    const userId = (await getUserId(request)) ?? null;
    const outcome = await runTestHook(
      {
        userId,
        isSiteAdmin: userId !== null && (await isSiteAdmin(request)),
        params: request.params,
        body: request.body,
      },
      { runner, log: app.log, tasks: options.testHookTasks },
    );
    return reply.code(outcome.status).send(outcome.body);
  });
};

export default jobsRoutes;
