# Team tools: status

Lane: Team tools (Messages, Home and reminders, notifications, Calendar, Meetings, Automations, Analytics, Status page, Claude features built off). Reviewer and merger: the Team tools lead. Updated Oct 27, 2026, about 04:00 UTC.

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
| #66 | Team tools docs: settings, status, notes for browser tests |
| #31 | `@carehub/team-chat` part 1: message text, mentions, links and page cards |
| #76 | `@carehub/team-repeat` part 1: repeat rules, checks and RRULE reading and writing |
| #77 | iCalendar reader for calendar links and iCloud (read-only) |
| #30 | Google Calendar sign-in, read-only scopes |
| #101 | Reminders part 1: rules, the reminder notice, the job that sends it, Calendar's event reminder functions |
| #82 | Live updates in the browser: `useLiveEvent`, `useLiveTopic` |
| #83 | Background jobs: Postgres queue, runner, periodic tasks, `/api/jobs` |

## Building now

| Part | Now | Next (basic slice first) |
| --- | --- | --- |
| W1-A | Reminders part 2: storage, `/api/reminders`, Snooze and Done | Remind me in the web app and the Reminders list; push and Home's Reminders data |
| W1-B | `@carehub/team-repeat` parts 2 and 3, `@carehub/team-calendar-api` | Calendar events, items, layers and settings on the server |
| W1-C | Web push in the browser (#72, in review); push subscriptions, settings and delivery | Claude features (built off) |
| W1-D | iCalendar writer and safe link fetcher; `readCalendarLink` | Meetings: notes from an event, recording notice, private transcription (`onnxruntime-web`); then iCloud |
| W1-E | Google Calendar client and mapping (read-only) | Connect calendars: Google and calendar links, sync engine, connect screen |
| W1-F | Automations: schedules (#93), storage, routes, runner | Database triggers and more actions |
| W1-G | Calendar layout maths and editing | Calendar screens: day, week, month, side panel, drag, layers, Upcoming |
| W1-H | `@carehub/team-chat` parts 2 to 4, Messages server | Messages screens: chats, files, reactions, search |
| W2-N | Notices store, routes and the 🔔 Care Hub chat (waits on #67) | Home |
| W2-S | Status page store, checks, routes and screen (waits on #67) | Analytics |

Every Team tools feature has a builder.

## Interfaces other lanes use

From decision 0007, section 4.4:

- Live updates: the server (`apps/server/src/features/live`) and the web hooks (`apps/web/src/features/live`) are on main.
- Jobs (`apps/server/src/features/jobs`): on main. `scheduleJob(input, { db })` inside a caller's transaction comes next. The runner starts in the app once its `// feature: jobs` line is registered (after #67).
- Notices (`apps/server/src/features/notices`): the `sendNotice` contract is on main, and `bindMemoryNotices()` works in unit tests. Stored notices and the 🔔 chat come next (target Oct 28).

Calendar layers from other lanes: `listDatedRows`, `listDateSources`, `setRowDate` (Databases) and `listLearningDueDates` (Learning).

## Settings

See [settings.md](settings.md).

## Decided

- Google and iCloud calendars are read-only in Care Hub (open decision CA-D3 in the Calendar spec; read-only is the default). Synced events can't be edited, moved, deleted or replied to; the server refuses with 403. Their panel links to Google Calendar or iCloud. New events are always Care Hub events.

- In-browser transcription uses `onnxruntime-web` only, with our own Whisper code (security reviewer: `@huggingface/transformers` brings native and LGPL packages). Model files come from `MODELS_DIR`, with their SHA-256 sums in the repository.

## For Felipe

- When he creates the Google sign-in client: type "Web application", the redirect URL from settings.md, and publishing status "In production" (in "Testing", sign-ins end after 7 days).
- CA-D3, only if he wants it: two-way Google and iCloud calendars (editing and replying from Care Hub). That would need write access to Google.
- Later: put the speech model files in `MODELS_DIR` on the server (steps will be in settings.md).
