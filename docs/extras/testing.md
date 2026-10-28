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
  - Before typing it says "Type to search pages, databases and rows." (The "Recent" and "Recent searches" groups come in a later part.)
  - Each result is an option named "<title>, page in <space> › <parent>, edited <day>" (database and row for the other kinds). The first is selected (`aria-selected`). ↑ and ↓ move, Enter opens `/p/<id>`, Ctrl+Enter opens it in a new tab and Esc closes.
  - Other features' commands that match come first, under "Actions".
  - When nothing matches: "No results for ‘<text>’." When the API fails: "Search isn't working right now." with **Try again**. Offline: "You're offline. Search works again once you're back online." A status region says "<n> results" or "No results".
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
  - A selection containing `STUB-429`, `STUB-500` or `STUB-SLOW` makes it answer 429, 500, or after 65 s, longer than the 60 s the server waits. The server tries 429 and 500 twice more, so expect three recorded requests.
  - Without an `x-api-key` header it answers 401, and without `anthropic-version` it answers 400.
  - `GET /__requests` returns every recorded request: time, path, body, and headers with the key replaced by `"<present>"`.
  - `DELETE /__requests` clears them.
- **CL-01:** with the switches off, `GET /__requests` stays empty whatever the test does.
- **CL-02 (key leak test):** the fictional key must never appear in the server output, any API answer, any page, an export or the web bundle. Settings → Claude shows only "Key set".
- **CL-03 (Settings → Claude, `/settings/claude`):**
  - Without `ANTHROPIC_API_KEY` it says "No key. Add it to the server's settings file, then restart Care Hub.", and the switches are disabled. A direct `PUT /api/claude/settings` that turns one on answers 409.
  - The switches (role `switch`) are named "Writing help", "Assistant", "Claude fields", "Meeting summary" and "Learning help". Turning one on opens the dialog "Turn on Writing help?" (and so on). Its "Turn on" button stays disabled until its checkbox, "Approved for this workspace" (`CLAUDE_CONFIRM_LABEL` from `@carehub/extras/claude`), is ticked; "Cancel" leaves the switch off. Turning a switch off saves at once.
  - The "Monthly limit" box (role `spinbutton`) saves on Enter or when it loses focus.
- **CL-16:** set the "Monthly limit" to 1 instead of making 3,000 requests. Each person's limit is 60 requests an hour.

The two environment lines go in the browser-test workflow (`.github/`), on the e2e server step only, with the fictional key.
