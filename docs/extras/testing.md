# Extras: notes for browser tests

## Who writes what

- The Testing lead's builders write the acceptance tests in `tests/e2e/flows/<area>/` (`search`, `history-trash`, `templates`, `import-export`, `knowledge-base`, `claude`), with titles starting with the spec ID ("SR-01 …").
- Extras builders add each screen to `tests/e2e/extras/screens.ts` (names start `extras-`).
- Extras builders keep this file current: routes, endpoints, the names of key controls, and test hooks.
- The Extras lead tells the Testing lead when each area lands on main, so its line in `tests/e2e/flows/_support/features.ts` can be turned on.

## Selectors and data

- Roles and labels first (`getByRole`, `getByLabel`). Use `data-testid="<feature>-<thing>"` only where a role or label can't do the job.
- Use fictional data from each feature's `seed.ts`, which is safe to run twice.

## Search

Routes, endpoints, controls: _filled in by the search PRs._

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
- **The stub:** `tests/e2e/extras/claude-stub.ts`, from the Claude PRs.
  - Start it with `startClaudeStub({ port })`, which returns `{ url, requests(), clear(), close() }`, or as a process with `node tests/e2e/extras/claude-stub.ts` (port from `CLAUDE_STUB_PORT`, default 4599).
  - `POST /v1/messages` answers with canned, predictable text.
  - A selection containing `STUB-429`, `STUB-500` or `STUB-SLOW` makes it answer 429, 500, or after 35 s.
  - `GET /__requests` returns every recorded request: time, path, body, and headers with the key replaced by `"<present>"`.
  - `DELETE /__requests` clears them.
- **CL-01:** with the switches off, `GET /__requests` stays empty whatever the test does.
- **CL-10 (leak test):** the fictional key must never appear in the server output, any API answer, any page or the web bundle.

The browser-test workflow needs these two environment lines. They go in `.github/`, outside this change.

### Writing help (CL-06 to CL-08)

- `POST /api/claude/write` with `{ pageId, action, tone?, selection, at?, prompt? }` answers `{ text }` in Markdown.
  - Actions: `improve`, `fix_grammar`, `change_tone` (with `tone`: `professional`, `friendly`, `direct` or `empathetic`), `make_shorter`, `simplify`, `continue`, `summarize` and `draft` (with `prompt`).
  - `at` is where the selection starts in the page's text, so the server picks the right one when the words appear twice.
- What reaches the stub (CL-07):
  - The selection; for `continue`, the last 4,000 characters above the cursor.
  - The page title, with up to 2,000 characters of the page's text on each side of the selection, which the server reads itself.
  - For `summarize` with nothing selected, the whole page up to 40,000 characters; for `draft`, only the title and what was typed.
- Refusals: 403 without Use Claude or Can edit, 413 over 10,000 selected characters, and Claude's own reasons with `error.details.reason` ([claude.md](claude.md)).
- `POST /api/claude/write/applied` with `{ pageId, action, placement }` follows Replace or Insert below. Page history reads its `claude.write.applied` event to show "(with Claude)".
