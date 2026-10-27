# @carehub/team-automations

Automations for the Team tools lane: the parts both the server and the web app need. Spec:
Automations (v2). There are four: schedules (`schedule`), what an automation is made of
(`automation`), the checks on saving one (`validate`) and what the API answers (`api`).

Import by file, such as `@carehub/team-automations/schedule`. Everything is pure, built on
`@carehub/team-time` and zod; the caller passes `now`.

## Schedules: `schedule`

A `Schedule` is `once` (on a `date`), `daily`, `weekdays` (Monday to Friday), `weekly` (`days`,
`0` Sunday to `6` Saturday) or `monthly` (`dayOfMonth` 1 to 28, or `'last'`). Each has a `time`
(`'HH:mm'`, on the quarter hour) and a `timeZone` (IANA name); repeating ones also have an
`endDate` (the last day with a run) or `null`.

| Export                                                                                     | What it's for                                                                                                                                                           |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nextRun(schedule, after)`                                                                 | The first planned run strictly after `after`, or `null` when none is left (a Once that has run, or past the end date)                                                   |
| `planNextRun(schedule, now, lastRanAt?)`                                                   | The run to plan next, at least 15 minutes after the last scheduled run                                                                                                  |
| `runTiming(plannedFor, now)`                                                               | `on-time` (under a minute), `late` (under an hour, with the minutes) or `missed`                                                                                        |
| `describeRunTiming(timing)`                                                                | `'Ran 25 minutes late'`, `'Missed: the server was off'`, or `null` when on time                                                                                         |
| `catchUp(schedule, plannedFor, now, keep?)`                                                | After the server was off: the runs still `due` (less than an hour late), the `missed` ones to log (the latest `keep`, default 100) and the `next` run ahead             |
| `scheduleProblems(schedule, now)`                                                          | Save errors naming their field: `'Pick at least one day.'`, `'That time has already passed.'`, `'That end date has already passed.'`…                                   |
| `describeSchedule(schedule, prefs)`                                                        | `'Weekdays at 9:00 AM'`, `'Every Monday and Thursday at 2:30 PM until Dec 18, 2026'`; names the zone when it isn't the reader's: `'Every day at 9:00 AM (Lisbon time)'` |
| `Schedule`, `ScheduleKind`, `ScheduleProblem`, `RunTiming`                                 | The types                                                                                                                                                               |
| `MIN_MINUTES_BETWEEN_RUNS`, `LATE_AFTER_MINUTES`, `MISSED_AFTER_MINUTES`, `MISSED_MESSAGE` | 15, 1 and 60 minutes, and the words for a missed run                                                                                                                    |

## How it behaves

- Times are wall-clock times in the schedule's own time zone, so "9:00 AM" stays 9:00 AM across
  clock changes. A time that doesn't exist that day (clocks going forward) runs at the next valid
  time; a time that happens twice (clocks going back) runs once, the first time.
- Scheduled runs are at least 15 minutes apart: pass the last scheduled run as `lastRanAt`. Try
  it now and Send to everyone now are outside the gap, though they count toward the run limits,
  which the server keeps.
- A run less than an hour late still runs and shows how late it was; anything later is logged as
  missed.

## Automations: `automation`

Triggers and actions are stored as JSON, so new kinds need no migration.

| Export                                                  | What it's for                                                                                                                                                                 |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Trigger`                                               | `schedule` (a `Schedule`), `rowAdded` (`databaseId`, and `includeImports`, off by default) or `formResponse` (`databaseId`, `formId`)                                         |
| `Action`                                                | `sendMessage` (`recipients`, `text` with fill-ins such as {first name}, up to 3 `pageIds`) or `addRow` (`databaseId`, `templateId`, `values`)                                 |
| `Recipient`                                             | A `person`, a `role`, `everyone`, or the row's `personProperty`                                                                                                               |
| `ValueSource`, `PropertyValue`                          | Where an Add a row value comes from: a `value`, `now`, `today`, `triggeredBy`, a `rowProperty` or a `formula`                                                                 |
| `Variable`                                              | A named formula, worked out before the actions run                                                                                                                            |
| `RunKind`, `RunResult`, `RunStep`, `RunSource`          | Run history: `scheduled`, `test`, `manual` or `triggered`; `sent`, `failed`, `skipped` or `missed`; each step's result; the row that fired it                                 |
| `MAX_AUTOMATIONS`, `RUNS_KEPT`, `LIMITS`                | 50 per workspace, the latest 100 runs kept, and the editor's limits (10 actions, 10 variables, 500 recipients, 2,000 characters, 3 page cards)                                |
| `databasesUsed(trigger, actions)`                       | Every database an automation uses, for the list's database filter                                                                                                             |
| `newRowFires(trigger, row)`, `AddedRow`, `ChangeSource` | Whether a new row (`{ databaseId, source, formId? }`) fires the trigger. Never for rows added by automations, so automations can't loop; imports only with Include imports on |
| `Json`, `TriggerKind`, `ActionKind`                     | The types                                                                                                                                                                     |

## Checks: `validate`

| Export                                | What it's for                                                                                                                                                                                              |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `automationInput`                     | The zod schema for a new automation. It fills in `enabled: true`, no conditions and no variables                                                                                                           |
| `automationChanges`                   | The same fields, each one optional, for a change                                                                                                                                                           |
| `automationListQuery`                 | The list's filters from the query string: `databaseId`, `ownerUserId`, `enabled` (`'true'` or `'false'`)                                                                                                   |
| `tryNowInput`                         | Try it now's body: `{ to: 'me' }` (Send only to me, the default) or `{ to: 'everyone' }`                                                                                                                   |
| `automationProblems(automation, now)` | The rules zod can't check, each with its field's `path`: `'Pick at least one recipient.'`, `'Write a message.'`, `'Conditions need a database trigger.'`, `'A Person property needs a database trigger.'`… |
| `Problem`, `AutomationInput`          | The types                                                                                                                                                                                                  |

Zod's own messages are worded for the editor too: `'Give it a name.'`, `'Add at least one action.'`,
`'Add up to 10 actions.'`… Schedule problems come from `scheduleProblems`. A time or end date
that has passed counts only while the automation is on, so a finished Once automation can still be
renamed.

## API answers: `api`

What `/api/automations` sends, with times as ISO strings: `AutomationView` (the automation, its
`nextRunAt`, `pausedReason` and `lastRun`), `RunView` (a run in the history: kind, times, result,
source, steps, recipients and error) and the bodies `AutomationListResponse` (`{ automations }`),
`AutomationResponse` (`{ automation }`) and `RunListResponse` (`{ runs }`). Try it now answers
`TryNowResponse` (`{ jobId }`).
