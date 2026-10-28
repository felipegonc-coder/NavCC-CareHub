# Team tools settings

All Team tools settings are optional. Each feature reads its own with `readSettings(schema)` from `apps/server/src/core/settings.ts` (decision 0007, section 2.3). Empty counts as unset. A missing value switches only that feature off, with a plain message on the screens that need it; it never stops the server.

The Claude settings moved to the Extras lane: see [docs/extras/settings.md](../extras/settings.md).

Secrets live only in the server's settings file. They never go in the repository, API responses, the Status page or logs; screens show only "set" or "not set".

| Setting | Feature | What it's for | When it's missing |
| --- | --- | --- | --- |
| `GOOGLE_CLIENT_ID` | calendar | Google sign-in client for Google Calendar sync (read-only) | "Google sign-in isn't set up yet." The other calendar connections still work. |
| `GOOGLE_CLIENT_SECRET` | calendar | The secret of that client | Same as above |
| `PUSH_VAPID_PUBLIC_KEY` | push | Web push key pair (P-256, base64url), so notifications reach people when Care Hub isn't open, including phones | Notifications appear only while Care Hub is open |
| `PUSH_VAPID_PRIVATE_KEY` | push | The private half of that key pair | Same as above |
| `PUSH_VAPID_SUBJECT` | push | A contact for the push services: a `mailto:` address or an `https://` URL | Same as above |
| `CALENDAR_SECRET_KEY` | calendar | Encrypts stored calendar tokens, iCloud app-specific passwords and private calendar links (32 random bytes, base64) | Connecting calendars is off: "Calendar connections aren't set up yet." |
| `MODELS_DIR` | meetings | Folder with the speech model files Care Hub serves for private, in-browser transcription | Transcription is off: "Transcription isn't set up yet." |
| `TZ` | status | The server's time zone: the nightly backup time, and the uptime days for people who aren't signed in | `America/Denver` |
| `BACKUP_AT` | status | When the nightly backup runs (HH:MM in `TZ`), shown as "Next backup" | `02:00` |
| `BACKUPS_DIR` | status | The backup service's folder: its results in `runs/`, and `requests/now` to ask for a backup | `/data/backups`. Without that folder: "Backups aren't set up on this server." |
| `FILES_DIR` | status | The files folder: the Status page checks it can write there, and shows the free disk space | File storage shows "Not checked" |
| `CAREHUB_VERSION` | status | The version number under Version | `0.0.0-dev` |
| `CAREHUB_BUILD_DATE` | status | The build date under Version: a date or an ISO time, such as `2026-10-27T08:00:00Z`. A core setting (decision 0007, section 2.3) that the image build sets (#3) | "Not recorded" |

## Making the values

- `CALENDAR_SECRET_KEY`: `openssl rand -base64 32`. Keep a copy with the backups: without it, stored calendar connections can't be read and people have to connect again.
- Web push key pair (run once, anywhere with Node 24, for example inside the Care Hub container):

  ```sh
  node -e "const {generateKeyPairSync}=require('node:crypto');const j=generateKeyPairSync('ec',{namedCurve:'prime256v1'}).privateKey.export({format:'jwk'});const pub=Buffer.concat([Buffer.from([4]),Buffer.from(j.x,'base64url'),Buffer.from(j.y,'base64url')]).toString('base64url');console.log('PUSH_VAPID_PUBLIC_KEY='+pub+'\nPUSH_VAPID_PRIVATE_KEY='+j.d)"
  ```

  Changing the key pair later means everyone has to allow notifications again.
- Google: an OAuth client of type "Web application" with the redirect URL `<CAREHUB_PUBLIC_URL>/api/calendar/google/callback`. Care Hub only reads calendars and events, so it asks for read-only access and never changes anything in Google. Set the client's publishing status to "In production": in "Testing", sign-ins end after 7 days. Step-by-step setup: `docs/team/google-sign-in-setup.md` (comes with the Google pull requests).

## Lines for `deploy/.env.example`

The Status page needs no new lines. In the deploy files (#3), `TZ` and `BACKUP_AT` are in `deploy/.env.example`, the image sets `FILES_DIR`, `CAREHUB_VERSION` and `CAREHUB_BUILD_DATE`, and `deploy/docker-compose.yml` mounts the backups at `/data/backups`.

```sh
# --- Team tools (all optional; a missing value switches only that feature off) ---
# Google Calendar (read-only): an OAuth client of type "Web application",
# redirect URL <CAREHUB_PUBLIC_URL>/api/calendar/google/callback
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
# Web push (notifications when Care Hub isn't open). Make the pair with the
# command in docs/team/settings.md.
PUSH_VAPID_PUBLIC_KEY=
PUSH_VAPID_PRIVATE_KEY=
PUSH_VAPID_SUBJECT=mailto:admin@example.com
# Encrypts stored calendar connections: openssl rand -base64 32
CALENDAR_SECRET_KEY=
# Folder with the speech model files for private transcription
MODELS_DIR=
```
