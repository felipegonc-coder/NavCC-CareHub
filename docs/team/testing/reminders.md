# Reminders: notes for browser tests

Home and reminders spec, section 2. Code: `apps/server/src/features/reminders/` and
`apps/web/src/features/reminders/`.

## Paths

- `/reminders`: the Reminders list (Home's Reminders section links to it with See all). Each
  person sees only their own reminders.
- Remind me has no path of its own: it's a dialog over the screen it was opened from.

## The Reminders list

- Heading 1 "Reminders", then two regions: **Pending** (soonest first, snoozed ones included) and
  **Sent in the last 30 days** (newest first).
- Each reminder is a list item with:
  - the page or event title as a link (to `/p/<pageId>` or the event in Calendar). Without access
    it's plain text: "A page you can't open" or "An event you can't open";
  - when: "Today at 3:30 PM", "Tomorrow at 9:00 AM", "Thu, Oct 29 at 9:00 AM" (with the year when
    it isn't this year's). Event reminders add "· 10 minutes before", "· At the start", "· 1 day
    before" or, on all-day events, "· On the day at 9:00 AM". Snoozed: "Snoozed until …". Sent:
    "Sent …", plus "· Done" once marked done;
  - the note, if any.
- Pending items have the buttons **Edit** and **Delete**, named "Edit reminder: \<title\>" and
  "Delete reminder: \<title\>". Delete asks first in the alert dialog **Delete this reminder?**
  (Cancel and Delete); once deleted, the toast says "Reminder deleted" and focus moves to Pending.
  Closing either dialog otherwise puts focus back on its button.
- Edit opens the dialog **Change reminder**: "Date" and "Time" (page reminders only; an event
  reminder's time goes with the event), then "Note" (up to 280 characters), Cancel and Save. A
  refused change shows the reason in the dialog; a saved one closes it with the toast "Reminder
  changed". Changing the time before an event comes later.
- Empty: "No reminders. Use Remind me on a page or event." and "No reminders sent in the last 30
  days."
- Times show in the person's time zone and 12- or 24-hour setting (default America/Denver,
  12-hour).

## Remind me

- Opened from the page "…" menu item **Remind me** (pages and rows), or Ctrl+K and typing "remind"
  (the command **Remind me**, for the page that's open). Calendar's event panel opens it for an
  event (one occurrence of a repeating one).
- The dialog **Remind me** shows the page or event title (Ctrl+K: "This page"; away from a page it
  says "Open a page first, or use Remind me in an event's panel."). Then the menu **Remind me**,
  with the first item focused (arrows, Home, End, Enter; Esc closes the dialog):
  - pages: "In 1 hour", "Later today at 5:00 PM" (until 4:00 PM), "Tomorrow at 9:00 AM", "Next
    Monday at 9:00 AM", "Custom date and time…";
  - timed events: "At the start", "5 minutes before", "10 minutes before", "30 minutes before", "1
    hour before", "1 day before", "Custom…";
  - all-day events: "On the day at 9:00 AM", "The day before at 9:00 AM", "Custom…".
  - Times that have already passed aren't offered.
- Custom: "Date" and "Time" (pages); "How long before" and "Unit" (minutes, hours or days; timed
  events); "Days before" (0 is the day itself) and "Time" (all-day events). Then Back and **Set
  reminder**. Wrong times say why in an alert, for example "That time has already passed.", "Enter a whole
  number.", "Pick a time up to 28 days before.", "Pick 0 to 28 days before."
- "Note" (up to 280 characters, with "n of 280 characters") is under the menu and the custom fields.
- Once set, the dialog closes with the toast "Reminder set" and when it's due ("Tomorrow at 9:00
  AM"). Focus goes back to what opened it (the "…" button for the page menu).

## data-testid values

None: every part has a role and a name.

## JSON routes for test data

Signed in; writes need the `X-CSRF-Token` header (see `../testing.md`).

| Route                         | Body                                                                             | Answer                                      |
| ----------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------- |
| `GET /api/reminders`          |                                                                                  | `{ pending: Reminder[], sent: Reminder[] }` |
| `POST /api/reminders` (page)  | `{ target: { type: 'page', pageId }, at: '<ISO instant>', note? }`               | 201 `{ reminder }`                          |
| `POST /api/reminders` (event) | `{ target: { type: 'event', eventId, occurrenceStart? }, minutesBefore, note? }` | 201 `{ reminder }`                          |
| `PATCH /api/reminders/:id`    | `{ at? or minutesBefore?, note? }`                                               | `{ reminder }`; 409 once it was sent        |
| `DELETE /api/reminders/:id`   |                                                                                  | 204                                         |

- `Reminder`: `id`, `target`, `title` (null without access), `href`, `minutesBefore` (null for
  pages), `dueAt`, `note` ('' when none), `status` (pending, snoozed, sent or done), `sentAt`,
  `createdAt`. Instants are ISO strings ending in `Z`.
- `minutesBefore`: 0 is at the start, up to 40320 (4 weeks). Negative numbers are a time on the
  day of an all-day event: -540 is 9:00 AM.
- `note`: up to 280 characters. Up to 500 pending reminders per person.
- Another person's reminder: 403 (HR-12).

## Seeded names

None yet: the seed comes once core's seed is on `main`.

## Timing

- A reminder arrives in the 🔔 Care Hub chat within 1 minute of its time (jobs are checked every
  5 seconds).
- The list updates live (`reminders-changed`) when a reminder is set, changed, sent, snoozed or
  deleted.
