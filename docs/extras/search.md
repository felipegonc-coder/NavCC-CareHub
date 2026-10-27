# Search

Spec: [search.md](../plan/specs/search.md) (checks SR-01 to SR-16). Folders: `apps/server/src/features/search/`, `apps/web/src/features/search/` and `packages/extras/src/search/` (`@carehub/extras/search`). Tables start with `search_`.

## The index

`search_entries` has one row per page, database and row: where it is (workspace, space, parent pages), title, icon, block text (one block per line, as in `page_docs.text`), text other features add, who made and edited it and when, archived and Trash. Access is never copied into it: every search checks it again (spec 3.3).

- **Folding.** Postgres can't drop accents without an extension, so the server folds text with `fold()` from `@carehub/extras/search` (lowercase, accents removed, "ß" as "ss") before it builds the index, and folds what people type the same way. "goncalves" finds "Gonçalves".
- **Words.** `doc_tsv` holds the English word forms and the plain words of the title (weight A), headings (weight B, from `page_docs.markdown` once #198 fills it) and text. English forms make "refunds" find "refund"; plain words keep stop words ("it", "about") and IDs like "QA-17" searchable.
- **Limits.** Up to 200,000 characters of text and of added text per page.

## When it's updated (SR-09)

| What                                | How                                                                                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| New page, rename, move, kind change | `page.created`, `page.updated`, `page.kindChanged`: the page is indexed again at once; after a move, the pages under it get their new place |
| Trash and restore                   | `page.trashed` hides the page and everything under it at once; `page.restored` indexes them again                                           |
| Deleted for good                    | `page.deleted` removes the page and everything under it                                                                                     |
| Content edits                       | Every 2 seconds, pages whose `page_docs.text_updated_at` moved (with a 30-second overlap for late commits)                                  |
| Server start                        | Pages the page model has and the index doesn't (for example from the seed)                                                                  |

Event payloads are read loosely: only `pageId` (and `pageIds`, if core sends a list) are used. Indexing errors are logged with the Postgres error code only, never the query, because its parameters hold page text.

## For other features (`apps/server/src/features/search/index.ts`)

- `registerSearchText(kind, (db, pageId) => Promise<string>)`: text for every page of that kind, one block per line. Databases registers `'row'` with the values the toolbar search uses, leaving out properties with access rules (hidden properties are never matched or shown).
- `reindexForSearch(db, pageIds)`: index pages again when something you own changes their text, such as a row's property values. Safe to call often.

## Stand-ins (deny by default)

`pages.ts` holds what search needs from features that aren't on main yet. Until they're bound, there are no pages to index, nobody has access and nobody is a member, so search finds nothing.

| Stand-in                                                               | Replaced by                                                                                |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `getPagesForIndex(db, pageIds)`, `listPageIds(db, { afterId, limit })` | The page model (#49): page rows with their parent pages, and pages PR 2's archived columns |
| `getAccessForPages(db, userId, pageIds)`                               | `getAccessForPages` from `features/pages/index.ts` (#49)                                   |
| `getSpaces(db, userId, spaceIds)`                                      | The spaces API (#49)                                                                       |
| `memberOf(request)` reads `request.member`                             | Accounts 1b (#55)                                                                          |
| Polling `page_docs` and reading its `markdown`                         | S4's `page.contentSaved` event and `getPageContent` (#200)                                 |

Tests bind fakes with `bindSearchPages` and `bindSearchMember`.
