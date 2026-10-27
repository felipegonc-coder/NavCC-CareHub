import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { JobRunner } from './domain/runner';
import type { Job, JobProgress, JobStatus, JsonValue } from './domain/types';
import { jobRunner } from './index';
import { createPostgresJobStore, type SqlRunner } from './store';
import { sqlRunnerFor } from './sql';

export interface JobsRoutesOptions {
  /** The signed-in user's id, or null (401). Defaults to `request.user?.id`. */
  getUserId?: (
    request: FastifyRequest,
  ) => string | null | undefined | Promise<string | null | undefined>;
  /** The database. Defaults to `app.db`; without either, jobs live in memory (unit tests). */
  sql?: SqlRunner;
  /** Defaults to the app-wide runner. */
  runner?: JobRunner;
}

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
};

export default jobsRoutes;
