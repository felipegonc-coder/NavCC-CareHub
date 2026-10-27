# Reminders (server)

Remind me on pages and events, delivered in the person's 🔔 Care Hub chat (Home and reminders
spec).
This first part has the rules, the notice, the job that sends reminders and Calendar's event
reminders. The Postgres store, the routes, Snooze and Done come next.

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

## For Calendar (`index.ts`)

Each takes `Db | Tx` first, so Calendar can call it inside its own transaction.

- `createEventReminder(tx, { workspaceId, userId, eventId, occurrenceStart?, start, minutesBefore, timeZone, use24h })`
  adds one person's reminder (for example the default reminder for new events) and returns
  `{ reminderId }`, or null when that time has passed or the person has 500 pending.
- `syncEventReminders(tx, { eventId, occurrenceStart?, start })` after the event or one occurrence
  moves: its pending reminders move with it and it returns how many moved. One now in the past
  is sent within a minute, marked Late.
- `deleteEventReminders(tx, { eventId, occurrenceStart? })` when the event (without
  `occurrenceStart`: every occurrence) or one occurrence is deleted. Returns how many.
- `EventStart` is `{ start: Date }` or `{ allDay: 'YYYY-MM-DD' }`. `minutesBefore` counts back from
  the start; all-day events count from 00:00 on the wall clock (-540 is 9:00 AM on the day, 900 is
  9:00 AM the day before). `occurrenceStart` names one occurrence as on notice cards and must
  match exactly.
- Open goes to `/calendar?event=<eventId>&occurrence=<occurrenceStart>`.

## Tests

`bindMemoryReminders()` from `testing.ts` binds reminders to memory (also for Calendar's tests):
it returns the store, the scheduled `jobs`, the `notices` sent, and `runDueJobs(now?)`. Pass
`memoryDb` as the `db`.

## Stand-ins

- `scheduleJob(input, { db })` and `registerJobHandler` until features/jobs lands.

## Next

- Postgres store and migration, the routes under `/api/reminders` (Remind me on pages, the list,
  changes, delete), Snooze and Done, and the registration line. For Calendar:
  `registerEventLookup` (Remind me in the event panel), `remapEventReminders` (series edits) and
  `userIds` on `deleteEventReminders` (people removed from a meeting).
- The web: Remind me in the page "…" menu, the event panel and Ctrl+K; the Reminders list for
  Home's `/reminders`; browser tests.
- Push for reminders, the Home section's data, date reminders (HR-16), and the Calendar default
  reminder on every occurrence of a repeating event (`registerNextOccurrenceLookup`).
