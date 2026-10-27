# Calendar connections: notes for browser tests

Connected calendars (Calendar spec, Connections): Google Calendar, read-only, and calendars added by their private link. Care Hub only reads these calendars and never changes anything in them.

## Screen

`/calendar/connections`, for any signed-in member, showing only their own connections. The screen has one `main` and the heading "Connected calendars".

| What | How to find it |
| --- | --- |
| Connect Google | button "Connect Google Calendar" |
| Add a link | button "Add a calendar link". This opens the dialog "Add a calendar link", with the fields "Name" and "Link", the radio group "Colour" and the button "Add calendar". |
| One connection | `listitem` named after the connection, such as "School" |
| Its status | text in the item: "Up to date. Last synced 5 minutes ago.", or the plain problem, such as "Google needs you to sign in again." |
| Its calendars (Google) | checkboxes in the group "Calendars to show", named after each calendar |
| Actions | buttons "Sync now" ("Retry" after a problem), "Reconnect" (Google), and "Remove". Remove asks first in the dialog "Remove <name>?". |

Google's sign-in comes back to this screen:

- `?connected=<id>` opens the dialog "Google Calendar is connected", where you pick the calendars to show and press "Done".
- `?problem=<code>` shows a plain sentence, for example `missing-scopes`: "Care Hub needs to see your calendars and their events. Please connect again and allow both." "Dismiss" hides it.

Each connected calendar that is shown is also a layer in the Calendar's left panel. Its id is `connected:<calendarId>`.

## Without outside services (CI)

- Without `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, "Connect Google Calendar" is off and shows "Google sign-in isn't set up yet." Calendar links still work.
- Without `CALENDAR_SECRET_KEY`, both ways are off and show "Calendar connections aren't set up yet."
- Each person can have up to 10 connections. At 10, both ways are off and say "You can connect up to 10 calendars. Remove one to add another."

## JSON routes

All are under `/api/calendar` and are for the signed-in person only. Writes need the `X-CSRF-Token` header. The shapes are in `@carehub/team-calendar-api` (`connections.ts`).

| Route | Body | Answer |
| --- | --- | --- |
| `GET /connections` | | `{ connections, unavailable: { google, links } }` |
| `POST /connections/links` | `{ url, label, color }` | 201 `{ connection }`, after Care Hub has read the link once |
| `PATCH /connections/:id` | `{ label?, calendars?: [{ id, shown }] }` | `{ connection }` |
| `POST /connections/:id/sync` | | `{ connection }`, after reading it again |
| `DELETE /connections/:id` | | 204. The calendars, their events in Care Hub and the sign-in or link are gone. |
| `POST /connections/google` | `{ connectionId? }` | `{ url }`: Google's sign-in screen |

## Serving a calendar link locally

Tests can serve an `.ics` file from a local server and add it as a calendar link. Set `CAREHUB_TEST_CALENDAR_ORIGINS` to the server's origin, then add the link with the API or the dialog, for example `http://127.0.0.1:4599/school.ics`.

- `CAREHUB_TEST_CALENDAR_ORIGINS` is a comma-separated list of exact loopback origins with a port, such as `http://127.0.0.1:4599` or `http://[::1]:4600`. Hostnames, paths and other private ranges aren't allowed, and a bad entry stops the server at startup.
- It works only when `NODE_ENV` is `test` or `development`. Otherwise it's ignored with a warning in the log, and the fetcher ignores it too.
- A listed origin skips only the private-address check and may use `http`. Redirects are checked again on their own origin. The 15-second timeout and the 10 MB limit still apply.

The rules live in `apps/server/src/features/calendar/sync/ical/fetch-link.ts` (`testCalendarOrigins` and `allowLocalOrigins`). Care Hub reads a link again every 15 minutes. "Sync now" reads it straight away.
