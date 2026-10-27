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

## Coming next

Each part is its own pull request: Admin-only routes, running through background jobs (`automations.run`), the Form response and Row added triggers, the Send a message and Add a row actions, run history, then the screens.
