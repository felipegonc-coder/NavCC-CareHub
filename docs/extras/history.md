# History

Spec: [page-history-and-trash.md](../plan/specs/page-history-and-trash.md) (checks HT-01 to HT-08 and HT-14 to HT-16; Trash, HT-09 to HT-13, is core's). Folders: `apps/server/src/features/history/`, `apps/web/src/features/history/` and `packages/extras/src/history/` (`@carehub/extras/history`). Tables start with `history_`.

## Versions

- **Automatic** (HT-01). Each save of the collaboration server opens or extends the page's stretch of edits (`history_edits`). The periodic task `history.versions` (every 15 seconds) saves a version once nobody has edited for 2 minutes, or once the stretch is 9 minutes old, so long sessions get one at least every 10 minutes. The version names everyone who edited in the stretch. An automatic version identical to the newest one isn't kept.
- **Before a change** (HT-02): `saveVersionNow` below, or `POST /api/history/pages/:pageId/versions` from the editor. Such a version takes the open stretch with it, so no automatic version follows for those edits.
- **What's kept** (`history_versions`): a full copy of the title, icon, cover, page style and content (ProseMirror JSON), the kind, the name, the editors, who caused it, its size and a sha-256 digest. The spec allows storing changes with a full copy every 20 versions; full copies come first, and reading doesn't depend on it.
- **Kinds:** `automatic`, `before_restore`, `before_import`, `before_template`, `before_replace` (Replace all), `before_accept_all` (Accept all suggestions) and `before_automation`. "Named" isn't a kind: any version can have a name.
- **Named versions** are kept forever, up to 100 per page (409 after that).
- **Clean-up** (HT-03): the hourly task `history.cleanup` runs in the 3 AM hour (Denver time until workspaces have their own) and deletes unnamed versions older than the workspace's period, counting ages from 3:00 sharp. Then it emits `history.versions.cleaned`.
- **Deleted pages** (HT-11): `page.deleted` removes their versions.

## Show changes and the preview

- `diffDocs(previous, version)` in `@carehub/extras/history` compares a version with the one before it. Whole blocks are compared first. Blocks of the same type that changed are compared inside: the blocks of a list, quote or table one by one, and the text of a paragraph or heading word by word. A change of marks alone doesn't count as changed text, but its block still shows as changed. `countChanges` gives the number of changes, for "3 changes" in Updates.
- Labels: `versionLine` ("Today, 3:12 PM · Avery Lin, Sam Ortiz"), `versionDay` (the day groups), `versionDate` ("Oct 20, 3:00 PM"), `versionKindLabel` ("Before Replace all"), `restoreQuestion` and `restoreNote`.
- `VersionPreview` (`apps/web/src/features/history/`) shows a version read-only. It uses the elements the editor reads when pasting (headings as `<h2>` to `<h4>` with `data-level`, lists, to-dos, quotes, code), so copied blocks keep their formatting (HT-07). With Show changes on (HT-04):
  - added text is green;
  - removed text is struck through in red and is never copied;
  - changed blocks get a bar in the margin;
  - screen readers hear "added" and "removed".
    Blocks it can't draw, such as a database, show their name.

## For other features (`apps/server/src/features/history/index.ts`)

- `saveVersionNow(tx, pageId, { reason, by })` saves a version right away. Call it in the transaction that replaces the content, before the change: a rollback drops the version too. `reason` is `'restore' | 'import' | 'template' | 'replace' | 'accept_all' | 'automation'`; `by` is the person, or null for automations. It returns `{ id, pageId, kind, createdAt }`, or null when the page has no versions (missing, in Trash, a database). Until the page model and the content API are on main it always returns null and runs no queries. In tests, mock `../history` and check the call.
- `countExpiringVersions(db, workspaceId, days, now?)`: how many unnamed versions are older than `days`, for "Tonight this permanently deletes 1,240 page versions…" (Data settings, DS-01). Pass `nextCleanupAt()` as `now` and the count is exactly what that night deletes.
- `versionStorageBytes(db, workspaceId)`: bytes the workspace's versions take, for the storage numbers in Data settings.
- Workspace setting `history.versionRetentionDays` (`VERSION_RETENTION_KEY`): `30`, `90`, `365` or `null` (forever); the default is 365 (DS-D2). Validate it with `versionRetentionSchema` from `@carehub/extras/history`. Anything else counts as the default.
- Events, after the commit: `history.version.restored { pageId, workspaceId, versionId, restoredVersionId, by }` (`versionId` is the version saved just before the restore) and `history.versions.cleaned { workspaceId, deleted, at }` (for Data settings' clean-up record).

## API (`/api/history`)

| Request                                                              | Access                           | Answer                                                                                                                              |
| -------------------------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `GET /pages/:pageId/versions?before&limit`                           | Can edit                         | `VersionListResponse`: newest first, 50 at a time, and `canRestore`                                                                 |
| `GET /pages/:pageId/versions/:versionId`                             | Can edit                         | `VersionResponse`: what the version holds, and the version before it for Show changes                                               |
| `POST /pages/:pageId/versions { reason: 'replace' \| 'accept_all' }` | Can edit, not locked or archived | 201 `SavedVersionResponse`; nothing new when nothing changed since the newest version                                               |
| `PATCH /pages/:pageId/versions/:versionId { name }`                  | Can edit, not locked or archived | `SavedVersionResponse`; an empty name or null removes it                                                                            |
| `POST /pages/:pageId/versions/:versionId/restore`                    | Can edit, not locked or archived | `SavedVersionResponse` with the version saved just before (`createdBy` is the restorer, `restoredFrom` the restored version's time) |

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

The periodic tasks run in the jobs runner, which starts once the jobs routes are registered (#288).

## Gaps in the spec

- The spec's list of version kinds has no kind for Accept all suggestions, though it says one is saved first. It has its own kind, `before_accept_all`.
