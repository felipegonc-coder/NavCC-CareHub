# @carehub/team-repeat

Repeating events for Care Hub: repeat rules, expanding them into occurrences, series edits
(this event, this and following, all events), the iCalendar/Google RRULE subset, and the rule in
plain words.

Everything works on civil values from `@carehub/team-time`: `'YYYY-MM-DD'` for all-day events and
`'YYYY-MM-DDTHH:mm'` for timed ones, in the event's own time zone. Callers convert to and from
exact moments; this package has no time-zone code.

## Exports

| Export | What it's for |
| --- | --- |
| `RepeatRule`, `ByDay`, `WeekdayCode`, `Frequency` | Daily, weekly on chosen days, monthly on a day or the nth/last weekday, yearly; `interval`; ending never, on `until` (inclusive) or after `count` |
| `checkRule`, `isRepeatRule`, `MAX_INTERVAL` | Checks untrusted JSON; problems come back in plain words |
| `normalizeRule` | Spells out what a rule leaves to the series start (the weekday of a weekly rule, and so on) |
| `Series`, `Override`, `Occurrence`, `OccurrenceKey`, `checkSeries` | A schedule: `start`, `end` (exclusive), `rule`, `exceptions` and `overrides`, keyed by each occurrence's original start |
| `expand`, `ExpandWindow`, `Expansion`, `MAX_OCCURRENCES`, `MAX_STEPS` | Occurrences overlapping a window, after exceptions and overrides; at most 1,000 per call, with `truncated` when a cap stopped it |
| `occurrenceAt` | One occurrence by key, or `null` |
| `parseRRule`, `serializeRRule`, `isUnsupported`, `UnsupportedRule`, `ParseOptions`, `SerializeOptions` | RRULE: FREQ, INTERVAL, COUNT, UNTIL, BYDAY (with 2MO, -1FR), BYMONTHDAY, BYMONTH, WKST |
| `describeRepeat` | "Every 2 weeks on Mon and Wed", "Every month on the last Friday, 10 times" |
| `RepeatError`, `RepeatErrorCode`, `WEEKDAYS` | Errors: `invalid-input` (answer 400), `not-an-occurrence` (409, the screen is out of date), `needs-converter` (a missing UTC converter: a bug) |

## How it behaves

- As in iCalendar, the series start is always the first occurrence and counts toward `count`, and
  removed occurrences count too. `until` includes its whole day.
- With an interval, weekly rules pair weeks from `weekStart` (Monday if left out, as in
  iCalendar). Care Hub weeks start on Sunday unless a person changes it, so set `weekStart` when
  making a rule: `WEEKDAYS[prefs.weekStart]` turns team-time's number into a code.
- A rule outside the subset parses as `{ unsupported: true, raw }`: show the event read-only and
  write `raw` back unchanged. UNTIL in UTC needs `fromUtc` to read and `toUtc` to write.
- `describeRepeat` calls a rule outside the subset, or any invalid rule, "Custom repeat".
- Dates stay inside team-time's range, 0001-01-01 to 9999-12-31: expansion leaves out occurrences
  that would end after it, an edit that would leave it throws `invalid-input`, and a moved `until`
  stops at its edge.
