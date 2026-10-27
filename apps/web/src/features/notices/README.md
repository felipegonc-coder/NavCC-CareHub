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

Messages (W1-H) mounts `NoticesChat` at `/messages/care-hub`, in a flex column under its own page
title. The chat has no `<main>` or page heading; its headings start at `h3`. It fills the column
(`flex-1 min-h-0`) and scrolls inside itself.

Both hooks share one request (`GET /api/notices/summary`) and stay current: they refetch when the
server sends `notices-changed` and after the live connection comes back.

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
- Cards show the page or event as the reader may see it: a locked or deleted one shows only that
  ("🔒 A page you can't open", "This page was deleted").
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
(`{ button, choice? }`). The types in `api.ts` mirror the server's views in
`apps/server/src/features/notices/types.ts`.

## Not yet

- Times use the default time settings until the person's own settings reach the web app.
- Muting the 🔔 Care Hub row (`useNoticesMute()`) comes later.

## Tests

`chat.test.ts` (days, ordering, arrivals, cards, read state), `hooks.test.tsx` (one shared request,
live refresh, marking read) and `NoticesChatView.test.tsx` (chips, paging, reading, buttons,
keyboard, loading, errors, empty states) run against the fake server in `testServer.ts`.
