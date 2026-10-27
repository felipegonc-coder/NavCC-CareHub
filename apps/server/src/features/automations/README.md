# Automations (server)

Things the server does by itself: messages on a schedule, and actions when something happens in a database. Spec: Automations (v2). Managing automations is for Admins only (AU-D1). Schedules, the parts of an automation (triggers, actions, run steps) and the save checks come from `@carehub/team-automations`, which the web app uses too.

This folder grows in small parts. What's here now:

## Storage: `domain/types.ts`, `store.ts`

An `Automation` has a name, an owner, on or off, one `trigger`, optional `conditions` (a Databases filter), `variables` and up to 10 `actions`, plus its next planned run and why the server paused it, if it did. Triggers and actions are JSON in the database, so the later kinds (Property changed, Date arrives, Edit the row…) need no migration. A `Run` has a `kind` (`scheduled`, `test`, `manual` or `triggered`), a `key`, the planned time, when it ran, its `result` (`sent`, `failed`, `skipped`, `missed`, or `null` while running), each step's result, the number of recipients and the error.

`AutomationStore` (`createPostgresAutomationStore(db)` in `store.ts`, `createMemoryAutomationStore()` for unit tests; both pass `domain/storeContract.ts`):

| Method                                                              | Does                                                                                                                                                                               |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list(workspaceId, { databaseId?, ownerUserId?, enabled? })`, `get` | Sorted by name, each with its `lastRun` (the latest finished run that wasn't a test)                                                                                               |
| `create(input, now)`                                                | `null` when the workspace already has 50 (AU-11). Each automation takes a free slot from 1 to 50, so the limit holds with several servers                                          |
| `update(workspaceId, id, patch, now)`, `remove`                     | Changes only the fields in the patch; removing deletes the runs too                                                                                                                |
| `due(now, limit)`, `moveNextRun(id, from, to)`                      | Switched-on automations whose next run is due; moving the next run succeeds for one server only                                                                                    |
| `startRun(input)`                                                   | One run per automation and `key` (`scheduled:<planned time>`, `row:<row id>`…), even across restarts (AU-06). With an `outcome` it logs a run that never ran, such as a missed one |
| `saveSteps(runId, steps, recipients)`                               | Saves the steps a running run has done so far, so a retry carries on after them                                                                                                    |
| `finishRun(runId, outcome, now)`                                    | Once per run; keeps the latest 100 runs of each automation                                                                                                                         |
| `countHourlyRun(id, now)`                                           | The runs so far this hour, for the limit of 1,000 an hour on database automations                                                                                                  |

Tables: `automations_automations` and `automations_runs` (`migrations/202610270700_automations_create_tables.sql`). On `app.db` the store takes `sqlRunnerFor(app.db)` from `features/jobs`.

## Routes (`routes.ts`, mounted at `/api/automations`)

Admins only (AU-D1): anyone else gets 403 (AU-09). It uses `app.db`, `request.user` and
`request.member`; until the roles PR adds `request.member`, every request gets 403. Options for
tests: `store`, `getMember(request)` and `now`. Bodies are checked with
`@carehub/team-automations/validate`; answers use the views in `@carehub/team-automations/api`
(times as ISO strings).

- `GET /` returns `{ automations }`, sorted by name. Filters: `databaseId`, `ownerUserId`,
  `enabled` (`true` or `false`).
- `POST /` creates one, owned by the caller: 201 with `{ automation }`. Scheduled ones get their
  `nextRunAt`.
- `GET /:id` returns `{ automation }`. `PATCH /:id` changes only the fields sent. Switching it off
  clears `nextRunAt`. Switching it on, or changing the trigger, plans the next run at least 15
  minutes after the last scheduled run. Switching it on also clears `pausedReason`.
- `DELETE /:id` deletes it and its runs: 204.
- `GET /:id/runs` returns `{ runs }`, the latest 100, newest first (run keys stay on the server).
- `POST /:id/try` with `{ to: 'me' }` (Send only to me, the default) or `{ to: 'everyone' }`
  (Send to everyone now) queues a run: 202 with `{ jobId }`. Each click is its own run. The
  presser owns the job, so the web app can watch it (`useJob`) and keep the button busy.
- Errors use the shared shape: 401 `signed_out`, 403 `forbidden`, 404 `not_found` (also for
  another workspace's automation), 400 `invalid` with `details` (each with the field's `path`,
  such as `['actions', 0, 'recipients']`), and 413 `too_large` past 50 automations (AU-11).

## Running (`running.ts`)

`routes.ts` starts it with the app, on the job runner from `features/jobs`:

- **The scheduler** (periodic task `automations.scheduler`, every minute, one at a time across
  servers) takes the due automations. For each, it logs the planned runs that are an hour late or
  more as missed ("Missed: the server was off"), queues the latest one that isn't as an
  `automations.run` job, then moves the next run on, at least 15 minutes after this one. A Once
  automation switches itself off once its run is queued or missed (AU-08).
- **The run job** (`automations.run`) starts the run with its key, runs the actions in order and
  finishes the run. Jobs run at least once, but the key gives one run per planned time (AU-06),
  and a retry carries on after the steps already done (`saveSteps`). A job that starts an hour
  late or more logs its run as missed instead (AU-05). The run history works out "Ran 25 minutes
  late" from `plannedFor` and `ranAt` (`describeRunTiming` in the package).
- **Failures:** a `StepError` ("Pick at least one recipient.") fails its step at once, and the
  later steps are skipped (AU-18). Any other error is tried 3 more times, about 1, 2 and 4 minutes
  apart, then logged as Failed with "Something went wrong." (AU-07). A failed run tells the owner
  in their 🔔 chat (from "Automation: " and the name), except for Send only to me.
- **Try it now:** `queueRun(automation, { kind: 'test' | 'manual', startedBy })` queues a run
  with a new key per click, so Send to everyone now runs once per click. In a test run the
  actions get `onlyTo`, the presser, and a failure tells no one else.
- **Actions** come from `performers`: one function per action kind, given the action and
  `{ automation, run, step, onlyTo, signal }`, returning `{ message, recipients? }`. None are
  plugged in yet, so until Send a message and Add a row land, their steps fail with "This action
  can't run yet."

## Coming next

Each part is its own pull request: the Send a message action, the Form response and Row added
triggers with the Add a row action, then the screens.
