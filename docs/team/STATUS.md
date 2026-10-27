# Team tools: status

Lane: Team tools (Messages, Home and reminders, notifications, Calendar, Meetings, Automations, Analytics, Status page, Claude features built off). Reviewer and merger: the Team tools lead. Updated Oct 27, 2026, early morning (UTC).

Goal: Felipe's bar for Friday, Oct 30 is everything: Notion parity, but better. First a working basic version of every Team tools feature on main, then polish. The last PR opens by Oct 30; anything not ready by Oct 31 is dropped for now. All colours, fonts, sizes and spacing come from the design kit tokens, so Felipe can restyle Care Hub later.

## On main

| PR | What |
| --- | --- |
| #26 | `@carehub/team-time` part 1: wall-clock dates and times, time zones |
| #35 | Calendar sync types, iCalendar text and values, video meeting links |
| #22 | Live updates server: one stream per browser tab, topics with access re-checks |
| #32 | Web push sender: encryption, VAPID, payloads and settings (`node:crypto` only) |
| #37 | Notices: the `sendNotice` contract, checks, grouping and table |
| #38 | Status page logic and tables |
| #63 | `@carehub/team-time` part 2: dates and times in the specs' wording, second time zone labels |
| #65 | Calendar time zones: VTIMEZONE reading and writing, Windows zone names, attendee `self` and RDATE fields |

## Building now

| Part | Now | Next (basic slice first) |
| --- | --- | --- |
| W1-A | Reminders: Remind me on pages and events, delivery, Snooze and Done | Home's Reminders section data, web push for reminders |
| W1-B | `@carehub/team-repeat`: repeating events (3 PRs) | Calendar events on the server and the date-range API |
| W1-C | Web push in the browser: service worker and manifest | Push subscriptions, notification settings and delivery; then Claude features (built off) |
| W1-D | iCalendar reader, writer and safe link fetcher (parts 3 and 4) | Meetings: notes, recording notice, private transcription; then iCloud |
| W1-E | Google Calendar sign-in (read-only), client and mapping | Connect calendars: Google and links, sync engine |
| W1-F | Live updates in the browser; background jobs | Automations |
| W1-G | Calendar layout maths and editing | Calendar screens: day, week, month, side panel, drag, layers, Upcoming |
| W1-H | `@carehub/team-chat` parts 1 to 4 (#31 waits for the package OK) | Messages: DMs, groups, files, reactions, search, unread |
| W2-N | Notices store, routes and the 🔔 Care Hub chat | Home |
| W2-S | Status page store, checks, routes and screen | Analytics |

Every Team tools feature has a builder.

## Interfaces other lanes use

From decision 0007, section 4.4:

- Live updates (`apps/server/src/features/live`): the server is on main; the web hooks come next.
- Jobs (`apps/server/src/features/jobs`): next from W1-F.
- Notices (`apps/server/src/features/notices`): the `sendNotice` contract is on main, and `bindMemoryNotices()` works in unit tests. Stored notices and the 🔔 chat come next (target Oct 28).

Calendar layers from other lanes: `listDatedRows`, `listDateSources`, `setRowDate` (Databases) and `listLearningDueDates` (Learning).

## Settings

See [settings.md](settings.md).

## Decided

- Google and iCloud calendars are read-only in Care Hub (open decision CA-D3 in the Calendar spec; read-only is the default). Synced events can't be edited, moved, deleted or replied to; the server refuses with 403. Their panel links to Google Calendar or iCloud. New events are always Care Hub events.

## For Felipe

- When he creates the Google sign-in client: type "Web application", the redirect URL from settings.md, and publishing status "In production" (in "Testing", sign-ins end after 7 days).
- CA-D3, only if he wants it: two-way Google and iCloud calendars (editing and replying from Care Hub). That would need write access to Google.
