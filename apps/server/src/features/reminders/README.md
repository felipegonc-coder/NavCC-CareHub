# Reminders (server)

Remind me on pages and events, delivered in the person's 🔔 Care Hub chat (Home and reminders
spec).
The server side: the rules, the notice and its Snooze and Done buttons, the job that sends
reminders, the Postgres store, the routes (registered in `app.ts`) and Calendar's event
reminders. The web comes next.

## Routes (`/api/reminders`)

Only the signed-in person's own reminders: someone else's is 403, a deleted one 404 (HR-12).

- `GET /`: `{ pending, sent }`. Pending (and snoozed) soonest first; sent or done in the last 30
  days, newest first. Each is a `ReminderView` (`id`, `target`, `title`, `href`, `minutesBefore`,
  `dueAt`, `note`, `status`, `sentAt`, `createdAt`), with times as ISO text. `title` is null when
  the person can't open the page or event; `href` is where Open goes.
- `POST /`: `{ target: { type: 'page', pageId }, at, note? }` or
  `{ target: { type: 'event', eventId, occurrenceStart? }, minutesBefore, note? }`. 201
  `{ reminder }`. 400 "That time has already passed.", 403 for a page the person can't open or an
  event Calendar doesn't find for them, 413 "You can have up to 500 pending reminders. Delete some
  first." Notes are trimmed, up to 280 characters.
- `PATCH /:id`: `{ at?, note? }` for a page, `{ minutesBefore?, note? }` for an event. Only while
  pending or snoozed (409 "This reminder was already sent. Set a new one instead."). It takes the
  person's time zone and 24-hour setting now.
- `DELETE /:id`: 204. The list drops it and it's never sent.
- Every change publishes `reminders-changed` to the owner, so open lists reload.

The table is `reminders_reminders` (`migrations/202610270420_reminders_reminders.sql`). Inserts
take a lock per person inside the transaction, so two at once can't pass 500.

## How a reminder is sent

- Each pending reminder has one `reminders.fire` job at its due time, with the key
  `reminders.fire:<reminderId>:<dueAtMs>`. Moving a reminder schedules a new job; the old one
  finds the due time changed and sends nothing.
- The job sends the notice, then marks the reminder sent. It never skips a late reminder: after a
  restart it still sends, with "Late: was due at 9:00 AM" (more than a minute late, HR-11).
- The notice: icon ⏰, sender "Reminders", title "Reminder", the note as text, the page or event
  as the card (the chat looks the title up for the reader, so a page they can no longer open shows
  locked), and the buttons Open, Snooze (15 minutes, 1 hour, tomorrow at 9:00 AM) and Done. The
  group key `reminders:<id>` folds a repeat from a retried job into the same notice.
- Times in the notice use the owner's time zone and 24-hour setting, saved on the reminder.

## Snooze and Done

The notice's buttons run `reminders.snooze` (value `<id>:15m`, `<id>:1h` or `<id>:tomorrow`) and
`reminders.done` (value `<id>`), registered with `registerNoticeAction`.

- Snooze brings it back in 15 minutes, in 1 hour, or tomorrow at 9:00 AM in the owner's zone; the
  list shows it pending (snoozed) until then. It answers "Snoozed for 1 hour" or "Snoozed until
  tomorrow at 9:00 AM" (HR-09).
- Done marks it done in the list, and a snoozed one doesn't come back: "Marked as done."
- Someone else's reminder, a deleted one or an unknown choice: "This reminder was deleted."

## Titles

`registerTitleLookup('page' | 'event', (tx, userId, ids) => Map<id, title>)` at start-up. It
returns the titles of the pages (or events) the person can open and leaves out the rest, which are
listed with `title: null`. Pages and Calendar each register one; until then titles are null.

## For Calendar (`index.ts`)

Each takes `Db | Tx` first, so Calendar can call it inside its own transaction.

- `createEventReminder(tx, { workspaceId, userId, eventId, occurrenceStart?, start, minutesBefore, timeZone, use24h })`
  adds one person's reminder (for example the default reminder for new events) and returns
  `{ reminderId }`, or null when that time has passed or the person has 500 pending.
- `syncEventReminders(tx, { eventId, occurrenceStart?, start })` after the event or one occurrence
  moves: its pending reminders move with it and it returns how many moved. One now in the past
  is sent within a minute, marked Late.
- `deleteEventReminders(tx, { eventId, occurrenceStart?, userIds? })` when the event (without
  `occurrenceStart`: every occurrence) or one occurrence is deleted; with `userIds`, only those
  people's reminders (removed from a meeting, for example). Returns how many.
- `remapEventReminders(tx, { eventId, map })` after a series edit ("This and following" or "All
  events"). `map(occurrenceStart)` is called once for each occurrence with pending reminders
  (null: reminders on the whole event). It returns where that occurrence went, as
  `{ eventId, occurrenceStart?, start }`, or null when it's gone (its reminders are deleted).
  Pending reminders move with their minutes before; snoozed ones keep their time. Returns how many
  changed.
- `EventStart` is `{ start: Date }` or `{ allDay: 'YYYY-MM-DD' }`. `minutesBefore` counts back from
  the start; all-day events count from 00:00 on the wall clock (-540 is 9:00 AM on the day, 900 is
  9:00 AM the day before). `occurrenceStart` names one occurrence as on notice cards and must
  match exactly.
- Open goes to `/calendar?event=<eventId>&occurrence=<occurrenceStart>`.
- `registerEventLookup((tx, userId, { eventId, occurrenceStart? }) => EventStart | null)` at
  start-up, for Remind me in the event panel: `POST /api/reminders` goes by the start it returns.
  Null (no such event, or the person can't open it) or no lookup is 403. A negative
  `minutesBefore` (after the start) only works for all-day events.

## Tests

`bindMemoryReminders()` from `testing.ts` binds reminders to memory (also for Calendar's tests):
it returns the store, the scheduled `jobs`, the `notices` sent, and `runDueJobs(now?)`. Pass
`memoryDb` as the `db`. `routes.test.ts` runs the routes and the store on Postgres.

## Stand-ins

- Workspace: everyone is in `STAND_IN_WORKSPACE_ID` until accounts add `request.member`. Then the
  routes use `app.requireMember` (no member is 403), and a new migration deletes the stand-in rows
  and adds the `workspace_id` foreign key.
- Page access: the `canOpenPage` route option, which lets everyone open every page until pages land
  with `getPageAccess`.
- Jobs run, and survive a restart (HR-11), once the jobs routes are registered in `app.ts`.
  Notices need the notices routes registered the same way.

## Next

- The web: `RemindersScreen` (Home's `/reminders`) and `usePendingReminders(limit)` for Home's
  Reminders section; Remind me in the page "…" menu, the event panel and Ctrl+K; browser tests.
- Push for reminders, the Home section's data, date reminders (HR-16), and the Calendar default
  reminder on every occurrence of a repeating event (`registerNextOccurrenceLookup`).
