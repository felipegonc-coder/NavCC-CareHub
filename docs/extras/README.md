# Extras lane

The Notion-parity features nobody else owns: search, page history, templates and buttons, import and export, knowledge base extras and Claude. Lead: the Extras lead. Ownership, folders and contracts: [decision 0400](../decisions/0400-extras-lane.md).

| Feature                             | Spec                                                                      | Server and web folders    | Package                         | Tables      | Branches                                       |
| ----------------------------------- | ------------------------------------------------------------------------- | ------------------------- | ------------------------------- | ----------- | ---------------------------------------------- |
| Search, with the Ctrl+K window      | [search.md](../plan/specs/search.md) (SR)                                 | `features/search/`        | `@carehub/extras/search`        | `search_*`  | `feat/extras-search-*`                         |
| History: versions, Updates, Archive | [page-history-and-trash.md](../plan/specs/page-history-and-trash.md) (HT) | `features/history/`       | `@carehub/extras/history`       | `history_*` | `feat/extras-history-*`                        |
| Templates and the "/button" block   | [templates-and-buttons.md](../plan/specs/templates-and-buttons.md) (TB)   | `features/templates/`     | `@carehub/extras/templates`     | `tpl_*`     | `feat/extras-templates-*`                      |
| Import and export, Print and PDF    | [import-and-export.md](../plan/specs/import-and-export.md) (IE)           | `features/import-export/` | `@carehub/extras/import-export` | `ie_*`      | `feat/extras-import-*`, `feat/extras-export-*` |
| Knowledge base extras               | [knowledge-base.md](../plan/specs/knowledge-base.md) (KB)                 | `features/knowledge/`     | `@carehub/extras/knowledge`     | `kb_*`      | `feat/extras-kb-*`                             |
| Claude, switched off by default     | [claude.md](claude.md) (CL)                                               | `features/claude/`        | `@carehub/extras/claude`        | `claude_*`  | `feat/extras-claude-*`                         |

Folders are `apps/server/src/features/<f>/` and `apps/web/src/features/<f>/`. The lane also owns `packages/extras/`, `packages/editor/src/lanes/extras.ts` and `lanes/claude.ts`, `tests/e2e/extras/` and `docs/extras/`. Migrations are `YYYYMMDDHHMM_<f>_<what>.sql` in `apps/server/migrations/`, and decisions are numbered 0400–0499. The Notion specs win when they differ from the copies in `docs/plan/specs/`.

Not ours: Trash, its nightly purge and archiving's page columns (core, pages PR 2), database templates and the Button property (Databases), the Claude field type and cell (Databases, phase 5), and Learning's Claude help (Learning, which calls our client).

## Registration (all on main)

