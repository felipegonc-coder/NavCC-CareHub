# Team tools settings

All Team tools settings are optional. Each feature reads its own with `readSettings(schema)` from `apps/server/src/core/settings.ts` (decision 0007, section 2.3). Empty counts as unset. A missing value switches only that feature off, with a plain message on the screens that need it; it never stops the server.

Secrets live only in the server's settings file. They never go in the repository, API responses, the Status page or logs; screens show only "set" or "not set".

| Setting | Feature | What it's for | When it's missing |
| --- | --- | --- | --- |
| `GOOGLE_CLIENT_ID` | calendar | Google sign-in client for two-way Google Calendar sync | "Google sign-in isn't set up yet." The other calendar connections still work. |
| `GOOGLE_CLIENT_SECRET` | calendar | The secret of that client | Same as above |
| `PUSH_VAPID_PUBLIC_KEY` | push | Web push key pair (P-256, base64url), so notifications reach people when Care Hub isn't open, including phones | Notifications appear only while Care Hub is open |
| `PUSH_VAPID_PRIVATE_KEY` | push | The private half of that key pair | Same as above |
| `PUSH_VAPID_SUBJECT` | push | A contact for the push services: a `mailto:` address or an `https://` URL | Same as above |
| `CALENDAR_SECRET_KEY` | calendar | Encrypts stored calendar tokens, iCloud app-specific passwords and private calendar links (32 random bytes, base64) | Connecting calendars is off: "Calendar connections aren't set up yet." |
| `ANTHROPIC_API_KEY` | claude | Claude features | Claude stays off and can't be turned on |
| `MODELS_DIR` | meetings | Folder with the speech model files Care Hub serves for private, in-browser transcription | Transcription is off: "Transcription isn't set up yet." |

## Making the values

- `CALENDAR_SECRET_KEY`: `openssl rand -base64 32`. Keep a copy with the backups: without it, stored calendar connections can't be read and people have to connect again.
- Web push key pair (run once, anywhere with Node 24, for example inside the Care Hub container):

  ```sh
  node -e "const {generateKeyPairSync}=require('node:crypto');const j=generateKeyPairSync('ec',{namedCurve:'prime256v1'}).privateKey.export({format:'jwk'});const pub=Buffer.concat([Buffer.from([4]),Buffer.from(j.x,'base64url'),Buffer.from(j.y,'base64url')]).toString('base64url');console.log('PUSH_VAPID_PUBLIC_KEY='+pub+'\nPUSH_VAPID_PRIVATE_KEY='+j.d)"
  ```

  Changing the key pair later means everyone has to allow notifications again.
- Google: an OAuth client of type "Web application" with the redirect URL `<CAREHUB_PUBLIC_URL>/api/calendar/google/callback`. Two-way sync needs read and write access to events. Step-by-step setup comes with the Google connection screens.

## Lines for `deploy/.env.example`

```sh
# --- Team tools (all optional; a missing value switches only that feature off) ---
# Google Calendar two-way sync: an OAuth client of type "Web application",
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
# Claude features (they stay off until an admin turns them on)
ANTHROPIC_API_KEY=
# Folder with the speech model files for private transcription
MODELS_DIR=
```
