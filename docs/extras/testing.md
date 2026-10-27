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

How search works and what's still a stand-in: [search.md](search.md).

- **Until the page model (#49) and accounts 1b (#55) are on main, search finds nothing:** its stand-ins deny by default, so leave `search` off in `tests/e2e/flows/_support/features.ts` until then.
- **Endpoint:** `POST /api/search/query` with `{ text, filters?, sort?, match?, cursor?, limit? }` answers `{ results, total, nextCursor }`. Share-link visitors and people outside the workspace get 403 "You don't have access to this."
- **Timing:** a new, renamed, moved, trashed or archived page is searchable (or hidden) at once; text typed into a page is searchable within about 2 seconds. Wait for the result to show (`expect(…).toBeVisible()`), not for a fixed time.
- **Archived pages** are left out unless the Archived filter (`includeArchived`) is on.
- **Data:** search shows what the seed's pages hold; it has no seed data of its own.

## History (versions, Updates, Archive)

- **Version history:** page menu → "Version history", Ctrl+Alt+H on a page, or open `/p/<pageId>?version=<versionId>`. It's a dialog named "Version history", described by the page title. Inside:
  - the listbox "Versions", with one group per day (named "Today", "Yesterday", "Oct 20") and options such as "Today, 3:12 PM · Avery Lin, Sam Ortiz" (a named version starts with its name);
  - the region "Version preview", with the switch "Show changes" (on) and the button "Copy link";
  - the button "Show older versions" when there are more;
  - on phones, a tap on an option shows the preview, and the button "Versions" goes back.
- **Endpoints:** `GET /api/history/pages/:pageId/versions?before=` and `GET /api/history/pages/:pageId/versions/:versionId`. Live topic `history:<pageId>`: `history.versions`, `history.restored`.
- **Screens:** none in `tests/e2e/extras/screens.ts` yet; Version history opens from a page, so its screens come once the page view (#49) and seeded versions are on main.

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

The two environment lines for the browser-test workflow are a `.github/` change, so the main lead adds them after the security reviewer's OK.