Each feature already has its lines in `app.ts`, `seed.ts`, `routes.tsx` and `slots.ts`, pointing at the empty `routes.ts`, `seed.ts`, `routes.tsx` and `slots.ts` in its folder. Fill those in; never edit the shared files. Screens go in `tests/e2e/extras/screens.ts` with names starting `extras-`. Editor blocks go in `packages/editor/src/lanes/extras.ts` (Claude's in `lanes/claude.ts`): schema only, and node and attribute names never change once they're on main.

Two slots are ours. The app shell renders each `overlays` entry (`{ id, Component }`) once, which is where the Ctrl+K window and the assistant panel go. The page view renders `pageBanners` (`{ id, order, Component<{ page }> }`) above the title, for Archived, Template and knowledge base status. Search owns Ctrl+K: the shell binds nothing, and the window lists `slots.commands` as Actions.

## What each feature offers other lanes

Server functions are exported from `apps/server/src/features/<f>/index.ts`.

- **Search:** `registerSearchText(kind, (db, pageId) => Promise<string>)` (0007, section 4.3; Databases registers `'row'` without properties that have access rules). `listSearchTerms(db, workspaceId, { from, to })` gives the counted search words for Team tools' Analytics, without who searched.
- **Claude:** see [claude.md](claude.md). It covers `askClaude`, `askClaudeJson`, `isClaudeFeatureOn`, `ClaudeError`, `summarizeMeeting` (Meetings) and `fillClaudeFields` (Databases, once its field type lands).
- **Import and export:** importers the main lead can use for go-live.

## What we build on

These follow the 0007 names. Until one is on main, build against a stand-in in your own folder that **denies by default**, marked `// stand-in: <what replaces it>`; see `apps/server/src/features/comments/pages.ts` for the pattern.

- **Pages** (`features/pages/index.ts`, #49): `getPageAccess`, `getAccessForPages`, `app.requirePageAccess`, `createPage`, `setPageTitle`, `trashPage`, `restorePage`, `getPrivateSpaceId`, `getPagePreviews` and `getPageCards`, plus events `page.created`, `page.updated`, `page.trashed`, `page.restored`, `page.deleted` and `access.changed`. Pages PR 2 adds `listSubtree`, `archived_at` and `archived_by`, `archivePage` and `unarchivePage`, and a tree that hides archived pages.
- **Content** (`features/collab/index.ts`): `getPageMarkdown`, `getPageText`, `setPageContentFromMarkdown` and `copyPageContent`. S4 adds the event `page.contentSaved { pageId, userIds }` and `getPageContent` and `setPageContent`; until then, poll `page_docs.text_updated_at`. Markdown is parsed through #198's markdown-it with HTML off.
- **Workspace settings:** `getWorkspaceSetting` and `setWorkspaceSetting` (S1's accounts 1c), with keys `<feature>.<name>`.
- **Security log** (stand-in until core builds it with Settings and members): `logSecurityEvent(tx, { workspaceId, actorId, action, targetId?, details? })`.
- **Files, jobs, notices, live:** 0007, sections 4.3 and 4.4. These are `getFiles`, `registerFileScope` and `uploadFile`; `registerJobHandler`, `scheduleJob` and `registerPeriodicTask`; `sendNotice`; and `publishToUsers` and `publishTopic`.
- **Databases** (`features/databases/api.ts`):
  - `readRowText(db, { userId, rowId, propertyIds })`, `createRow`, `updateRows`, `createRows(tx, { databaseId, rows, actorUserId, source: 'import' })` and `exportViewCsv(db, { userId, databaseId, viewId })`.
  - `createDatabase(tx, definition)` and `duplicateDatabase(tx, { databaseId, parentId, includeRows, by })`.
  - Knowledge base: `wiki: boolean` on DatabaseMeta (false unless set; `createDatabase` takes `wiki: true`, and only people with full access change it). Drafts (KB-03) use `registerRowAccessLimiter('wiki', limiter)` (decision 0200, #238), called once at startup. `limiter({ databaseId, row: { id, values, createdBy }, properties, userId, level })` returns an access level. It's synchronous with no I/O and can only lower `level`. It runs after the row rules on wiki databases, so drafts are hidden in views, counts, search, links, mentions, backlinks and notices, and direct requests get a 403. We decide what Draft, Published and owner mean (the owner's Person value is in `row.values`); an editor is `level` edit or higher.
  - Packages: `@carehub/databases/buttons`, `/templates`, `/csv`, and `/xlsx` (after the #212 fix).
  - The rows builder W2-2 owns the server functions.

## Rules every Extras PR follows

- **Clean room:** written from the specs and this repo only, with fictional data and no secrets. The PR description has the line `Written from the spec. No code copied from AppFlowy or the old Care Hub.`
- **Basic first:** a working version of every check before polishing any one. PRs stay under about 600 lines of non-test code.
- **Look:** design-kit tokens and components only, with no one-off values; the lint rule is an error in our folders. Screens follow 0007, section 5.1: states, phone layout, keyboard and screen readers.
- **Server:** every request checks permissions on the server, input is validated with zod, and nothing that can't be opened leaks through titles, counts or previews (use `getAccessForPages`).
- **No new packages and no `.github/` changes** without the Extras lead, who asks the security reviewer.
- **Importers:** see [import-export.md](import-export.md#safety). Total output is capped counting every repeat, each import runs in a worker with memory and time limits, and ZIP and XML are read with #109's reader.
- **CI minutes:** keep PRs as drafts while working and mark them ready when CI is wanted. Push once per round of fixes, merge `main` only on a conflict, and run browser tests at most once per PR.
