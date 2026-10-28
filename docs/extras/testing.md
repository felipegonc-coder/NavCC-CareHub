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

_Filled in by the knowledge base PRs._

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

### Writing help (Ask Claude)

- **Turning it on:** an Admin ticks "Approved for this workspace" and switches on "Writing help in pages" in Settings → Claude (`/settings/claude`). Within 5 seconds the entry points appear for people with Use Claude who can edit the page; with the switch off there are none (CL-01, CL-04, CL-05).
- **Entry points, in a page (`/p/<id>`):** the "Ask Claude" button in the selection toolbar, "Ask Claude" in the "/" menu (under Actions), and Ctrl+J (⌘J on a Mac).
- **The menu:** a dialog named "Ask Claude" holding a menu named "Ask Claude".
  - Menu items: "Improve writing", "Fix grammar", "Change tone", "Make shorter", "Simplify", "Continue writing", "Summarize", "Draft".
  - "Change tone" opens a menu named "Change tone": "Professional", "Friendly", "Direct", "Empathetic".
  - "Draft" shows the textbox "What should Claude write?" with the buttons "Write" and "Back". Enter sends.
  - The rewriting actions on an empty line say "Select some text first."
- **The result box**, in the same dialog:
  - First "Claude is writing…" with the button "Stop".
  - Then the region "Claude's answer" with the buttons "Replace", "Insert below", "Try again" and "Discard". Draft and Continue writing have no Replace.
  - If the selected words change meanwhile, Replace is gone and "The text changed while Claude was writing." shows (CL-08).
  - Screen readers hear it through the page's `status` region: "Claude is writing", then the answer.
- **Nothing changes until Replace or Insert below (CL-06):** Stop, Discard and Esc leave the page as it was. After Replace or Insert below, one Ctrl+Z (⌘Z) undoes it.
- **Errors (CL-16, CL-17):** a selection containing `STUB-429` or `STUB-500` shows "Claude isn't available right now." with "Try again". `STUB-SLOW` shows the same after 60 seconds at most. Over 10,000 selected characters: "Select less text. Claude can work on up to 10,000 characters at a time."
- **Endpoints (under `/api/claude`, Use Claude and Can edit on the page, else 403 "You don't have access to this."):**
  - `POST /write` with `{ pageId, action, tone?, selection, at?, prompt? }` answers `{ text }` (Markdown).
  - `POST /write/applied` with `{ pageId, action, placement }` answers 204, for page history's "(with Claude)".
- **Screens:** none in `tests/e2e/extras/screens.ts` yet. Writing help can only be on once the stub's environment lines are in the browser-test workflow.
