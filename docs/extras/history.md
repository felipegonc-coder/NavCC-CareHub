# History

Spec: [page-history-and-trash.md](../plan/specs/page-history-and-trash.md) (checks HT-01 to HT-08 and HT-14 to HT-16; Trash, HT-09 to HT-13, is core's). Folders: `apps/server/src/features/history/`, `apps/web/src/features/history/` and `packages/extras/src/history/` (`@carehub/extras/history`). Tables start with `history_`.

## Versions

- **Automatic** (HT-01). Each save of the collaboration server opens or extends the page's stretch of edits (`history_edits`). The periodic task `history.versions` (every 15 seconds) saves a version once nobody has edited for 2 minutes, or once the stretch is 9 minutes old, so long sessions get one at least every 10 minutes. The version names everyone who edited in the stretch. An automatic version identical to the newest one isn't kept.
- **Before a change** (HT-02): `saveVersionNow` below, or `POST /api/history/pages/:pageId/versions` from the editor. Such a version takes the open stretch with it, so no automatic version follows for those edits.
- **What's kept** (`history_versions`): a full copy of the title, icon, cover, page style and content (ProseMirror JSON), the kind, the name, the editors, who caused it, its size and a sha-256 digest. The spec allows storing changes with a full copy every 20 versions; full copies come first, and reading doesn't depend on it.
- **Kinds:** `automatic`, `before_restore`, `before_import`, `before_template`, `before_replace` (Replace all), `before_accept_all` (Accept all suggestions) and `before_automation`. "Named" isn't a kind: any version can have a name.
- **Named versions** are kept forever, up to 100 per page (409 after that).
- **Clean-up** (HT-03): the hourly task `history.cleanup` runs in the 3 AM hour (Denver time until workspaces have their own) and deletes unnamed versions and Updates entries older than the workspace's period, counting ages from 3:00 sharp. Then it emits `history.versions.cleaned`.
- **Deleted pages** (HT-11): `page.deleted` removes their versions and Updates entries.

## Updates

What happened on a page, for its Updates panel (HT-08). An entry (`history_updates`) holds the page, who did it (null for automations), the kind, a few details and, for edits, the version; never page content. Entries are kept as long as the automatic versions (above).

- **Edits:** every version saved, automatic or before a change, adds an `edited` entry for each person whose edits it holds, in the same transaction. `changes` is how many changes Show changes marks against the version before; a page's first version has none to count.
- **The page model's events** (#49), after the commit: `page.created` → `created`; `page.updated` with `title: { from, to }` → `renamed`, with `parentId: { from, to }` (null for the top of the space) → `moved`, with `locked: true | false` → `locked` or `unlocked`; `access.changed` → `shared`; `page.archived`, `page.unarchived`, `page.trashed` and `page.restored` → `archived`, `unarchived`, `trashed` and `untrashed`. Each needs `pageId`; `by` is the person (null for automations), and `workspaceId` is looked up when it's missing. Until core declares these events they're read loosely: other fields are ignored, and a payload without a valid `pageId` adds nothing.
- **Comments and history:** `comment.created` → `commented` (a reply when `newThread` is false); `history.version.restored` → `restored`, with when the restored version was saved.
- **Who sees what** (HT-08, HT-15): the list needs Can view. A move between pages names each page only if the person can open it; otherwise the place is `{ kind: 'hidden' }` ("a page you can't open"), with no ID or title. Property changes show only to people who can see the property. Only people with Can edit get `versionId`, which Show changes opens in Version history.

## Archive

For pages and databases that are done but worth keeping (spec 3.5, HT-14). The page model keeps who archived what and does the archiving (pages PR 2: `archived_at`, `archived_by`, `archivePage`, `unarchivePage`, and a sidebar tree without archived pages). History checks access, refuses rows and says how many sub-pages go along.

- **Archive** needs Full access. The page and its sub-pages turn read-only: the page model keeps them from being edited, and their versions can't be restored or named. A row can't be archived on its own ("Rows can't be archived. Use a property or Trash."), nor can a page that's already archived, by itself or with a parent page (both 409).
- **Unarchive** puts back the page that was archived and everything that went with it, even when asked from a sub-page (its banner). It needs Full access on that page; anyone else gets 403 without its title.
- **Sub-pages** are counted without rows and Trash, the same way in the confirm and in the answer, and only for people with Full access.
- **Events**, after the commit: `page.archived { pageId, pageIds, by }` and `page.unarchived { pageId, pageIds, by }`, where `pageIds` are the page and everything that went with it. Updates records `archived` and `unarchived` on the page. Search re-indexes `pageIds` (left out unless Include archived); reminders, review notices (knowledge base), automations and forms stop and start again from them.

## Show changes and the preview

- `diffDocs(previous, version)` in `@carehub/extras/history` compares a version with the one before it. Whole blocks are compared first. Blocks of the same type that changed are compared inside: the blocks of a list, quote or table one by one, and the text of a paragraph or heading word by word. A change of marks alone doesn't count as changed text, but its block still shows as changed. `countChanges` gives the number of changes, for "3 changes" in Updates.
- Labels: `versionLine` ("Today, 3:12 PM · Avery Lin, Sam Ortiz"), `versionDay` (the day groups), `versionDate` ("Oct 20, 3:00 PM"), `versionKindLabel` ("Before Replace all"), `restoreQuestion` and `restoreNote`.
- `VersionPreview` (`apps/web/src/features/history/`) shows a version read-only. It uses the elements the editor reads when pasting (headings as `<h2>` to `<h4>` with `data-level`, lists, to-dos, quotes, code), so copied blocks keep their formatting (HT-07). With Show changes on (HT-04):
  - added text is green;
  - removed text is struck through in red and is never copied;
  - changed blocks get a bar in the margin;
  - screen readers hear "added" and "removed".
    Blocks it can't draw, such as a database, show their name.

## The Version history window (web)

- **Opens** from the page menu ("Version history", on pages and rows; a database has no versions of its own), with Ctrl+Alt+H on a page (Ctrl+Option+H on a Mac, where Cmd+Option+H is Hide Others), and from `?version=<versionId>` links (Copy link), which start on that version. Other web features open it with `openVersionHistory` (below). Going to another screen closes it.
- **Layout:** the preview on the left, the versions on the right, newest first and grouped by day, named ones in bold, with a label for versions saved before a change ("Before a restore"). On phones the list shows first; a tap shows the preview, and "Versions" goes back.
- **Keyboard:** the list takes focus once it loads; ↑ and ↓ move, Home and End jump, Enter asks to restore the version, Esc closes. Tab reaches Show changes (on at first), Copy link, Name this version and Restore this version. More versions load near the end of the list, or with "Show older versions".
- **Restore** (HT-05): "Restore this version" asks "Replace the current page with the version from Oct 20, 3:00 PM? The current page is saved as a version first." with Cancel and Restore (which has focus). After the restore the window closes and the note "Avery Lin restored a version from Oct 20, 3:00 PM." shows. Others editing the page get the same note from `history.restored`; the tab that restored doesn't show it twice. A refusal shows "Couldn't restore this version." with the server's reason, such as "This page is locked. Unlock it first."
- **Names:** "Name this version" opens a dialog ("Rename this version" for a named one) with the field "Name" (up to 100 characters), Save (off until there's a name; spaces alone don't count), Cancel and, for a named one, "Remove name". The 101st name is refused with "This page has 100 named versions. Remove a name first." under the field.
- Restoring and naming need `canRestore` (Can edit, and the page isn't locked or archived). Without it the buttons are gone and the window says "The page is locked or archived, so versions can't be restored or named."
- **States:** "Versions appear here after the first edits."; no access (403) and not found (404) without any page details; a version that's gone shows the server's message.
- **Live:** the list refreshes on `history.versions`, `history.restored` and after a reconnect.
- The menu item shows for everyone who can open the page, since the page menu doesn't know the person's access yet; without Can edit the window says "You don't have access to this." Default: hide it once `SlotPage` carries the access (page model, #49).

## The Updates panel (web)

- **Opens** from the page menu ("Updates", on every page, row and database) and with `openUpdates` (below). The 🕘 in the top bar waits for a top-bar slot (core). Going to another screen closes it; on phones it fills the screen.
- **Lists** what happened, newest first, 50 at a time ("Show older updates"), grouped per person and hour under the name and the newest time ("Sam Ortiz · Today, 3:12 PM"). Each line reads whole for screen readers: "Sam Ortiz edited · 3 changes", "renamed the page from “Refunds” to “Refund steps”", "moved the page from a page you can't open to Policies", "changed Status: Open → Done", "restored a version from Oct 20, 3:00 PM". Someone without a name (an automation, or a person no longer known) shows as "Someone". The wording is in `updateText` and `groupUpdates` (`@carehub/extras/history`).
- **Show changes** (only on edits, only with Can edit) closes the panel and opens Version history on that version.
- **States:** "Nothing has happened on this page yet."; no access (403) and not found (404) without any page details.

## Archive in the page (web)

- **Archive** is in the page menu of pages and databases (a row goes along with its database), but not on a page whose banner shows it's archived. It asks "Archive “Policies”?" with "The page and its 12 sub-pages turn read-only and leave the sidebar and search. Links still open them, and Unarchive puts everything back." and the buttons Cancel and Archive. Without Full access, or on a page that's already archived, it says why ("Only people with Full access can archive this page.", "This page is already archived.") and has only Close. Going to another screen closes it.
- **After Archive** the note "Archived “Policies” and its 12 sub-pages." shows. A refusal shows "Couldn't archive this page." with the server's reason.
- **The banner:** an archived page and its sub-pages say "Archived by Sam Ortiz on Oct 20, 2026" in yellow above the title, with "Unarchive" for people with Full access on the page that was archived. Unarchive puts everything back: "Unarchived “Policies” and its 12 sub-pages."
- After either change the archive states and core's `pages` queries (the page view, the sidebar tree) refresh.
- The Archived tab in Trash (core) unarchives with `POST /api/history/pages/:pageId/unarchive`.
- Like Version history, the menu item shows for everyone who can open the page; without Full access the confirm says so. Default: hide it once `SlotPage` carries the access (page model, #49).

## For other web features (`apps/web/src/features/history/index.ts`)

- `openVersionHistory({ id, title }, versionId?)` opens Version history, on that version if given; for example Updates' Show changes.
- `openUpdates({ id, title })` opens the Updates panel, for the top bar's 🕘.
- `saveVersionBefore(pageId, 'replace' | 'accept_all')` saves a version right before the editor's Replace all or Accept all suggestions changes the page (HT-02). Wait for it, then make the change. It gives the saved version, or null when the page keeps no versions (404, also while the server's stand-ins below aren't bound). When it throws, leave the page as it is and show the error's message.

## For other features (`apps/server/src/features/history/index.ts`)

- `saveVersionNow(tx, pageId, { reason, by })` saves a version right away. Call it in the transaction that replaces the content, before the change: a rollback drops the version too. `reason` is `'restore' | 'import' | 'template' | 'replace' | 'accept_all' | 'automation'`; `by` is the person, or null for automations. It returns `{ id, pageId, kind, createdAt }`, or null when the page has no versions (missing, in Trash, a database). Until the page model and the content API are on main it always returns null and runs no queries. In tests, mock `../history` and check the call.
- `countExpiringVersions(db, workspaceId, days, now?)`: how many unnamed versions are older than `days`, for "Tonight this permanently deletes 1,240 page versions…" (Data settings, DS-01). Pass `nextCleanupAt()` as `now` and the count is exactly what that night deletes.
- `versionStorageBytes(db, workspaceId)`: bytes the workspace's versions take, for the storage numbers in Data settings.
- Workspace setting `history.versionRetentionDays` (`VERSION_RETENTION_KEY`): `30`, `90`, `365` or `null` (forever); the default is 365 (DS-D2). Validate it with `versionRetentionSchema` from `@carehub/extras/history`. Anything else counts as the default.
- `recordUpdates(tx, [{ pageId, workspaceId, kind, by, details? }])` adds entries to pages' Updates, in your transaction (a rollback drops them too). Databases: `kind: 'property_changed'` with `details: { property: { id, name, from, to } }`, the values as text ("Status: Open → Done"). Comments and mentions: `kind: 'suggestion_accepted'`. Keep details small, never page content.
- Events, after the commit: `history.version.restored { pageId, workspaceId, versionId, restoredVersionId, by }` (`versionId` is the version saved just before the restore) and `history.versions.cleaned { workspaceId, deleted, at }` (for Data settings' clean-up record).

## API (`/api/history`)

| Request                                                              | Access                           | Answer                                                                                                                              |
| -------------------------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `GET /pages/:pageId/versions?before&limit`                           | Can edit                         | `VersionListResponse`: newest first, 50 at a time, and `canRestore`                                                                 |
| `GET /pages/:pageId/versions/:versionId`                             | Can edit                         | `VersionResponse`: what the version holds, and the version before it for Show changes                                               |
| `POST /pages/:pageId/versions { reason: 'replace' \| 'accept_all' }` | Can edit, not locked or archived | 201 `SavedVersionResponse`; nothing new when nothing changed since the newest version                                               |
| `PATCH /pages/:pageId/versions/:versionId { name }`                  | Can edit, not locked or archived | `SavedVersionResponse`; an empty name or null removes it                                                                            |
| `POST /pages/:pageId/versions/:versionId/restore`                    | Can edit, not locked or archived | `SavedVersionResponse` with the version saved just before (`createdBy` is the restorer, `restoredFrom` the restored version's time) |
| `GET /pages/:pageId/updates?before&limit`                            | Can view                         | `UpdateListResponse`: newest first, 50 at a time, as "Who sees what" above says                                                     |
| `GET /pages/:pageId/archive`                                         | Can view                         | `ArchiveState`: who archived it (or the parent page it went with) and when, `canChange`, and how many sub-pages go along            |
| `POST /pages/:pageId/archive`                                        | Full access, not a row           | `ArchiveChange` `{ pageId, title, subPages }`; 409 for a row or a page that's already archived                                      |
| `POST /pages/:pageId/unarchive`                                      | Full access (see Archive)        | `ArchiveChange` for the page that was archived; 409 when the page isn't archived                                                    |

Missing pages, pages in Trash and malformed IDs answer 404; too little access answers 403 "You don't have access to this." without the title (HT-15). A version that's gone answers 404 "This version is too old to show (deleted under the Data settings period)." Shapes are in `@carehub/extras/history`.

A restore saves the page first (unsaved edits included), puts back the version's content, title, icon, cover and page style as one change, then emits `page.updated { pageId, by, content: true, source: 'history.restore' }` so open editors merge it. Other pages are never restored or deleted (HT-06). Open tabs with Can edit hear `history.restored { pageId, versionId }` and `history.versions { pageId }` on the live topic `history:<pageId>`, and show the note "Avery Lin restored a version from Oct 20, 3:00 PM." (`restoreNote`).

## Stand-ins (deny by default)

Until they're bound nothing is tracked or saved, no queries run and the routes answer 404.

| Stand-in                                                             | File                               | Replaced by                                           |
| -------------------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------- |
| The page, `getPageAccess`, putting back title, icon, cover and style | `pages.ts`                         | the page model, `features/pages/index.ts` (#49)       |
| `getPageContent`, `setPageContent`                                   | `content.ts`                       | `features/collab/index.ts` (#200)                     |
| Polling `page_docs.updated_at`                                       | `versions.ts` (`recordSavedEdits`) | the event `page.contentSaved` (#200), already handled |
| `history.versionRetentionDays`                                       | `retention.ts`                     | `getWorkspaceSetting` (workspaces 1c)                 |
| The workspace's time zone for the clean-up                           | `retention.ts`                     | workspaces 1c                                         |
| Titles of the pages a move went between (`getPageTitles`)            | `pages.ts`                         | `getPageCards` in the page model (#49)                |
| Which of a row's properties the person sees: none until bound        | `updateList.ts`                    | the Databases lane's property check                   |
| Archiving: who archived what, sub-pages, archive and unarchive       | `pages.ts`                         | the page model's archiving (pages PR 2)               |

The periodic tasks run in the jobs runner, which starts once the jobs routes are registered (#288).

## Gaps in the spec

- The spec's list of version kinds has no kind for Accept all suggestions, though it says one is saved first. It has its own kind, `before_accept_all`.
