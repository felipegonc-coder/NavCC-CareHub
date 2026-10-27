import { z } from 'zod';
import type { JobRunner } from './domain/runner';
import { TEST_HOOK_TASKS } from './testHookTasks';

/** How far `now` may be from the real clock, either way. */
export const MAX_SHIFT_MS = 365 * 24 * 60 * 60 * 1000;

const params = z.object({ name: z.string().min(1).max(100) });
const body = z.strictObject({ now: z.iso.datetime({ offset: true }).optional() });

export interface TestHookCall {
  /** The signed-in user, or null. */
  userId: string | null;
  isSiteAdmin: boolean;
  params: unknown;
  body: unknown;
}

export interface TestHookOptions {
  runner: Pick<JobRunner, 'runPeriodicTask'>;
  log: { info(details: object, message: string): void };
  /** The allow-list. Defaults to `TEST_HOOK_TASKS`. */
  tasks?: Readonly<Record<string, string>>;
  /** The real clock. */
  now?: () => number;
}

export interface TestHookResult {
  task: string;
  ok: boolean;
  counts?: Record<string, number>;
  ms: number;
}

export type TestHookReply =
  | { status: 200; body: TestHookResult }
  | { status: 400 | 401 | 403 | 404 | 409; body: { error: { code: string; message: string } } };

const failure = (status: 400 | 401 | 403 | 404 | 409, code: string, message: string) => ({
  reply: { status, body: { error: { code, message } } } satisfies TestHookReply,
  result: code,
});

/**
 * `POST /api/jobs/test/periodic/:name` without the HTTP. Site admins only; the task must be on
 * the allow-list; `now` is used for this run only. Logs one line per call: the user id, task,
 * `now` and result.
 */
export async function runTestHook(
  call: TestHookCall,
  options: TestHookOptions,
): Promise<TestHookReply> {
  const tasks = options.tasks ?? TEST_HOOK_TASKS;
  const clock = options.now ?? Date.now;
  const name = params.safeParse(call.params);
  const input = body.safeParse(call.body ?? {});
  const task = name.success ? name.data.name : null;
  const now = input.success ? (input.data.now ?? null) : null;

  async function decide(): Promise<{ reply: TestHookReply; result: string }> {
    if (!call.userId) return failure(401, 'signed_out', 'Sign in to continue.');
    if (!call.isSiteAdmin) return failure(403, 'forbidden', "You don't have access to this.");
    const notFound = () => failure(404, 'not_found', "There's no such task for the test hook.");
    if (task === null || !Object.hasOwn(tasks, task)) return notFound();
    if (!input.success) {
      return failure(400, 'invalid', 'Send only now, as an ISO date and time, or nothing.');
    }
    if (now !== null && Math.abs(Date.parse(now) - clock()) > MAX_SHIFT_MS) {
      return failure(400, 'invalid', 'Give now within a year of the current time.');
    }
    const run = await options.runner.runPeriodicTask(task, now ? { now: new Date(now) } : {});
    if (run.status === 'unknown') return notFound();
    if (run.status === 'busy') {
      return failure(409, 'busy', 'This task is running now. Try again in a moment.');
    }
    const result: TestHookResult = { task, ok: run.status === 'ran', ms: run.ms };
    if (run.counts) result.counts = run.counts;
    return { reply: { status: 200, body: result }, result: run.status };
  }

  let result = 'error';
  try {
    const decided = await decide();
    result = decided.result;
    return decided.reply;
  } finally {
    options.log.info({ userId: call.userId, task, now, result }, 'jobs: test hook');
  }
}
