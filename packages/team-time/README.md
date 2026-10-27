# @carehub/team-time

Time building blocks for the Team tools lane: wall-clock dates and times and time zones, with spec date and time formats, automation schedules and reminder times to follow. Pure TypeScript, `Intl` only: no runtime dependencies and no time zone libraries.

## Conventions

- Wall-clock (civil) values are strings: `CivilDate` `'YYYY-MM-DD'`, `CivilTime` `'HH:mm'` and `CivilDateTime` `'YYYY-MM-DDTHH:mm'` (no seconds, no zone, years 0001 to 9999). They compare correctly with `<` and `>`.
- Instants are `Date` objects (ISO strings ending in `Z` in JSON). Time zones are IANA names.
- A person's settings are always inputs (`TimePrefs`: `timeZone`, `use24h`, `weekStart`, named as on `request.user`). Nothing reads the machine's zone, locale or clock, except `todayIn`'s default `now`.
- Bad input (an impossible date, an unknown zone, a fractional count) throws a `RangeError`.

## Exports

### Civil dates and times

| Export                                                   | Does                                                                                           |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `CivilDate`, `CivilTime`, `CivilDateTime`                | String types, as above                                                                         |
| `Weekday`                                                | `0` (Sunday) to `6` (Saturday)                                                                 |
| `WeekStart`                                              | `0` (Sunday), `1` (Monday) or `6` (Saturday)                                                   |
| `isCivilDate(v)`, `isCivilTime(v)`, `isCivilDateTime(v)` | Type guards; impossible dates such as `2026-02-29` fail                                        |
| `datePart(dt)`, `timePart(dt)`                           | `'2026-10-26T15:30'` → `'2026-10-26'`, `'15:30'`                                               |
| `combine(date, time)`                                    | `('2026-10-26', '15:30')` → `'2026-10-26T15:30'`                                               |
| `addDays(date, n)`                                       | Calendar days                                                                                  |
| `addMonths(date, n)`                                     | Clamps to the month's end: Jan 31 + 1 → Feb 28 (29 in leap years)                              |
| `addMinutes(dt, n)`                                      | Wall clock: no clock changes                                                                   |
| `dayOfWeek(date)`                                        | `Weekday`                                                                                      |
| `daysInMonth(year, month)`                               | Month 1 to 12                                                                                  |
| `daysBetween(a, b)`, `minutesBetween(a, b)`              | `b` minus `a`, on the wall clock                                                               |
| `startOfWeek(date, weekStartsOn)`                        | First day of the week holding `date`                                                           |
| `weekNumber(date, weekStartsOn)`                         | Monday starts: ISO 8601 weeks. Sunday or Saturday starts: the week holding January 1 is week 1 |

### Time zones

| Export                              | Does                                                                                                                                               |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isValidTimeZone(v)`                | IANA names `Intl` knows (`'America/Denver'`, `'UTC'`); offsets like `'+01:00'` are refused                                                         |
| `toInstant(dt, timeZone)`           | Wall clock → `Date`. A time in a gap (clocks going forward) moves forward to the first valid time; a time that happens twice takes the earlier one |
| `toCivil(instant, timeZone)`        | `Date` → wall clock (seconds dropped)                                                                                                              |
| `timeZoneOffset(instant, timeZone)` | Minutes from UTC: `-360` for Denver in summer, `330` for Kolkata                                                                                   |
| `todayIn(timeZone, now?)`           | Today's `CivilDate` in that zone                                                                                                                   |

### Settings

| Export               | Does                                                          |
| -------------------- | ------------------------------------------------------------- |
| `TimePrefs`          | `{ timeZone, use24h, weekStart }`                             |
| `DEFAULT_TIME_PREFS` | `{ timeZone: 'America/Denver', use24h: false, weekStart: 0 }` |

## Tests

`npm test -w @carehub/team-time` (Vitest). Clock changes are covered both ways in America/New_York, Europe/London and Australia/Sydney, plus Asia/Kolkata, a midnight gap and a 30-minute change.
