# Push (server)

Sends web push notifications, so people hear about messages and reminders when Care Hub isn't
open (Messages: "Unread and notifications"; Home and reminders: reminders). Built from RFC 8030,
8291, 8292 and 8188 with `node:crypto` only. It keeps each person's browsers and notification
settings and sends to all of a person's browsers; sending on new messages and notices comes in a
later part.

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
| `GET /preferences`, `PATCH /preferences` | `{ preferences: { notifyAbout, showText } }`: Settings → Notifications.                           |

A browser is saved only with an https endpoint on a push service in `PUSH_SERVICE_HOSTS` and usable
keys; `sendPush` checks the endpoint again before every send, follows no redirects and gives up
after 10 seconds. An endpoint is one browser, so it belongs to whoever saved it last: on a shared
computer, the previous person stops getting notifications there. Each person keeps the 20 browsers
used most recently.

## Tables

`push_subscriptions` (one row per browser) and `push_preferences` (one row per person who changed a
setting; the defaults are all messages, with message text shown). Both are in
`migrations/202610270400_push_tables.sql`, mirrored by `schema.ts`, and deleted with the person.
