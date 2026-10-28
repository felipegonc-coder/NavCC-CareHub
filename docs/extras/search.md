# Search

Spec: [search.md](../plan/specs/search.md) (checks SR-01 to SR-16). Folders: `apps/server/src/features/search/`, `apps/web/src/features/search/` and `packages/extras/src/search/` (`@carehub/extras/search`). Tables start with `search_`.

## The index

`search_entries` has one row per page, database and row: where it is (workspace, space, parent pages), title, icon, block text (one block per line, as in `page_docs.text`), text other features add, who made and edited it and when, archived and Trash. Access is never copied into it: every search checks it again (spec 3.3).

- **Folding.** Postgres can't drop accents without an extension, so the server folds text with `fold()` from `@carehub/extras/search` (lowercase, accents removed, "ß" as "ss") before it builds the index, and folds what people type the same way. "assuncao" finds "Assunção".
- **Words.** `doc_tsv` holds the English word forms and the plain words of the title (weight A), headings (weight B, from `page_docs.markdown` once #198 fills it) and text. English forms make "refunds" find "refund"; plain words keep stop words ("it", "about") and IDs like "QA-17" searchable.
- **Limits.** Up to 200,000 characters of text and of added text per page.

## When it's updated (SR-09)

| What                                | How                                                                                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| New page, rename, move, kind change | `page.created`, `page.updated`, `page.kindChanged`: the page is indexed again at once; after a move, the pages under it get their new place |
| Trash and restore                   | `page.trashed` hides the page and everything under it at once; `page.restored` indexes them again                                           |
| Archive                             | `page.archived` and `page.unarchived`: the page and everything under it are indexed again at once, with the page model's archived state     |
| Deleted for good                    | `page.deleted` removes the page and everything under it                                                                                     |
| Content edits                       | Every 2 seconds, pages whose `page_docs.text_updated_at` moved (with a 30-second overlap for late commits)                                  |
| Server start                        | Pages the page model has and the index doesn't (for example from the seed)                                                                  |

Event payloads are read loosely: only `pageId` (and `pageIds`, if core sends a list) are used. Indexing errors are logged with the Postgres error code only, never the query, because its parameters hold page text.

## Searching: `POST /api/search/query`

Body: `{ text, filters?, sort?, match?, cursor?, limit? }` (`searchRequestSchema` in `@carehub/extras/search`). Answer: `{ results, total, nextCursor }`, 20 results at a time; pass `nextCursor` back for more.

- **Text** (`parseQuery`): every word must match; `OR` (in capitals) between words, `"exact phrases"` and `-excluded` words. A hyphen inside a word (QA-17) isn't an exclude. While typing, the last word also matches as a beginning, until a space follows it.
- **Any word** (`match: 'any'`, default `'all'`): at least one word must match, and results with more of the words come first, then Best match. The last word is never a beginning. Excluded words still exclude.
- **Filters:** `titleOnly`, `createdBy` and `editedBy` (user IDs), `in` (spaces or pages, with everything under them), `date` (`{ field: 'edited' | 'created', from?, to? }`, `to` not included), `types` (`page`, `database`, `row`; `file` finds nothing until file text is read, SR-D1) and `includeArchived` (archived pages and the pages under them are left out unless it's on). Sorts: `best`, `edited_desc`, `edited_asc`, `created_desc`, `created_asc`.
- **Access first.** Postgres finds up to 2,000 matches; their access is checked before anything is counted, ranked or shown, and only pages with Can view or more are kept (up to 1,000). Paths leave out parent pages the person can't open. An `in` filter for a space or page the person can't open finds nothing from it. Share-link visitors and people outside the workspace get 403.
- **Best match** (`best`): exact title, then title starting with the words, then all words in the title, then headings, then text. Within each, boosts reorder: other features' boosts (`registerSearchBoost`, each kept between -2 and 2), +1 for ✓ Verified, +1 when edited in the last 7 days, -2 when archived. Ties go to the most recent edit.
- **Did you mean** (SR-11): when the search box's first page has fewer than 3 results, the answer adds `didYouMean`, the text with each word no title has swapped for a title word one or two letters off (one for words of 3 or 4 letters). Only titles the person can open count, Trash left out and archived pages only with `includeArchived`. Page pickers (`limit`), later pages and `match: 'any'` don't get it.
- **Results:** title with the matching words as ranges, icon, path, a snippet of up to 160 characters from the block with the most matching words, created and edited (with the editor's name), "Row in" the database, ✓ Verified and Archived.

## The search window (`apps/web/src/features/search`)

- **Opening it:** Ctrl+K or Ctrl+P (⌘ on a Mac) on any screen, through the shell's `overlays` slot, or **Search** at the top of the sidebar (`sidebarSections`). When the editor has already used Ctrl+K (a link, with text selected), the window stays shut. `openSearch()` in `open.ts` opens it too.
- **Results:** `POST /api/search/query` 80 ms after typing stops, 20 at a time as you scroll or move down. The previous results stay while new ones load, and grey rows show after 150 ms if there were none. The first result is selected.
- **Keys:** it's a combobox. ↑ and ↓ move through every list, Enter opens the page, Ctrl+Enter opens it in a new tab, and Esc closes the window and puts the focus back where it was. Commands from the `commands` slot that match the text come first, under "Actions".
- **Before typing** (SR-02): "Recent", the last 8 pages the person opened (`GET /api/search/recent`), and "Recent searches", their last 5, each with ✕ (or Delete while it's selected) and **Clear**. Picking a recent search searches for it again. With neither: "Type to search pages, databases and rows." Offline: "You're offline. Showing recent pages." with the recent pages it last loaded.
- **What's recorded:** opening a result or pressing Enter saves the search (`POST /api/search/history` with `save: true`); closing the window or going to Trash only counts it (`save: false`). The shell reports each `/p/<id>` that opens to `POST /api/search/visits` (a stand-in in `SearchOverlay.tsx` for core's `page.viewed`).
- **No results** (SR-11): "No results for ‘refnd’.", then "Did you mean refund?" when the answer has `didYouMean` (its button searches for that instead; with 1 or 2 results it shows under them), and **Search in Trash**, which closes the window and opens `/trash?q=<text>` (see With other features).
- **Filters and sort** (SR-06): under the box, the chips Title only, Type (Pages, Databases, Rows, Files) and Include archived. Then **Clear filters** once one is on (also under No results), and Sort: Best match, or Edited or Created, newest or oldest first. Tab reaches each of them; on phones they're one row that scrolls sideways. Filters are saved with a recent search, and picking it brings them back.
- **Missing:** the In, Created by, Edited by and Date chips, and Shift+Enter for the side panel (the page view has none).

## For other features (`apps/server/src/features/search/index.ts`)

- `registerSearchText(kind, (db, pageId) => Promise<string>)`: text for every page of that kind, one block per line. Databases registers `'row'` with the values the toolbar search uses, leaving out properties with access rules (hidden properties are never matched or shown).
- `reindexForSearch(db, pageIds)`: index pages again when something you own changes their text, such as a row's property values. Safe to call often.
- `registerSearchBoost(name, (db, { userId, workspaceId, pageIds }) => Promise<Map<pageId, { boost?, verified? }>>)`: ranking help. The Knowledge base marks ✓ Verified pages this way.
- `runSearch(db, { userId, workspaceId }, request)`: the same search as `POST /query`, with the same access checks; `request` is checked with `searchRequestSchema`. The assistant panel (Claude spec 3.3) passes `{ text: searchWords(question).join(' '), match: 'any' }`: `searchWords` from `@carehub/extras/search` keeps up to 12 words of the question, without common words (`COMMON_WORDS`), repeats or punctuation, and with IDs like "QA-17" whole.
- `listSearchTerms(db, workspaceId, { from, to })` (days as `'2026-10-01'` or dates, both included): `{ term, searches, people, noResults, opened }[]`, most searched first, for Analytics. A term is listed only once 2 different people searched it on the same day; `people` is the most on one day, because people are counted per day without saving who.
- `forgetSearchTermsBefore(db, workspaceId, day)`: for Data settings' clean-up, as search terms are kept as long as Analytics activity (spec 3.4). Removes the workspace's counts from before `day` (`'2026-10-01'` or a date), which is kept.

## Before typing, the people chips and search terms

| Endpoint                        | What                                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `GET /api/search/recent`        | `{ pages, searches }`: the last 8 pages the person opened and can still open, and their last 5 searches |
| `DELETE /api/search/recent/:id` | Removes one of the person's own recent searches (✕); anyone else's stay as they are                     |
| `DELETE /api/search/recent`     | Clear                                                                                                   |
| `POST /api/search/history`      | A search ended: `{ text, filters, save, found, opened? }` (`searchHistorySchema`)                       |
| `POST /api/search/visits`       | Stand-in: the window reports the page that's open, until core sends `page.viewed`                       |
| `GET /api/search/people`        | `?role=created` or `edited`, and `q`: who to offer in the Created by and Edited by chips                |

- **Recent searches** (`search_recent`): saved with `save: true`, when the person opens a result or presses Enter (spec 3.4). The same text again (any case) moves to the top; the last 5 per person and workspace are kept.
- **Opened pages** (`search_visits`): from `page.viewed` (`{ pageId, userId }` or `{ pageId, by }`), opened results and the stand-in above; only pages the person can open are recorded. Pages opened in the last 30 days rank +1 (`opened-recently` boost).
- **Search terms** (`search_terms`): per workspace and day (in the workspace's time zone from S1's settings; America/Denver until there is one), the term (lowercase, single spaces, up to 100 characters), searches, people, searches that found nothing and searches that led to an opened result. Who searched isn't saved. To count each person once a day, a hash of (workspace, person, term) is kept with a random key for that day only; both are deleted once the day is over, so the counts can't be traced back to anyone.
- **People** (`/people`): who created (or last edited) pages the person can open, among the workspace's 2,000 most recently edited pages, most pages first, up to 20. `q` matches the start of the name or of any word in it, accents and case ignored.

## Stand-ins (deny by default)

`pages.ts` binds search to the page model and accounts: `model.ts` reads pages and their parent pages from the `pages` and `spaces` tables (archived or in Trash when the page, a parent page or its space is), access comes from `getAccessForPages` in `features/pages`, and membership from `request.member`. The rest are stand-ins:

| Stand-in                                                               | Replaced by                                                                                |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `getSpaces(db, userId, spaceIds)`: names of spaces the person can open | The spaces API (#49). Without it, paths leave out space names and `in` spaces find nothing |
| Polling `page_docs` and reading its `markdown`                         | S4's `page.contentSaved` event and `getPageContent` (#200)                                 |
| `POST /api/search/visits` from the window                              | Core's `page.viewed` event, or the Sidebar's recent pages                                  |
| Search term days in America/Denver                                     | The workspace's time zone from S1's settings                                               |

Tests bind fakes with `bindSearchPages` and `bindSearchMember`.

## With other features

- **Search in Trash** (the window's No results): Search goes to `/trash?q=<text>`, and S2's Trash opens as a dialog named "Trash" with its search box filled from `q`.
