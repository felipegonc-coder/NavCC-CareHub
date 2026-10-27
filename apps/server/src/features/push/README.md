# Push (server)

Sends web push notifications, so people hear about messages and reminders when Care Hub isn't
open (Messages: "Unread and notifications"; Home and reminders: reminders). Built from RFC 8030,
8291, 8292 and 8188 with `node:crypto` only. It keeps each person's browsers and notification
settings, sends to all of a person's browsers, and sends on new notices and messages.

## Settings

Three lines in the server's settings file. Leave them empty and push stays off with a plain
message; the server still starts.

```sh
# Web push: notifications when Care Hub isn't open. Leave empty to switch them off.
PUSH_VAPID_PUBLIC_KEY=
PUSH_VAPID_PRIVATE_KEY=
PUSH_VAPID_SUBJECT=mailto:admin@example.org
```

Make a key pair with the one-line `node` command in `docs/team/settings.md` (it calls
`generateVapidKeys()`). Keep the private key secret: it never appears in responses, logs or error
messages. Changing keys means every browser subscribes again; the web client does this on its next
start.

## Using it

```ts
const push = resolvePushConfig(readSettings(pushSettingsSchema));
if (!push.enabled) log.info(push.message);

const summary = await pushToUser(
  { store: createPostgresPushStore(db), config: push, fetch, log },
  recipientId,
  { kind: 'message', from: senderName, text, url: `/messages/${chatId}`, tag: `chat:${chatId}` },
);
```

`pushToUser` builds the notification with the person's "Show message text" setting and sends it to
each of their browsers. It deletes subscriptions that expired or that the push service says are
gone, marks the others as used, and logs failures without the payload, endpoint or keys. It
answers `{ sent, removed, failed }`. While push is off it sends nothing.

Use one tag per chat, so a chat's newer notification replaces the older one, and
`{ urgency: 'high' }` for reminders. `sendPush` sends to one browser, for anything else.

## What a notification may say

Lock screens show it, so `buildPushPayload` follows the person's "Show message text in
notifications" setting (MS-07). Off: only who and what kind. On: also the message text, the
person's own note, and the page, row or event title.

| `kind`     | Title                          | Text with message text off                   | Text with it on               |
| ---------- | ------------------------------ | -------------------------------------------- | ----------------------------- |
| `message`  | "Avery Lin"                    | "New message"                                | The first 100 characters      |
| `mention`  | "Avery Lin mentioned you"      | (none)                                       | The title · the text          |
| `reminder` | "Reminder"                     | (none)                                       | The title · the person's note |
| `notice`   | Its sender, such as "Learning" | Its generic title, such as "Course assigned" | Also · the title · the text   |

A message with only files says "New message", never file names. Texts are one line of at most 100
characters, without control or text-direction characters. Clicking opens `url`, a Care Hub path
such as `/messages/<chatId>`.

## Routes

`routes.ts`, registered with
`await app.register(import('./features/push/routes'), { prefix: '/api/push' })`. Every route needs a
signed-in person, and none returns an endpoint or keys.

| Route                                    | What it does                                                                                      |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `GET /key`                               | `{ publicKey }`, or `null` while push is off.                                                     |
| `GET /subscriptions`                     | The person's browsers: `{ subscriptions: [{ id, device, createdAt, lastUsedAt }] }`.              |
| `POST /subscriptions`                    | Saves this browser: `PushSubscription.toJSON()`, plus `replaces`. 201, or 409 while push is off.  |
| `DELETE /subscriptions`                  | `{ endpoint }`: turns this browser off. 204.                                                      |
| `DELETE /subscriptions/:subscriptionId`  | Removes another of the person's browsers. 204, or 404.                                            |
| `POST /test`                             | Sends a test notification to the person's browsers: `{ sent, removed, failed }`. 429 within 10 s. |
| `GET /preferences`, `PATCH /preferences` | `{ preferences: { notifyAbout, showText, pause } }`: Settings → Notifications.                    |

A browser is saved only with an https endpoint on a push service in `PUSH_SERVICE_HOSTS` and usable
keys; `sendPush` checks the endpoint again before every send, follows no redirects and gives up
after 10 seconds. An endpoint is one browser, so it belongs to whoever saved it last: on a shared
computer, the previous person stops getting notifications there. Each person keeps the 20 browsers
used most recently.

`pause` is `{ until }` while notifications are paused, with `until` an ISO instant, or null for
"until turned back on". It's null when not paused, and once `until` has passed. Send
`{ pause: { until } }` to pause, for at most 7 days (400 otherwise), and `{ pause: null }` to turn
notifications back on. The web app works out "1 hour" and "tomorrow 8:00 AM" in the person's time
zone.

## Sending on new notices and messages

`delivery.ts`, which the routes plugin hooks to `app.events` while push is on:

- `notices.notice.created`: the notice's owner.
- `messages.message.created`: each recipient but the sender, 4 at a time.

A person gets a push only when all of these hold. They have no Care Hub tab open (`hasOpenTabs` from
live; the tab shows the notification itself). They have a browser with notifications on. They
haven't paused notifications. They can see the notice or message. team-chat's `notifyDecision` says
yes, after the "Notify me about" setting, mute and @mentions.

`sources.ts` reads from the other features through their `index.ts`: `getNotice` (notices),
`getMessageForPush` (Messages), `hasOpenTabs` (live) and `notifyDecision` (`@carehub/team-chat`).

| What                         | `kind`     | Opens                                    | Tag             | Urgency |
| ---------------------------- | ---------- | ---------------------------------------- | --------------- | ------- |
| A message                    | `message`  | `/messages/<chatId>?message=<messageId>` | `chat:<chatId>` | normal  |
| A message that mentions them | `mention`  | The same                                 | `chat:<chatId>` | normal  |
| A reminder notice            | `reminder` | The notice's link                        | `notice:<id>`   | high    |
| A mention notice             | `mention`  | The notice's link                        | `notice:<id>`   | normal  |
| An alert notice              | `notice`   | The notice's link                        | `notice:<id>`   | high    |
| Other notices                | `notice`   | The notice's link                        | `notice:<id>`   | normal  |

A mention in a group chat starts its text with the chat's name, such as "Night shift · …". A
notice's link that isn't a Care Hub path opens the 🔔 chat (`/messages/care-hub`) instead. A grouped
notice keeps its ID, so its newer push replaces the older one. When one person's push fails, it's
logged and the others still get theirs.

## Tables

`push_subscriptions` (one row per browser) and `push_preferences` (one row per person who changed a
setting; the defaults are all messages, with message text shown, and no pause). Both are in
`migrations/202610270400_push_tables.sql`, with the pause columns in
`migrations/202610271000_push_pause.sql`. `schema.ts` mirrors them, and both are deleted with the
person.
