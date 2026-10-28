# Extras: notes for browser tests

## Where things go

- Acceptance tests are in `tests/e2e/flows/<area>/` (`search`, `history-trash`, `templates`, `import-export`, `knowledge-base`, `claude`), with titles starting with the spec ID ("SR-01 …").
- Each screen is listed in `tests/e2e/extras/screens.ts` (names start `extras-`).
- This file lists the routes, endpoints, names of key controls and test hooks.
- `tests/e2e/flows/_support/features.ts` has one line per area; an area's tests run when its line is on.

## Selectors and data

- Roles and labels first (`getByRole`, `getByLabel`). Use `data-testid="<feature>-<thing>"` only where a role or label can't do the job.
- Use fictional data from each feature's `seed.ts`, which is safe to run twice.

## Search

How search works and what's still a stand-in: [search.md](search.md).

- **Search finds nothing without the page model (#49) and accounts 1b (#55):** its stand-ins deny by default, so `search` stays off in `tests/e2e/flows/_support/features.ts` without them.
- **Endpoint:** `POST /api/search/query` with `{ text, filters?, sort?, match?, cursor?, limit? }` answers `{ results, total, nextCursor }`. Share-link visitors and people outside the workspace get 403 "You don't have access to this."
- **The window:** Ctrl+K or Ctrl+P (`ControlOrMeta`) on any screen, or **Search** at the top of the sidebar, opens the dialog named "Search". Its box is the combobox named "Search" and has the focus.
  - Before typing: the group "Recent" (the last 8 pages opened, newest first, options named like results) and the group "Recent searches" (the last 5, each option named by its text, with the button **Clear** in the group). With neither it says "Type to search pages, databases and rows." Opening `/p/<id>` counts as a visit straight away.
  - Each result is an option named "<title>, page in <space> › <parent>, edited <day>" (database and row for the other kinds). The first is selected (`aria-selected`). ↑ and ↓ move, Enter opens `/p/<id>`, Ctrl+Enter opens it in a new tab and Esc closes.
  - Other features' commands that match come first, under "Actions".
  - **Filters** are buttons under the box: "Title only" and "Include archived" turn on and off (`aria-pressed`). "In", "Created by", "Edited by" and "Date" each open a small panel, and when something is picked the button is named "In: <title>", "Edited by: <name>" or "Date: Edited, last 7 days". In, Created by and Edited by put the focus in a box ("Find a page", "Find a person"); typing lists options named "<title>, <path>" or "<name>", and clicking one picks it. The list stays open for more; Esc closes only the list. "Type" is a menu of `menuitemcheckbox` (Pages, Databases, Rows, Files). Sort is the button named "Sort: Best match", a menu of `menuitemradio` ("Best match", "Edited, newest first", "Edited, oldest first", "Created, newest first", "Created, oldest first"). **Clear filters** shows when a filter is on, and under No results too.
  - When nothing matches: "No results for ‘<text>’.", then "Did you mean <text>?" with a button named the suggested text when a title is close, and the button **Search in Trash**, which goes to `/trash?q=<text>`. When the API fails: "Search isn't working right now." with **Try again**. Offline: "You're offline. Showing recent pages." A status region says "<n> results" or "No results".
- **Screens:** `extras-search` (the window before typing) and `extras-search-results` (after typing "Fictional refund steps").
- **Timing:** a new, renamed, moved, trashed or archived page is searchable (or hidden) at once; text typed into a page is searchable within about 2 seconds. Wait for the result to show (`expect(…).toBeVisible()`), not for a fixed time.
- **Archived pages** are left out unless the Archived filter (`includeArchived`) is on.
- **Data:** search shows what the seed's pages hold; it has no seed data of its own.

## History (versions, Updates, Archive)

_Filled in by the history PRs._

## Templates and buttons

_Filled in by the templates PRs._

## Import and export, Print and PDF

_Filled in by the import and export PRs._

## Knowledge base

How the knowledge base works: [the spec](../plan/specs/knowledge-base.md). Its server stand-ins deny by default until the page model and wiki databases are bound, so leave `knowledgeBase` off in `tests/e2e/flows/_support/features.ts` until then.

- **Verify:** `POST /api/knowledge/pages/:pageId/verification` with `{ period }` (`1w`, `30d`, `90d`, `6m`, `1y` or `none`) or `{ period: 'date', until: 'YYYY-MM-DD' }` answers the page's knowledge base info, with `verification: { state, verifiedBy: { id, name }, verifiedAt, until }`. Only the page's owners and people with Full access on the knowledge base can verify; anyone else gets 403. `DELETE` on the same path removes the verification.
- **Dates:** "until" is a day in the first owner's time zone. Normally it must be after today and at most ten years ahead, or the answer is 400 "Pick a date after today, up to ten years ahead."
- **Test hook, past dates:** only when the server runs with `CAREHUB_TEST_HOOKS=1` (browser-test servers, never production), `{ period: 'date', until }` also takes today and earlier days, so a test can make a page Expired without waiting for a real until date. Everything else stays the same: sign-in, CSRF, who may verify, the date format and the ten-year limit. The server logs a warning at start-up when the hook is on.
- **Expiry:** a task that runs every minute (`knowledge.expiry`) turns a verified page Expired once 9:00 AM has passed on its until day in the first owner's time zone. Then the badge turns orange, readers see "Verification expired on …", owners and editors see "Due for review since … · Review now", and the owners get the 🔔 notice for that day. For an Expired page at once, verify until yesterday, then wait up to 2 minutes, opening the page again until the banner shows. A page verified until today expires only after 9:00 AM in the owner's time zone.

## Claude

The tests never reach Claude. The server is pointed at a local stub:

- **Server environment:**
  - `ANTHROPIC_API_KEY`: any fictional value, for example `test-key-not-real`.
  - `ANTHROPIC_BASE_URL=http://127.0.0.1:4599`. The server accepts only loopback addresses here.
- **The stub:** `tests/e2e/extras/claude-stub.ts`.
  - Start it with `startClaudeStub({ port })`, which returns `{ url, requests(), clear(), answerNext(text), close() }` (`clear()` also drops queued answers), or as a process with `node tests/e2e/extras/claude-stub.ts` (port from `CLAUDE_STUB_PORT`, default 4599).
  - `POST /v1/messages` answers with canned, predictable text: `STUB_TEXT`, or `STUB_JSON` (a meeting summary) when the request asks for one JSON value.
  - To choose the next answer, call `answerNext(text)` or `POST /__answers` with `{ "text": "…" }`. Queued answers are used once, in order.
  - A selection containing `STUB-429`, `STUB-500` or `STUB-SLOW` makes it answer 429, 500, or after 35 s. The server tries 429 and 500 twice more, so expect three recorded requests.
  - Without an `x-api-key` header it answers 401, and without `anthropic-version` it answers 400.
  - `GET /__requests` returns every recorded request: time, path, body, and headers with the key replaced by `"<present>"`.
  - `DELETE /__requests` clears them.
- **CL-01:** with the switches off, `GET /__requests` stays empty whatever the test does.
- **CL-02:** the fictional key never appears in the server output, any API answer, any page, an export or the web bundle.

The two environment lines go in the browser-test workflow (`.github/`), on the e2e server step only, with the fictional key.
