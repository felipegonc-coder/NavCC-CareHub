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
- **Results:** title with the matching words as ranges, icon, path, a snippet of up to 160 characters from the block with the most matching words, created and edited (with the editor's name), "Row in" the database, ✓ Verified and Archived.

## The search window (`apps/web/src/features/search`)

- **Opening it:** Ctrl+K or Ctrl+P (⌘ on a Mac) on any screen, through the shell's `overlays` slot, or **Search** at the top of the sidebar (`sidebarSections`). When the editor has already used Ctrl+K (a link, with text selected), the window stays shut. `openSearch()` in `open.ts` opens it too.
- **Results:** `POST /api/search/query` 80 ms after typing stops, 20 at a time as you scroll or move down. The previous results stay while new ones load, and grey rows show after 150 ms if there were none. The first result is selected.
- **Keys:** it's a combobox. ↑ and ↓ move through every list, Enter opens the page, Ctrl+Enter opens it in a new tab, and Esc closes the window and puts the focus back where it was. Commands from the `commands` slot that match the text come first, under "Actions".
- **Not yet:** Recent and Recent searches before typing, the filter chips and sort, Did you mean and Search in Trash, and Shift+Enter for the side panel (once the page view has one).

## For other features (`apps/server/src/features/search/index.ts`)

- `registerSearchText(kind, (db, pageId) => Promise<string>)`: text for every page of that kind, one block per line. Databases registers `'row'` with the values the toolbar search uses, leaving out properties with access rules (hidden properties are never matched or shown).
- `reindexForSearch(db, pageIds)`: index pages again when something you own changes their text, such as a row's property values. Safe to call often.
- `registerSearchBoost(name, (db, { userId, workspaceId, pageIds }) => Promise<Map<pageId, { boost?, verified? }>>)`: ranking help. The Knowledge base marks ✓ Verified pages this way.
- `runSearch(db, { userId, workspaceId }, request)`: the same search as `POST /query`, with the same access checks; `request` is checked with `searchRequestSchema`. The assistant panel (Claude spec 3.3) passes `{ text: searchWords(question).join(' '), match: 'any' }`: `searchWords` from `@carehub/extras/search` keeps up to 12 words of the question, without common words (`COMMON_WORDS`), repeats or punctuation, and with IDs like "QA-17" whole.

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
