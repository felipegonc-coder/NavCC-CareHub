# Team tools: status

Lane: Team tools (Messages, Home and reminders, notifications, Calendar, Meetings, Automations, Analytics, Status page, Claude features built off). Reviewer and merger: the Team tools lead. Updated Oct 26, 2026, late evening (UTC).

Goal: every Team tools feature working by Friday, Oct 30. The last PR opens by Oct 30; anything not ready by Oct 31 is dropped for now.

## On main

Nothing yet.

## In progress

| Part | What | Next |
| --- | --- | --- |
| W1-A | `@carehub/team-time`: time zones, date and time formats, automation schedules, reminder times | Reminders |
| W1-B | `@carehub/team-repeat`: repeating events, exceptions, series edits, RRULE | Calendar events on the server |
| W1-C | Web push protocol (node:crypto only), sender, service worker, browser client | Push routes and notification settings |
| W1-D | iCalendar read and write, video links, private calendar links | CalDAV client for iCloud |
| W1-E | Google Calendar sign-in, client and mapping, with mocks | Google sync |
| W1-F | Live updates (SSE) and background jobs (Postgres queue) | |
| W1-G | Calendar layout maths (day, week, month, drag and keyboard) | Calendar screens |
| W1-H | `@carehub/team-chat`: message rules, mentions, cards, unread, reactions, files, search helpers | Messages |
| W2-N | Notices and the 🔔 Care Hub chat (needed by core's comments and mentions by Oct 28) | |
| W2-S | Status page | |

Not started: Analytics, Automations, Meetings (notes and private transcription), the Home screen, Claude features (built off).

## Interfaces other lanes use

From decision 0007, section 4.4: live updates (`features/live`), jobs (`features/jobs`) and notices (`features/notices`). Calendar layers from other lanes: `listDatedRows`, `listDateSources`, `setRowDate` (Databases) and `listLearningDueDates` (Learning).

## Settings

See [settings.md](settings.md).

## Waiting for Felipe

- Replies (Going, Maybe, Not going) to events synced from Google or iCloud: send them back to that calendar? Two-way sync already has write access. Until he decides, people reply only to Care Hub events.
