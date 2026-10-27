# Live co-editing (web)

Opens pages for live co-editing with the collab server (`/api/collab`). Each open page has a
`Y.Doc`, kept on this device (IndexedDB) so typing goes on offline, and synced through the tab's
one socket. Also shows who else has the page open.

```tsx
import {
  CollabEditor,
  ConnectionNote,
  PresenceStack,
  useCollabPage,
  type CollabMe,
} from '../features/collab';

function PageBody({ pageId, me }: { pageId: string; me: CollabMe }) {
  const page = useCollabPage(pageId, me);
  return (
    <>
      <header className="flex items-center gap-3">
        <ConnectionNote page={page} />
        <PresenceStack people={page?.people ?? []} />
      </header>
      <CollabEditor page={page} />
    </>
  );
}
```

## Exports

| Export                      | What it does                                                                      |
| --------------------------- | --------------------------------------------------------------------------------- |
| `useCollabPage(pageId, me)` | Opens the page while mounted: its state (below), or null until it's open.         |
| `CollabEditor`              | `BlockEditor` for the page, with loading, no access and error states and notices. |
| `ConnectionNote`            | "Reconnecting…" for the top bar, after 3 s offline.                               |
| `PresenceStack`             | The other people here: 5 pictures ringed in their caret color, then "+2".         |
| `hasUnsentChanges()`        | True while a page has changes the server hasn't confirmed.                        |
| `sendWaitingChanges(id)`    | Run after sign-in: sends changes kept on this device from earlier visits.         |
| `forgetLocalCopies(id)`     | Run on sign-out: closes the person's pages and deletes their copies here.         |

`CollabEditor` takes the `BlockEditor` props except `ydoc`, `provider`, `user` and `editable`.

## Page state

| Field          | Meaning                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------- |
| `status`       | `loading`, `ready`, `no-access` or `failed` (`retry()` opens it again).                     |
| `editable`     | Loaded, you may edit, and this tab can still send changes.                                  |
| `live`         | Connected and signed in to the page: changes go out right away.                             |
| `reconnecting` | Not live for 3 s or more. Typing goes on.                                                   |
| `unsent`       | You made changes the server hasn't confirmed yet.                                           |
| `notice`       | `now-view-only`, `too-long`, `outdated` or `signed-out`, until `dismissNotice()`.           |
| `access`       | `{ level, readOnly, reason }` from the server; `reason` is `access`, `trashed` or `locked`. |
| `people`       | The other people with the page open, once each.                                             |
| `user`         | You, for your caret: first name and presence color.                                         |
| `generation`   | Goes up when the page is loaded from the server again (new `doc` and `provider`).           |

## How it works

- One socket per tab, open while a page is open and closed 30 s after the last one. It sends the
  build ID; the server refuses pages to a tab from another build, and the page asks you to reload.
- A page first loads its copy on this device (3 s at most), then syncs: only what the server
  lacks goes out. Closing the tab with unsent changes asks first. A page you leave with unsent
  changes stays open in the background until they're sent (10 min at most); changes still left
  go out the next time it opens, or after sign-in with `sendWaitingChanges`.
- The copy on this device is deleted when the page closes with everything sent and no other tab
  has it open, when you lose access, and when the page is loaded from the server again.
- When the server closes a page: `forbidden` shows no access; `too-long` loads the page again
  (dropping what the server refused) with a notice; `signed-out` stops sending; `too-fast` makes
  the socket wait 10 s, 30 s, then a minute. Other closes rejoin, 3 times a minute at most.
- Read-only pages (view access, locked, in Trash) show the editor read-only. Changes the server
  refused meanwhile go out once you may edit again.

Server-side changes to a page (imports, restores, templates) must reach the live doc as Yjs
updates, never by replacing its stored state: a device with a local copy would merge the old
blocks back in.

## Build ID

`vite.config.ts` sets `__CAREHUB_VERSION__` from `CAREHUB_VERSION` when building (the Dockerfile
passes its build arg), and `0.0.0-dev` otherwise. It must match the server's `CAREHUB_VERSION`.

## Not yet

- Calling `sendWaitingChanges` after sign-in and `forgetLocalCopies` on sign-out.
- Using `CollabEditor` in the page view (pages lane).
- Comment-only access ("Can comment"), with the server change for it.
