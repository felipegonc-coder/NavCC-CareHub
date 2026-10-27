# Notifications: notes for browser tests

Settings → Notifications, at `/settings/notifications` once the Settings screen is on `main` (the section comes through the `settingsSections` slot). Everyone signed in has it.

## On the screen

- **Messages:** the select "Notify me about" (All messages; Only direct messages, @mentions and notices; Nothing) and the switch "Show message text in notifications". A saved change shows "Saved" next to it for 2 seconds; a failed one goes back and says `Couldn't save "<field>". Try again.`
- **This browser:** "Turn on" or "Turn off", or a sentence saying why it can't be turned on here (for example on an iPhone outside the Home Screen). Without the `PUSH_VAPID_*` settings, as in CI, it says "Notifications when Care Hub isn't open aren't set up yet. Ask an Admin." and offers no button.
- **Browsers that get notifications:** one row per browser (`data-testid="notifications-device"`) with its name, "Added … · Last used …" and "Remove" (named "Remove <browser>"), then "Send a test notification" (only when push is set up). Results show as toasts.
- Each group is a region named by its heading: "Messages", "This browser", "Browsers that get notifications".

## JSON routes

All need a signed-in person; changes need the `X-CSRF-Token` header.

| Route | What it does |
| --- | --- |
| `GET /api/push/preferences`, `PATCH /api/push/preferences` | `{ preferences: { notifyAbout: 'all' \| 'mentions' \| 'nothing', showText } }`; PATCH takes either or both |
| `GET /api/push/subscriptions` | `{ subscriptions: [{ id, device, createdAt, lastUsedAt }] }` |
| `DELETE /api/push/subscriptions/:id` | 204, or 404 if it isn't yours or is gone |
| `POST /api/push/test` | `{ sent, removed, failed }`; 409 while push isn't set up, 429 within 10 seconds of the last one |
| `GET /api/push/key` | `{ publicKey }`, `null` while push isn't set up |

## Push in CI

CI has no internet, so no browser can subscribe to a real push service. Browser tests can check the settings, the "isn't set up yet" sentence and the routes above; our own unit tests stand in for the push services.
