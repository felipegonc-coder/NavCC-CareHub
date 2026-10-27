# Team tools: status

Lane: Team tools (Messages, Home and reminders, notifications, Calendar, Meetings, Automations, Analytics, Status page). The Claude features moved to the Extras lane on Oct 27. Reviewer and merger: the Team tools lead. Updated Oct 27, 2026, about 10:00 UTC.

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

## In review

| PR | What | Waits on |
| --- | --- | --- |
| #288 | Registers live and jobs in `app.ts` | Main lead (core file) |
| #154 | Notices: store, `sendNotice` wiring, `getNotice`, seed data | Main lead's OK on its `app.ts` and `seed.ts` lines |
| #156 | Push: `pushToUser`, test notification | Main lead's OK on its `app.ts` line |
| #207 | Home settings on the server | Main lead's OK on its `app.ts` line |
| #209 | Reminders part 2b: Snooze and Done, titles, series edits for Calendar | Main lead's OK on its `app.ts` line |
| #230 | Push: PNG notification icons, headline-only notifications | One change (no CSRF cookie read in the service worker) |
| #203 | iCalendar writer and safe link fetcher | The #213 parser fix, Tailscale ranges, address and redirect checks, size and time caps |
| #180, #215 | Home frame and Upcoming; Customize Home and the sidebar Upcoming | Core edits to the web routes (main lead reviews those) |

## Building now

| Part | Now | Next (basic slice first) |
| --- | --- | --- |
| W1-A | Reminders part 2b (#209) | Reminders screen and `usePendingReminders` (Oct 28), then the Remind me picker |
| W1-B | Calendar server: events, items, layers, settings (a stack of PRs) | Calendar notices; layers from Databases and Learning |
| W1-C | Push to every browser (#156), icons (#230), Pause notifications | Push for new messages and notices |
| W1-D | iCalendar writer and safe link fetcher (#203), the #213 fix | Meetings: notes from an event, recording notice, private transcription; then iCloud |
| W1-E | Connected calendars: storage, sync engine, Google routes | Connect calendars screen; private links end to end |
| W1-F | Automations part 3 (routes), then the scheduler and Send a message | Settings → Automations screens; a jobs test hook for browser tests |
| W1-G | Calendar editing, `useUpcoming` | Calendar screens: day, week, month, side panel, drag, layers |
| W1-H | `@carehub/team-chat` part 3, Messages server | Messages screens: chats, files, reactions, search |
| W2-N | Notices store (#154), Home (#207, #180, #215) | Home sections: Reminders, Unread messages, Learning |
| W2-S | Analytics screen, Status page server and screen | Analytics part 2 |

Every Team tools feature has a builder.

## Interfaces other lanes use

From decision 0007, section 4.4:

- Live updates: the server (`apps/server/src/features/live`) and the web hooks (`apps/web/src/features/live`) are on main, with `hasOpenTabs(userId)`. The routes are registered in `app.ts` by #288.
- Jobs (`apps/server/src/features/jobs`): on main, with `scheduleJob(input, { db })` and the web `useJob`. The runner starts in the app once #288 merges.
- Notices (`apps/server/src/features/notices`): the `sendNotice` contract is on main, and `bindMemoryNotices()` works in unit tests. Stored notices and `getNotice` come with #154 (Oct 27). The 🔔 Care Hub chat screen is on main (#166).
- Push (`apps/server/src/features/push`): browsers and settings are on main; `pushToUser` comes with #156.

Calendar layers from other lanes: `listDatedRows`, `listDateSources`, `setRowDate` (Databases, expected Oct 28) and `listLearningDueDates` (Learning, on main).

## Settings

See [settings.md](settings.md).

## Decided

- Google and iCloud calendars are read-only in Care Hub (open decision CA-D3 in the Calendar spec; read-only is the default). Synced events can't be edited, moved, deleted or replied to; the server refuses with 403. Their panel links to Google Calendar or iCloud. New events are always Care Hub events.

- In-browser transcription uses `onnxruntime-web` only, with our own Whisper code (security reviewer: `@huggingface/transformers` brings native and LGPL packages). Model files come from `MODELS_DIR`, with their SHA-256 sums in the repository.

- Calendar links with a user name or password in them are refused, with a message saying why.

- The Claude features, including the meeting summary, are built by the Extras lane. Meetings keeps the Summarize button and the Summary, Decisions and Action items, and calls the Extras lane's `summarizeMeeting`.

## For Felipe

- When he creates the Google sign-in client: type "Web application", the redirect URL from settings.md, and publishing status "In production" (in "Testing", sign-ins end after 7 days).
- CA-D3, only if he wants it: two-way Google and iCloud calendars (editing and replying from Care Hub). That would need write access to Google.
- Later: put the speech model files in `MODELS_DIR` on the server (steps will be in settings.md).
