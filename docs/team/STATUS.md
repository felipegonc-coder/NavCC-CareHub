# Team tools: status

Lane: Team tools (Messages, Home and reminders, notifications, Calendar, Meetings, Automations, Analytics, Status page).

First a working basic version of every Team tools feature on main, then polish. All colours, fonts, sizes and spacing come from the design kit tokens, so Care Hub can be restyled later.

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
| #93 | `@carehub/team-automations`: schedules |
| #138 | Jobs: `scheduleJob(input, { db })` inside the caller's transaction |
| #140 | Jobs in the browser: `useJob` |
| #72 | Web push in the browser: service worker, subscribe and unsubscribe |
| #132 | Push: each person's browsers, notification settings and `/api/push` |
| #137 | Analytics part 1 |
| #143 | Reminders part 2a: storage and `/api/reminders` |
| #146 | Automations part 2a: automation shapes and checks |
| #148 | `@carehub/team-chat` part 2: chats, system lines, unread counts |
| #117 | Google Calendar client and mapping (read-only), Google sign-in setup notes |
| #167 | `@carehub/team-repeat` part 2: expanding series, `describeRepeat` |
| #168 | `@carehub/team-calendar-api`: Calendar request and response shapes |
| #182 | Live updates: `hasOpenTabs(userId)` |
| #185 | Automations part 2b: storage |
| #188 | Calendar grid layout maths: Day, Week, Month |
| #166 | The 🔔 Care Hub chat in Messages, unread and preview hooks |
| #210 | Settings → Notifications |
| #154 | Notices: store, `sendNotice` wiring, `getNotice`, seed data |
| #156 | Push: `pushToUser`, test notification |
| #207 | Home settings on the server |
| #209 | Reminders part 2b: Snooze and Done, titles, series edits for Calendar |
| #354 | `@carehub/team-chat` part 3: notifications, previews, pictures and files, `/api/messages` shapes |
| #288 | Live updates and jobs registered in `app.ts` |
| #180 | Home at `/`: the frame and Upcoming |
| #361 | Jobs: test hook to run a periodic task once at a chosen time |
| #346 | Calendar editing maths: slots, drag, resize, keyboard |
| #381 | `@carehub/team-calendar-api` part 2: Calendar settings and Upcoming shapes |
| #382 | `@carehub/team-repeat` part 3: This event, This and following, All events |
| #422 | Calendar screen part 1: data hooks, the address (view and date) and shortcuts |

## Interfaces other lanes use

From decision 0007, section 4.4:

- Live updates: the server (`apps/server/src/features/live`) and the web hooks (`apps/web/src/features/live`) are on main, with `hasOpenTabs(userId)`. The routes are registered in `app.ts` (#288).
- Jobs (`apps/server/src/features/jobs`): on main, with `scheduleJob(input, { db })` and the web `useJob`. The runner starts with the app (#288). Browser tests can run a periodic task once with `POST /api/jobs/test/periodic/:name` (#361): only when `CAREHUB_TEST_HOOKS=1`, site admins only. An allow-list of tasks is coming.
- Calendar shapes (`@carehub/team-calendar-api`): items, layers and events, plus settings and Upcoming (#381): `upcomingResponseSchema`, `isJoinable`, `eventHref`.
- Notices (`apps/server/src/features/notices`): `sendNotice`, stored notices and `getNotice` are on main (#154), and `bindMemoryNotices()` works in unit tests. The 🔔 Care Hub chat screen is on main (#166).
- Push (`apps/server/src/features/push`): browsers, settings and `pushToUser` are on main (#156).

Calendar layers from other lanes: `listDatedRows`, `listDateSources`, `setRowDate` (Databases) and `listLearningDueDates` (Learning, on main).

## Settings

See [settings.md](settings.md).

## Decided

- Google and iCloud calendars are read-only in Care Hub (open decision CA-D3 in the Calendar spec; read-only is the default). Synced events can't be edited, moved, deleted or replied to; the server refuses with 403. Their panel links to Google Calendar or iCloud. New events are always Care Hub events.

- In-browser transcription uses `onnxruntime-web` only, with our own Whisper code (`@huggingface/transformers` brings native and LGPL packages). Model files come from `MODELS_DIR`, with their SHA-256 sums in the repository.

- Calendar links with a user name or password in them are refused, with a message saying why.

- Test hooks: one switch in core, on only when `CAREHUB_TEST_HOOKS` is exactly `1`, and only with a loopback address. Hook routes exist only when it's on, under `/api/<lane>/test/…`, and deploy never sets it. Each hook is a normal protected route with a strict body and a log line. The jobs hook runs only listed tasks that delete nothing and send nothing outside the server, under the scheduler's lock. Its `now` decides only what's due; stored times use the real clock. Reminder and notice tasks can be listed only if hook runs skip push: the flag travels with the run, push is skipped where it's queued (those notices are marked not for push), and a test shows a hook run makes zero push sends.

- The meeting summary comes from the Extras features' `summarizeMeeting`. Meetings keeps the Summarize button and the Summary, Decisions and Action items.

## Setup notes

- The Google sign-in client: type "Web application", the redirect URL from settings.md, and publishing status "In production" (in "Testing", sign-ins end after 7 days).
- Two-way Google and iCloud calendars (CA-D3) are optional. They would need write access to Google.
- The speech model files go in `MODELS_DIR` on the server (steps will be in settings.md).
