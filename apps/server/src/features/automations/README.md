# Automations (server)

Things the server does by itself: messages on a schedule, and actions when something happens in a database. Spec: Automations (v2). Managing automations is for Admins only (AU-D1).

This folder grows in small parts. What's here now:

## Schedules: `domain/schedule.ts`

Pure functions on `@carehub/team-time`; the caller passes `now`. A `Schedule` is `once` (on a `date`), `daily`, `weekdays` (Monday to Friday), `weekly` (`days`, `0` Sunday to `6` Saturday) or `monthly` (`dayOfMonth` 1 to 28, or `'last'`). Each has a `time` (`'HH:mm'`, on the quarter hour) and a `timeZone` (IANA name); repeating ones also have an `endDate` (the last day with a run) or `null`. Times are wall-clock times in the schedule's own time zone, so "9:00 AM" stays 9:00 AM across clock changes. A time that doesn't exist that day (clocks going forward) runs at the next valid time; a time that happens twice (clocks going back) runs once, the first time.

| Export                                      | Does                                                                                                                                                                    |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nextRun(schedule, after)`                  | The first planned run strictly after `after`, or `null` when none is left (a Once that has run, or past the end date)                                                   |
| `planNextRun(schedule, now, lastRanAt?)`    | The run to plan next, at least 15 minutes after the last run                                                                                                            |
| `runTiming(plannedFor, now)`                | `on-time` (under a minute), `late` (under an hour, with minutes) or `missed`                                                                                            |
| `describeRunTiming(timing)`                 | `'Ran 25 minutes late'`, `'Missed: the server was off'`, or `null` on time                                                                                              |
| `catchUp(schedule, plannedFor, now, keep?)` | After the server was off: the runs still `due` (less than an hour late), the `missed` ones to log (the latest `keep`, default 100) and the `next` run ahead             |
| `scheduleProblems(schedule, now)`           | Save errors naming their field: `'Pick at least one day.'`, `'That time has already passed.'`, `'That end date has already passed.'`…                                   |
| `describeSchedule(schedule, prefs)`         | `'Weekdays at 9:00 AM'`, `'Every Monday and Thursday at 2:30 PM until Dec 18, 2026'`; names the zone when it isn't the reader's: `'Every day at 9:00 AM (Lisbon time)'` |

## Coming next

Each part is its own pull request: storage (automations and their runs, one run per planned time), Admin-only routes, running through background jobs (`automations.run`), the Schedule, Form response and Row added triggers, the Send a message and Add a row actions, run history, then the screens.
