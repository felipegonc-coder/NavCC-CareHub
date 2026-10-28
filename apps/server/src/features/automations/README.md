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
| `finishRun(runId, outcome, now)`                                    | Once per run; keeps the latest 100 runs of each automation                                                                                                                         |
| `countHourlyRun(id, now)`                                           | The runs so far this hour, for the limit of 1,000 an hour on database automations                                                                                                  |

Tables: `automations_automations` and `automations_runs` (`migrations/202610270700_automations_create_tables.sql`). On `app.db` the store takes `sqlRunnerFor(app.db)` from `features/jobs`.

## Routes (`routes.ts`, mounted at `/api/automations`)

Admins only (AU-D1): `app.requirePermission('workspace.admin')` answers 401 when signed out and 403
for anyone else, guests and people outside the workspace included (AU-09). It uses `app.db`, and
`request.member` for the workspace. Options for tests: `store` and `now`. Bodies are checked with
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
- Errors use the shared shape: 401 `signed_out`, 403 `forbidden`, 404 `not_found` (also for
  another workspace's automation), 400 `invalid` with `details` (each with the field's `path`,
  such as `['actions', 0, 'recipients']`), and 413 `too_large` past 50 automations (AU-11).

## Coming next

Each part is its own pull request: running through background jobs (`automations.run`), the Form
response and Row added triggers, the Send a message and Add a row actions, then the screens.
