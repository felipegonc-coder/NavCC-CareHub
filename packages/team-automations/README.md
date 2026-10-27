# @carehub/team-automations

Automations for the Team tools lane: the parts both the server and the web app need. Spec:
Automations (v2). For now that's schedules: when a scheduled automation runs, how its schedule
reads in plain words, and what happens to runs the server was off for. The shapes of automations
and runs, with their checks, move here next.

Import by file, such as `@carehub/team-automations/schedule`. Everything is pure and built on
`@carehub/team-time`; the caller passes `now`.

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
