# Team tools: notes for browser tests

For the Testing lane and our own builders. Each feature adds its own file, `docs/team/testing/<feature>.md`, in the pull request that brings its first screen: paths, `data-testid` values, the JSON routes that create test data, and the seeded names.

## Who writes what

- **Testing lane** (`tests/e2e/flows/<area>/`): acceptance flows from the specs and the cross-area flows, including FLOW-01 (page → share → comment mention → notice) and FLOW-02 (database → form → automation → calendar).
- **Team tools** (`tests/e2e/team/`): our entries in `team/screens.ts` (names start with `team-`), one smoke flow per feature that lands with its first screen, and the flows that need our own stand-ins for outside services (below).

## Screens (planned)

| Feature | Path | Who can open it | First screen PR (target) |
| --- | --- | --- | --- |
| Status page | `/status` | Anyone, without signing in. Details for site admins | Oct 28 |
| 🔔 Care Hub chat (notices) | Inside Messages | Each person, their own | Oct 28 |
| Messages | `/messages` | Signed-in members | Oct 29 |
| Home and reminders | `/` | Signed-in members | Oct 29 |
| Calendar | `/calendar` | Signed-in members | Oct 29 |
| Meetings | `/meetings` | Signed-in members | Oct 29 |
| Automations | `/automations` | Admins | Oct 29 |
| Analytics | `/analytics` | Admins | Oct 29 |

Polish lands on Oct 30. Exact paths below these (one chat, one event, one meeting) go in each feature's file. Claude features are built switched off: no Claude buttons show unless an admin turns them on, which needs `ANTHROPIC_API_KEY`.

## Selectors

- Prefer roles and labels with the words on screen (`getByRole`, `getByLabel`). Our screens use `@carehub/ui` components, which label every control.
- Where there's no accessible name (calendar slots, event blocks, message rows), we add `data-testid` with the feature as prefix: `messages-`, `notices-`, `home-`, `reminders-`, `calendar-`, `meetings-`, `automations-`, `analytics-`, `status-`.

## Test data

- **Seed:** `node apps/server/dist/cli.js seed` adds fictional Team tools data for the seeded accounts: chats and messages, notices in the 🔔 chat, a Care Hub calendar with events, and status history. Each feature's file lists the names.
- **API:** each feature's file lists the JSON routes that create a message, an event or a meeting note. Writes need the `X-CSRF-Token` header from the `carehub_csrf` cookie, as everywhere in Care Hub.
- **Notices have no create route, on purpose.** Only features create them, on the server. In tests, make one through a real trigger, such as a comment mention, a reminder or an automation, or use the seeded ones.

## Timing

- Live updates (messages, the 🔔 chat, the calendar) arrive within 2 seconds.
- Background jobs are checked every 5 seconds. Automations run within 10 seconds of their trigger; reminders arrive within 1 minute of their time.

## Outside services

CI has no internet, so Google, iCloud, outside calendar links, push services and Claude are never called for real.

- **Calendar connections:** in CI, Google shows "Google sign-in isn't set up yet." The calendar's file will say how a test can serve a local calendar link.
- **Web push:** our own tests stand in for the push services.
- **Transcription:** without `MODELS_DIR`, Meetings shows "Transcription isn't set up yet." We cover transcription in our own tests.

## Bugs

Open a GitHub issue labelled `bug` and `team`, with the failing test. The Team tools lead routes it to the right builder.
