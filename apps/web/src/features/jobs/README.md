# jobs (web)

Follows a background job the user started, such as an import or Send to everyone now. Server
side: `apps/server/src/features/jobs`.

- `useJob(jobId)` returns the job's latest state from `GET /api/jobs/:jobId` as a TanStack Query
  result. It refetches when the server nudges (`job-updated` over live updates) and after a live
  reconnect. While the job is queued or running it also polls every 5 s, in case a nudge doesn't
  arrive. With no `jobId` it waits.
- `JobView` has `jobId`, `kind`, `status`, `attempts`, `cancelRequested`, `progress`, `result`,
  `error` (safe to show) and the `createdAt`, `startedAt` and `finishedAt` times.
- Errors are `JobRequestError` (`status`, `code`, `message`), shaped like the web `ApiError`
  until that client lands. A 4xx answer (signed out, deleted, someone else's job) isn't retried.
- `jobQueryKey(jobId)` is `['jobs', jobId]`, for invalidating or seeding the cache.
