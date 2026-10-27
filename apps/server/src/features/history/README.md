# History (server)

Page versions, Updates and Archive from the [Page history and Trash spec](../../../../../docs/plan/specs/page-history-and-trash.md)
(HT-01 to HT-08, HT-14 to HT-16). Trash (HT-09 to HT-13) is core's. Extras lane, decision 0400.

## For other features

`saveVersionNow(tx, pageId, { reason, by })` from `features/history/index.ts` saves a version of
the page right away. Call it in the transaction that replaces the content, before the change
(HT-02):

```ts
import { saveVersionNow } from '../history';

await db.transaction(async (tx) => {
  await saveVersionNow(tx, pageId, { reason: 'template', by: user.id });
  await setPageContent(tx, pageId, doc, user.id);
});
```

- `reason`: `'restore' | 'import' | 'template' | 'replace' | 'accept_all' | 'automation'`; the
  version's kind is `before_<reason>`. `by` is the person, or null for automations.
- A rollback drops the version too. The version covers the edits not saved in a version yet, so
  no automatic version follows for them.
- Returns `{ id, pageId, kind, createdAt }`, or null when the page has no versions: missing, in
  Trash, a database, or (until the page model and the content API are on main) always.

## How versions are saved

- Each save of the collaboration server opens or extends the page's stretch of edits
  (`history_edits`). A periodic task (`history.versions`, every 15 seconds) saves an automatic
  version once nobody has edited for 2 minutes, or once the stretch is 9 minutes old, so long
  sessions get one at least every 10 minutes. The version names everyone who edited in the stretch.
- A version is a full copy of the title, icon, cover, page style and content (`history_versions`).
  An automatic version identical to the newest one isn't kept.
- `page.deleted` removes the page's versions (HT-11).

## Stand-ins

They deny by default: nothing is tracked or saved and no queries run until they're bound.

| Stand-in                           | File                               | Replaced by                                                    |
| ---------------------------------- | ---------------------------------- | -------------------------------------------------------------- |
| The page (`getPage`)               | `pages.ts`                         | the page model, `features/pages/index.ts` (#49)                |
| `getPageContent`, `setPageContent` | `content.ts`                       | `features/collab/index.ts` (#200)                              |
| Polling `page_docs.updated_at`     | `versions.ts` (`recordSavedEdits`) | the event `page.contentSaved` (#200), which is already handled |

The periodic task runs in the jobs runner, which starts once the jobs routes are registered (#288).
