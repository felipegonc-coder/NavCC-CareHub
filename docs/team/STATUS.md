# Team tools: status

Lane: Team tools (Messages, Home and reminders, notifications, Calendar, Meetings, Automations, Analytics, Status page). The Claude features moved to the Extras lane on Oct 27. Reviewer and merger: the Team tools lead. Updated Oct 27, 2026, about 16:00 UTC.

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
| #154 | Notices: store, `sendNotice` wiring, `getNotice`, seed data |
| #156 | Push: `pushToUser`, test notification |
| #207 | Home settings on the server |
| #209 | Reminders part 2b: Snooze and Done, titles, series edits for Calendar |
| #354 | `@carehub/team-chat` part 3: notifications, previews, pictures and files, `/api/messages` shapes |

## Merged without CI

GitHub Actions minutes ran out on Oct 27 (until Nov 1). Under decision 0006 and the main lead's rules, these were reviewed line by line and merged by hand. CI reruns on `main` when minutes are back, and owners fix any break within the hour.

| PR | Head commit merged | Notes |
| --- | --- | --- |
| #354 | `6efde357a2bcd9b93d1959e09435b1e01700eb59` | Lane package only; never ran in CI. The builder ran tsc, Prettier and the 122 package tests locally. |
| #154 | `b8aeba72d38f9feef5bedecd83486c387c9dde2a` | CI passed on this head before the minutes ran out. Own `app.ts` and `seed.ts` lines (main lead's OK). |
| #156 | `f84354b14138ad2c153d108d5043107f780377b2` | CI passed on this head. Own `app.ts` line (main lead's OK). |
| #207 | `0f5ac9e363511d48ecec38ef8efde1fa2ffbf688` | CI passed on this head. Own `app.ts` line (main lead's OK). |
| #209 | `05ce438faf749158a6edf66d13d7036486b9ceb9` | CI passed on this head. Own `app.ts` line (main lead's OK). |

## In review

| PR | What | Waits on |
| --- | --- | --- |
| #288 | Registers live and jobs in `app.ts` | Main lead (he reviews and merges it) |
| #230 | Push: PNG notification icons, headline-only notifications | Main lead (`apps/web/public/sw.js` is a core file), with the security reviewer's OK |
| #299 | PNG app icons | Main lead (core files) |
| #365 | iCalendar reader limits (fixes #213) | Main lead (`apps/server/build.mjs`), with the security reviewer's OK |
| #203 | iCalendar writer and safe link fetcher | #365, then one more push (credentials refused, Tailscale ranges, address checks, size caps) |
| #180, #215 | Home frame and Upcoming; Customize Home and the sidebar Upcoming | Main lead reviews the core parts and deletes `HomePage.tsx`; the Team tools lead reviews the Home parts |
| #355 | Automations part 3: Admin-only `/api/automations` routes | Its route tests need Fastify, which no agent computer has, so they first run in CI |
| #361 | Jobs: test hook to run a periodic task at a chosen time | Same: its route tests first run in CI |
| #350 | Status part 2: checks, monitor and `/api/status` | Hand review |
| #357 | Connected calendars: tables and storage | Too big to merge without CI; being split into PRs of about 400 lines |

## Building now

| Part | Now | Next (basic slice first) |
| --- | --- | --- |
| W1-A | Reminders screen (#376) and `usePendingReminders` | The Remind me picker |
| W1-B | Calendar server: events, items, layers, settings (a stack of PRs); `getProfiles` in `features/auth` (main lead reviews) | Calendar notices; layers from Databases and Learning |
| W1-C | Pause notifications, push for new messages and notices | Turn push off on sign-out (the `beforeSignOut` phase) |
| W1-D | Reader limits (#365), then the writer and safe link fetcher (#203) | Reading links end to end; Meetings: notes from an event, recording notice, private transcription |
| W1-E | Connected calendars: storage (#357, being split), sync storage and engine (#358, #372, #378) | Google routes; Connect calendars screen |
| W1-F | Automations part 3 (#355), the jobs test hook (#361) | Part 4: the scheduler and Try it now; then Send a message and Settings → Automations |
| W1-G | Calendar editing, `useUpcoming` | Calendar screens: day, week, month, side panel, drag, layers |
| W1-H | `@carehub/team-chat` part 4: reactions and search; Messages server | Messages screens: chats, files, reactions, search |
| W2-N | Notice cards (#329, #334), notice settings (#341, #337), Home (#180, #215) | Home sections: Reminders, Unread messages, Learning |
| W2-S | Status page server (#350) and screen (#351), Analytics screen (#353) | Analytics part 2 |

Every Team tools feature has a builder.

## Interfaces other lanes use

From decision 0007, section 4.4:

- Live updates: the server (`apps/server/src/features/live`) and the web hooks (`apps/web/src/features/live`) are on main, with `hasOpenTabs(userId)`. The routes are registered in `app.ts` by #288.
- Jobs (`apps/server/src/features/jobs`): on main, with `scheduleJob(input, { db })` and the web `useJob`. The runner starts in the app once #288 merges.
- Notices (`apps/server/src/features/notices`): `sendNotice`, stored notices and `getNotice` are on main (#154), and `bindMemoryNotices()` works in unit tests. The 🔔 Care Hub chat screen is on main (#166).
- Push (`apps/server/src/features/push`): browsers, settings and `pushToUser` are on main (#156).

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
