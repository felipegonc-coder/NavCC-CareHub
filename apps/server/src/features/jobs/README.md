# jobs

Background jobs on a Postgres queue: claimed with `FOR UPDATE SKIP LOCKED`, retried with
exponential backoff, timed out through `AbortSignal`, and taken over when a worker crashes.
At least once: make handlers idempotent (unique keys, check state before acting). Payloads
are ids only, never secrets or file contents.

## Exports (`index.ts`)

| Export                                                                                                                                                                                                    | What it does                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `registerJobHandler<P>(kind, handler, options?)`                                                                                                                                                          | Handles jobs of `kind`, named after your feature (`reminders.fire`). `handler(payload, ctx)` returns JSON (at most 64 KB) or nothing. Options: `maxAttempts` (3), `timeoutMs` (5 minutes, at most 30), `concurrency` per process (1), and `onFailed(payload, { jobId, attempts, error })`, called once when a job fails for good (after its last attempt fails, times out or stops responding). |
| `scheduleJob<P>({ kind, payload, key?, runAt?, workspaceId?, ownerUserId? }, { db? })`                                                                                                                    | Queues a job; returns `{ jobId, created }`. With `key`, an unfinished job of the same kind and key is returned instead (`created: false`). Payload JSON at most 16 KB. Pass your transaction as `db` to queue the job with your own writes: it exists only if the transaction commits, and starts within 5 s of the commit.                                                                     |
| `getJob(jobId)` / `cancelJob(jobId)`                                                                                                                                                                      | Reads a job; cancels a queued one or aborts a running one. Null when unknown.                                                                                                                                                                                                                                                                                                                   |
| `registerPeriodicTask(name, everyMs, run)`                                                                                                                                                                | Runs `run(ctx)` on a grid of `everyMs` (at least 1 s), one run at a time across processes. A failed run is logged and waits for the next slot.                                                                                                                                                                                                                                                  |
| `class JobError(message, { retry? })`                                                                                                                                                                     | A failure whose message the user may see. Permanent unless `retry: true`. Other errors are retried and shown as "Something went wrong."                                                                                                                                                                                                                                                         |
| `sqlRunnerFor(db)`                                                                                                                                                                                        | A `SqlRunner` (`query(sql, params)` with `$1`-style parameters) on `app.db` or a Drizzle transaction, for stores written in plain SQL.                                                                                                                                                                                                                                                          |
| types `JobContext`, `JobFailure`, `Job`, `JobStatus`, `JobProgress`, `JsonValue`, `JobHandler`, `JobHandlerOptions`, `ScheduleJobInput`, `ScheduleJobOptions`, `PeriodicTask`, `SqlRunner`, `SqlExecutor` |                                                                                                                                                                                                                                                                                                                                                                                                 |
| `jobRunner`                                                                                                                                                                                               | The app-wide runner (for `routes.ts` and tests).                                                                                                                                                                                                                                                                                                                                                |

`JobContext` is `{ jobId, attempt, lateByMs, signal, setProgress({ done, total?, label? }) }`.
`lateByMs` counts from the time the job was due, retries included. `signal` aborts on timeout,
cancel and shutdown. Progress is saved at most twice a second.

Periodic tasks get a `PeriodicTaskContext`: the same, plus `now`, the time the run counts as
(when it started, or the time the test hook gave). Use `ctx.now` to decide what's due, so
end-to-end tests can pick the time, but save times from the real clock. A task may return counts,
such as `{ sent: 2 }`, for the test hook to report. `isTestHookRun()` is true inside a test-hook
run and the work it starts: anything that sends outside the server (email, push, webhooks) checks
it and skips the send.

Owners get `{ type: 'job-updated', data: { jobId } }` over live updates when their job starts,
makes progress and ends.

Retries wait about 1, 2, 4… minutes (at most an hour, give or take 20%). A job whose worker
stops responding is taken over once its lock (timeout plus a minute) runs out; after
`maxAttempts` such attempts it fails. On shutdown, running jobs get 5 s to finish, then are put
back in the queue without using up an attempt. Finished jobs are deleted after 7 days.

## Tests

`drainJobsForTest({ now? })` from `testing.ts` runs every due job, and due retries, in the test
process. Periodic tasks don't run there: call your task function directly (or, end to end, use
the test hook below). Without the database
(jobs in memory), `scheduleJob(input, { db })` queues the job at once.

## Routes (`routes.ts`, mounted at `/api/jobs`)

Register with `await app.register(import('./features/jobs/routes'), { prefix: '/api/jobs' });`.
It uses `app.db` and `request.user`. Options for tests: `getUserId(request)`, `sql` (a node-postgres
pool or client; without it or `app.db`, jobs live in memory) and `runner`. The plugin starts the
runner when the app is ready and stops it on close. `sqlRunnerFor(db)` (`sql.ts`) runs the plain
SQL stores on `app.db` or a transaction.

- `GET /api/jobs/:jobId` returns `{ job }` to its owner: `{ jobId, kind, status, attempts,
cancelRequested, progress, result, error, createdAt, startedAt, finishedAt }`.
- `POST /api/jobs/:jobId/cancel` cancels it and returns `{ job }`.
- Errors use the shared shape `{ error: { code, message } }`: 401 `signed_out`, 404 `not_found`
  (no such job) and 403 `forbidden` (someone else's job).
- Test hook, only when `CAREHUB_TEST_HOOKS=1` (end-to-end test servers, never production):
  `POST /api/jobs/test/periodic/:name` with `{ now? }` (an ISO date and time within a year of the
  current time; default the current time) runs that periodic task once, at once and off its
  grid, with `ctx.now` set to `now`, and returns `{ task, ok, counts?, ms }`.
  - `now` applies to that one call only. It's never stored: the queue keeps the real clock, and
    the task's next scheduled run stays on its slot.
  - Only the tasks on the allow-list in `testHookTasks.ts` run, each with its reason (none yet).
    Any other name is 404 `not_found`. Deletions, purges, retention and anything that sends
    outside the server stay off it.
  - It takes the scheduler's lock without waiting. While a run is going, here or in another
    process, it's 409 `busy`: "This task is running now. Try again in a moment."
  - Site admins only: 401 `signed_out`, 403 `forbidden`. 400 `invalid` for any other body field
    or a bad or far-off time.
  - Each call logs one line: the user id, task, `now` and result.
  - Options for tests: `testHooks`, `testHookTasks` and `isSiteAdmin(request)`. The logic is in
    `testHook.ts`.

## Data

Table `jobs_queue` (migration `202610270100_jobs_create_queue.sql`), with partial indexes for
key dedupe among unfinished jobs, due jobs, expired locks and clean-up. `store.ts` is the
Postgres store; `domain/memoryStore.ts` keeps the same rules in memory. Both pass the same
contract tests (`domain/storeContract.ts`); the Postgres run needs `DATABASE_URL` and `pg`.
