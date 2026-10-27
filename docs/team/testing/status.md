# Status page: notes for browser tests

- **Path:** `/status`. Anyone can open it, signed in or not. Site admins also see Parts, Backups, Incidents and Version.
- **Title:** "Care Hub · Status". One `<main>` with the h1 "Status".
- **Refresh:** the page asks for fresh data every 30 seconds.

## What's on the screen

| What             | How to find it                                                                                                                                                                                                                                                                                |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overall status   | The word "Working", "Some problems" or "Down", with an icon; screen readers hear "Overall status: Working"                                                                                                                                                                                    |
| 30-day uptime    | Text such as "99.90% uptime in the last 30 days" ("No uptime measured yet." on a new server)                                                                                                                                                                                                  |
| Day bars         | `getByRole('group', { name: 'Uptime by day' })`: 30 buttons, oldest first, named like "October 12: 99.2%" ("September 27: no data" before installation). One tab stop on today; arrow keys, Home and End move between days. The day under the pointer or focus is also written below the bars |
| Loading          | `getByRole('status', { name: 'Loading the status' })`, only if loading takes longer than 300 ms                                                                                                                                                                                               |
| Can't load       | `getByRole('alert')` "Can't reach the Care Hub server." and the Retry button                                                                                                                                                                                                                  |
| Site admin cards | h2 headings "Parts", "Backups", "Incidents" and "Version"                                                                                                                                                                                                                                     |
| Parts            | Web app and server, Database, File storage (with free disk space), Live editing, Background jobs (reminders and automations), Calendar sync; each "Working", "Problem", "Down" or "Not checked"                                                                                               |
| Backups          | "Last good backup", "Latest backup" (only when it failed), "Last restore test" and "Next backup", or "No backups yet. The first one runs tonight." / "Backups aren't set up on this server."                                                                                                  |
| Backup buttons   | "Back up now" and "Test a restore now". The answer shows in the line below them                                                                                                                                                                                                               |

No `data-testid` values: everything on the page has a role and a name.

## Test data

`node apps/server/dist/cli.js seed` adds 31 days of status history (safe to run twice):

- A heartbeat for every minute, except three gaps that are also listed as incidents, each starting at 14:20 UTC:
  - 8 days ago: 5 minutes, update
  - 15 days ago: 3 minutes, restart
  - 22 days ago: 35 minutes, unknown cause
- 43 missing minutes in the last 30 days, so the uptime shows **99.90%** (ST-10), the three incident days are amber or red, and the other days green. If the server starts more than a minute after the seed, the minutes in between count as a restart and the uptime can show a little less.
- The version is the server's `CAREHUB_VERSION`, with the seeded update as its last update. The build date shows "Not recorded" unless `CAREHUB_BUILD_DATE` is set.

Backups come from the backup service's files in `BACKUPS_DIR` (`/data/backups`), not from the seed. Without that folder, Backups shows "Backups aren't set up on this server." and the backup buttons answer with the same message.

## JSON routes

| Route                               | Who                             | What                                                                                                                                                        |
| ----------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/status?tz=America/Denver` | Anyone                          | `{ status, uptime: { percent, days: [{ date, percent }] } }` and nothing else. `tz` is optional (the person's own time zone, else the server's `TZ`)        |
| `GET /api/status/details`           | Site admins (others 401 or 403) | `{ parts, backups, incidents, version }`                                                                                                                    |
| `POST /api/status/backup`           | Site admins (others 401 or 403) | 202 `{ requested: true }`. 409 while a backup is already asked for or when backups aren't set up; 429 after 3 in an hour or 10 in a day, with `Retry-After` |

The POST needs the `X-CSRF-Token` header with the CSRF cookie's value, as everywhere in Care Hub (`lib/api.ts` sends it; the cookie's name depends on HTTPS, so don't hard-code it). "Test a restore now" uses the same route: every backup ends with a restore test.
