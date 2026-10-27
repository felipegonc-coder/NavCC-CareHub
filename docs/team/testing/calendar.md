# Calendar: notes for browser tests

For the Testing lane and our own builders (see `docs/team/testing.md`). From the Calendar spec v2. Fictional data only.

## Paths

- `/calendar`, for signed-in members. Week by default; Day on phones (narrower than 768 px).
- The address keeps the view and the date: `?view=day`, `?view=week` or `?view=month`, and `?date=YYYY-MM-DD` (today when left out), such as `/calendar?view=month&date=2026-11-18`. Without a view, `?date=` opens the week with that day.
- The page title is "Care Hub · Calendar".

## Controls

- Top bar: Today, "Previous week" and "Next week" ("day" or "month" in those views), and the period, such as "Oct 25 – 31, 2026" or "November 2026".
- The view switch is a group named "View" with the buttons Day, Week and Month. The current one has `aria-pressed="true"`. On phones it sits above the grid.
- Each day's number is a button named with its date, such as "Tuesday, October 27", which opens Day view. Today's has `aria-current="date"`.
- Single keys, unless you're typing in a field: T (today), D, W and M (views), J or → (next), K or ← (previous).

## Items

Each item is a button named with its title, date and time, and layer:

- "QA calibration, Tuesday, October 27, 10:00 to 11:00 AM, Meetings"
- "Fictional audit day, Wednesday, November 18, All day, My events"
- "Fictional offsite, Monday, October 26 to Wednesday, October 28, All day, My events"

An empty title reads "(No title)", and an event you declined ends with ", Not going". Times are in the person's time zone, which the server sends with the items.

## Test IDs

| `data-testid`                  | What                                                                                                                                                            |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `calendar-event-<id>`          | An item; `<id>` is its `id` in `GET /api/calendar/items`. It can repeat: a multi-day item shows once in each week of Month, and a night event once on each day. |
| `calendar-slot-<date>T<HH>:00` | An hour in Day and Week, such as `calendar-slot-2026-11-18T10:00`.                                                                                              |
| `calendar-day-<date>`          | A day in Month.                                                                                                                                                 |
| `calendar-now`                 | The now line in Day and Week, when today is shown.                                                                                                              |

## Test data

`POST /api/calendar/events` with JSON and the `X-CSRF-Token` header from the `carehub_csrf` cookie (`apiFor(page)` sends both). It answers 201 `{ event }`.

- Timed, with UTC instants (10:00 to 11:00 AM in America/Denver): `{ "title": "Fictional care plan review", "allDay": false, "start": "2026-11-18T17:00:00.000Z", "end": "2026-11-18T18:00:00.000Z" }`
- All-day, with dates; `end` is the day after the last day: `{ "title": "Fictional audit day", "allDay": true, "start": "2026-11-18", "end": "2026-11-19" }`
- Optional fields: `timeZone`, `location`, `description`, `videoUrl` and `people` (member IDs; any makes it a meeting).

The seeded events come with the server's seed data; their names go here when it lands.

## Timing

Changes made elsewhere (another tab, the API) show within 2 seconds while Calendar is open.

## Smoke flow

`tests/e2e/team/calendar.e2e.ts`: an event and an all-day event made through the API show in Week, Day and Month, and not in the next month. It waits for the `calendar` flag in `tests/e2e/flows/_support/features.ts`.
