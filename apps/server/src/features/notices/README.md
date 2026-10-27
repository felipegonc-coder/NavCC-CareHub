# Notices

Each person has one 🔔 Care Hub chat per workspace (Messages spec MS-09). Features put notices in
it with `sendNotice`; only that person can read them or click their buttons, admins included.

```ts
import { sendNotice } from '../notices';

// After your own transaction has committed:
await sendNotice({
  workspaceId,
  userId: assigneeId,
  kind: 'mention',
  sender: 'Sam Ortiz',
  actorUserId: samId,
  title: 'Mentioned you in a comment',
  text: 'Can you check the follow-up dates?',
  card: { type: 'page', pageId },
  buttons: [{ label: 'Open', href: `/p/${pageId}` }],
  groupKey: `comments:${pageId}`,
});
```

It returns `{ noticeId, grouped }`, with `duplicate: true` when the idempotency key was already
used (see Retries), or `dropped: true` and an empty `noticeId` when the person isn't in the
workspace, as a member or a guest. Bad input throws a `NoticeInputError` that lists every
problem: that's a bug in the caller, so let it fail loudly.

## Fields

| Field            | Rules                                                                   |
| ---------------- | ----------------------------------------------------------------------- |
| `workspaceId`    | Required ID.                                                            |
| `userId`         | Required ID: whose chat it lands in.                                    |
| `kind`           | Required: one of the kinds below.                                       |
| `sender`         | Required, up to 100 characters: a feature, an automation or a person.   |
| `actorUserId`    | Optional ID: the person behind a mention or comment.                    |
| `icon`           | Optional emoji, up to 32 characters. Without one the kind's icon shows. |
| `title`          | Required, up to 200 characters. Generic: never a page or event title.   |
| `text`           | Optional, up to 4000 characters.                                        |
| `card`           | Optional `{ type: 'page', pageId }` or `{ type: 'event', eventId, … }`. |
| `buttons`        | Optional, at most 3. Links or actions (below).                          |
| `groupKey`       | Optional, up to 200 characters. See Grouping.                           |
| `idempotencyKey` | Optional, up to 200 characters. See Retries.                            |

Unknown fields are rejected. Blank optional text counts as absent.

## Kinds and filters

The kind sets the default icon and which filter chip shows the notice. All shows every notice and
Unread every unread one.

| Chip      | Kinds                                                            |
| --------- | ---------------------------------------------------------------- |
| Mentions  | `mention`, `reply`, `suggestion_accepted`, `suggestion_rejected` |
| Following | `comment`, `suggestion`, `edit_summary`                          |
| Reminders | `reminder`                                                       |
| Requests  | `access_request`                                                 |
| All only  | `alert`, `automation`, `shared`, `import`, `export`              |

Titles stay generic, such as "Mentioned you in a comment" or "Your export is ready".

## Cards and titles

Only IDs are stored. Every time the chat loads, the reader's access is checked again and the
title, icon and space are looked up for them. A reader who can't open the page or event sees
"🔒 A page you can't open" with no title; a deleted one shows "This page was deleted". That's why
`title` and `text` must never repeat a page or event title: put the page on the card instead.

An event card can point at one occurrence of a repeating event with `occurrenceStart`
(`YYYY-MM-DD`, `YYYY-MM-DDTHH:mm` or an ISO instant).

Page cards stay locked until core's page cards (`getPageCards`) are on main. Event cards come
from the Calendar feature, which registers a resolver at start-up:

```ts
import { eventCardKey, registerNoticeCardResolver, type EventCardResult } from '../notices';

registerNoticeCardResolver('event', async (db, userId, cards) => {
  const found = new Map<string, EventCardResult>();
  // For each card the reader can see:
  // found.set(eventCardKey(card), { title, when: 'Tue, Oct 28 · 3:00 PM', href });
  // or { locked: true } when they can't see it, { deleted: true } when it's gone.
  return found;
});
```

It's called once for each page of the chat, with each card once. Cards it leaves out are
locked, and so is every event card on the page when it throws (the error is logged). An `href`
that isn't a Care Hub path, or a blank title, keeps the card locked too.

## Buttons

- Link: `{ label, href }`. `href` must be a Care Hub path such as `/p/<pageId>`: no other sites.
- Action: `{ label, action, value? }` runs the handler registered for `action` on the server. With
  `choices` (1 to 5 `{ label, value }`) it opens a menu, such as Snooze → 15 min, 1 hour,
  Tomorrow 9 AM, and the handler gets the picked choice's value.

```ts
import { registerNoticeAction } from '../notices';

// At start-up. Handlers must be idempotent: people double-click.
registerNoticeAction('reminders.snooze', async ({ userId, workspaceId, value }) => {
  // ...
  return { message: 'Snoozed for 1 hour' };
});
```

Labels are up to 40 characters. Action names are `<feature>.<name>`. The browser only sends
which button (and choice) was clicked: the action and value always come from the stored notice.

## Grouping

With a `groupKey`, a notice for the same person and key in the same workspace within 5 minutes of
the last one updates that notice in place instead of adding another: it takes the new content,
becomes unread again, moves to the end of the chat and its count goes up by one. The 5 minutes
count from the last arrival, so a steady stream keeps grouping. `grouped` is true when that
happened.

## Retries

Give an `idempotencyKey` when the same send may run twice, such as a job that retries:
`reminders:<reminderId>:<dueAt>`. When this person already got a notice with that key in this
workspace, nothing changes and the result is `{ noticeId, grouped: false, duplicate: true }`
with the first notice's ID. A key lasts as long as its notice. Saves for one chat run one at a
time, so concurrent retries add one notice.

## After a notice is sent

- `app.events` gets `notices.notice.created` with `{ workspaceId, userId, noticeId, kind, grouped }`
  (grouped notices included).
- The person's open tabs get the live event `notices-changed` and refetch the chat and the unread
  count on the Messages badge.

Neither runs if the send fails, is a duplicate or is dropped, and a failure in either never fails
the send.

## API

Everything is under `/api/notices`, for the signed-in person's own chat in the current workspace
(members and guests). There's no route that adds a notice.

| Route               | Does                                                        |
| ------------------- | ----------------------------------------------------------- |
| `GET /`             | The chat, newest first: `{ notices, nextCursor, unread }`.  |
| `GET /unread`       | `{ unread }`.                                               |
| `POST /read`        | `{ through }`: marks every notice up to that position read. |
| `POST /read-all`    | Marks the whole chat read.                                  |
| `POST /:id/read`    | Marks one notice read.                                      |
| `POST /:id/actions` | `{ button, choice? }` (indexes): runs an action button.     |

`GET /` takes `filter` (`all`, `mentions`, `following`, `reminders`, `requests` or `unread`),
`limit` (1 to 100, default 50) and `before` (the previous page's `nextCursor`). The read routes
return `{ unread }` and nudge the person's other tabs. `/actions` marks the notice read too and
returns `{ message, unread }`. Someone else's notice is 403, admins included.

## Tests

- Unit tests of other features: `bindMemoryNotices()` from `notices/testing` makes `sendNotice`
  save to memory; call `unbind()` when the test ends.
- With the app (`createTestApp`), `sendNotice` uses Postgres.

## Coming next

- Part 3: the 🔔 Care Hub chat (`NoticesChat`) and `useNoticesUnread()` for Messages, which
  shows them at `/messages/care-hub` and on its badge.
- Open page cards once core's `getPageCards` is on main.
