# Push (server)

Sends web push notifications, so people hear about messages and reminders when Care Hub isn't
open (Messages: "Unread and notifications"; Home and reminders: reminders). Built from RFC 8030,
8291, 8292 and 8188 with `node:crypto` only. Routes, tables and the settings screen come in a
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

Make a key pair with `generateVapidKeys()` (suggested CLI command: `push-keys`). Keep the private
key secret: it never appears in responses, logs or error messages. Changing keys means every
browser subscribes again; the web client does this on its next start.

## Using it

```ts
const push = resolvePushConfig(readSettings(pushSettingsSchema));
if (!push.enabled) log.info(push.message);

const payload = buildPushPayload(
  {
    kind: 'message',
    title: senderName,
    body: text,
    url: `/messages/${chatId}`,
    tag: `chat:${chatId}`,
  },
  { showText: person.showMessageText },
);
const outcome = await sendPush({ fetch, vapid: push.vapid }, subscription, payload, {
  topic: topicFor(`chat:${chatId}`),
});
```

- `delivered`: update the subscription's "last used".
- `gone`: delete the subscription.
- `retry`: try again later (after `retryAfterSeconds` when given).
- `rejected`: drop this message and log `reason` and `detail`. Never log the payload.

Use one tag per chat, so a chat's newer notification replaces the older one, and
`urgency: 'high'` for reminders.

## What a notification may say

Lock screens show it, so `buildPushPayload` keeps it minimal:

- Title: the sender's name, or a generic word for notices ("Reminder"). Never a page or row
  title, and never page content.
- Text: the first 100 characters when "Show message text in notifications" is on; otherwise
  "New message", "Reminder" or "New notification".
- Clicking opens `url`, a Care Hub path such as `/messages/<chatId>`.

Endpoints must belong to a known push service (`PUSH_SERVICE_HOSTS`), so a crafted subscription
can't make the server call other addresses.
