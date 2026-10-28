# Notices on the web

Written from the spec. No code copied from AppFlowy or the old Care Hub.

The 🔔 Care Hub chat (Messages spec MS-09, MS-10) and the hooks Messages uses for its 🔔 Care Hub
row. Notices are sent and stored on the server: see `apps/server/src/features/notices/README.md`.

## What other features use

Import from `features/notices` (the index) only.

- `NoticesChat`: the chat, lazy loaded. Props `{ className? }` (`NoticesChatProps`). Render it
  inside `Suspense`.
- `useNoticesUnread()`: how many notices in the person's chat are unread; 0 until it loads.
- `useNoticesPreview()`: the newest notice as `{ title, sender, latestAt }` (`NoticesPreview`);
  `null` when there are none, `undefined` while loading or after an error.

Messages mounts `NoticesChat` at `/messages/care-hub`, in a flex column under its own page
title. The chat has no `<main>` or page heading; its headings start at `h3`. It fills the column
(`flex-1 min-h-0`) and scrolls inside itself.

Both hooks share one request (`GET /api/notices/summary`) and stay current: they refetch when the
server sends `notices-changed` and after the live connection comes back.

### Notice settings (Settings → Notifications, spec 3.3)

For the switches in Settings. Settings are per person and workspace, and every kind is on
until the person changes it.

- `NOTICE_SETTINGS`: `{ key, label, hint? }` for each switch, in order: Comments on pages I follow
  (`comments`), Edits on pages I follow (`edits`, hint "At most one summary per page per hour"),
  Form responses (`formResponses`) and Automation messages (`automations`).
- `ALWAYS_ON_NOTICES`: the labels shown as always on, without switches: Mentions and replies,
  Reminders and access requests.
- `useNoticeSettings()`: the person's `NoticeSettings` (`Record<NoticeSettingKey, boolean>`). It
  refetches on `notice-settings-changed`, so their other tabs follow, and after a reconnect.
- `useChangeNoticeSettings()`: `mutate({ comments: false })` sends only what changed. The switch
  moves at once and moves back, with `isError` set, when the server refuses.

A kind that's turned off stops reaching the 🔔 chat. Pausing notifications doesn't change these
settings.

## The chat

- Oldest at the top, newest at the bottom, under day dividers (Today, Yesterday, then the date)
  in the person's time zone. Grouped notices show how many they hold, such as "3 notices".
- Chips: All, Mentions and replies, Following, Reminders, Requests, Unread. **Mark all as read**
  next to them.
- It opens at the **New messages** line (above the oldest unread notice) or at the newest notice.
  50 notices per page; older ones load when the top comes into view, or with **Load older
  notices**.
- In All, notices count as read once the newest one has been on screen while the tab is in
  front. Opening a notice's link or card, or using one of its action buttons, reads that one.
- Cards (up to 3, in order) show the page or event as the reader may see it: a locked or deleted
  one shows only that ("🔒 A page you can't open", "This page was deleted").
- Action buttons run on the server. One with choices opens a menu. The confirmation (or the
  error) shows under the buttons.
- While scrolled up, **Jump to latest** goes to the newest notice. Notices that arrive while the
  chat is open are announced to screen readers ("New notice from Reminders: ...").
- Keyboard: Tab stops at one notice; ↑ and ↓ move between notices.
- Loading shows a skeleton after 300 ms; a failed load says so with **Retry**; an empty chip
  offers **Show all**.

## API it calls

All under `/api/notices` (server part 2b): `GET /` (`filter`, `before`, `limit`), `GET /summary`,
`POST /read` (`{ through }`), `POST /read-all`, `POST /:id/read` and `POST /:id/actions`
(`{ button, choice? }`), and `GET`/`PATCH /settings` (`{ settings }`; the `PATCH` body is the
change). The types in `api.ts` mirror the server's views in
`apps/server/src/features/notices/types.ts`.

## Not yet

- Times use the default time settings until the person's own settings reach the web app.
- Muting the 🔔 Care Hub row (`useNoticesMute()`) comes later.
- `/api/notices/settings` comes with the server's notices routes. Until then `useNoticeSettings()`
  returns an error.

## Tests

`chat.test.ts` (days, ordering, arrivals, cards, read state), `hooks.test.tsx` (one shared request,
live refresh, marking read) and `NoticesChatView.test.tsx` (chips, paging, reading, buttons,
keyboard, loading, errors, empty states) run against the fake server in `testServer.ts`.
`settings.test.tsx` checks the notice settings hooks (load, change, undo on error, other tabs)
against a small fake of `/api/notices/settings`.
