# Testing lane: cross-area browser tests

The Testing lane proves what works, the way a person would use it: Playwright flows that click
through Care Hub in a real browser, written from the specs and their "Done means" checklists. The
results go to the Notion page **Care Hub test results** (under Specs), which says, for every
feature or check, Passing, Failing, Not built yet or Not tested yet, with the date of the last run.

Lanes keep their own screen and logic tests (`tests/e2e/<lane>/`, Vitest in their packages). This
lane adds the flows that a spec's acceptance checks describe, and the flows that cross areas, for
example: create a page, share it, comment with a mention, and the person gets a notice.

## Folders

| Path                        | What                              | Who changes it        |
| --------------------------- | --------------------------------- | --------------------- |
| `tests/e2e/flows/<area>/`   | The flows of one area, `*.e2e.ts` | Testing lane builders |
| `tests/e2e/flows/_support/` | Shared helpers (below)            | Testing lead          |
| `docs/testing/`             | These notes                       | Testing lead          |

Areas: `design-kit`, `shell` (top bar, phone menu, Not found), `accounts`, `pages`, `editor`,
`sidebar`, `search`, `comments`, `sharing`, `history-trash`, `templates`, `import-export`,
`settings`, `databases`, `formulas`, `forms`, `messages`, `home`, `calendar`, `meetings`,
`automations`, `analytics`, `status`, `knowledge-base`, `data-settings`, `learning` and `cross`
(flows across several areas).

Never edit `tests/e2e/helpers/`, `tests/e2e/screens.ts`, the config or a lane's own folder (such as
`tests/e2e/team/`): ask its owner. Page objects for one area live in that area's folder
(`tests/e2e/flows/editor/editor-page.ts`); ask the Testing lead to move one into `_support/` when a
second area needs it.

## Writing a flow

```ts
import { expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';

test.describe('Comments and mentions', () => {
  onlyIn('desktop-light');
  needs('signIn', 'pages', 'comments', 'notices');

  test('CM-03 a mention in a comment sends the person a notice', async ({ browser }) => {
    // ...
  });
});
```

- **Import** `test` and `expect` from `../_support/index.js`, never from `@playwright/test`.
- **Titles start with the check ID** from the spec or its "Done means" list (`DB-12`, `FM-04`), or
  a Testing lane ID for checks without one (`DK-01` design kit, `SH-01` app shell, `FLOW-01`
  cross-area flows; a new flow takes the next free number, from `FLOW-09`). One test per check; use
  `test.step()` for the steps. The ID is how a result reaches the results page: an ID the page
  doesn't list yet gets its own row after the first run.
- **Projects:** `onlyIn('desktop-light')` by default. Add `phone-light` for phone checks (layout,
  bottom sheets, 44 px touch targets) and the dark projects only for dark-mode checks. The screen
  checks in `tests/e2e/screens.ts` already cover axe and screenshots in all four.
- **Not built yet:** `needs(...)` names the features a flow depends on, from
  [`_support/features.ts`](../../tests/e2e/flows/_support/features.ts). Until each one is on
  `main`, the tests are skipped as `fixme` and reported as "Not built yet". Turn a feature's line
  on in the pull request whose tests match that feature on `main`, and say so in the description;
  the Testing lead runs that pull request's browser tests before merging it. If a flow needs a
  feature that has no line yet, ask the Testing lead to add one rather than borrowing a nearby one.
- **Selectors:** what a person sees: `getByRole`, `getByLabel`, `getByText`, with the names from
  the spec. Never Tailwind classes or DOM structure. Use a `data-testid` only if the screen has one.
- **Waiting:** web-first assertions (`await expect(locator).toBeVisible()`). No
  `waitForTimeout`, except to prove a time rule from the spec (a skeleton after 300 ms, an Undo toast
  for 8 seconds, live changes within 2 seconds).
- **Data:** fictional only. Sign in as the seeded people (`people`, `signInAs`); make everything
  else inside the test, through the screens or with `apiFor(page)`, and name it with
  `uniqueName('Fictional QA page')`. Never depend on another test's data or on an empty database.
- **Permissions:** every spec has a check where a direct request must be refused. Do it with
  `(await apiFor(page)).send('PATCH', path, body)` and expect `403` and the plain error message.
- **Dates and times:** people see them in their time zone (America/Denver by default):
  `shownDate()` and `shownTime()` format them the way the specs say ("Oct 26, 2026", "3:30 PM").
- **Secrets:** none. The seed password comes from `process.env.CAREHUB_SEED_PASSWORD` in CI.

## Shared helpers (`tests/e2e/flows/_support/`)

| Helper                               | What it does                                                  |
| ------------------------------------ | ------------------------------------------------------------- |
| `test`, `expect`                     | The test and assertions every flow uses                       |
| `onlyIn(...projects)`                | Runs the block only in those projects                         |
| `needs(...features)`, `onMain`       | "Not built yet" until the features are on `main`              |
| `people`, `signInAs(page, who)`      | The seeded fictional people; signs in through the core helper |
| `lanePeople`                         | People from a lane's seed (Tara Trainer); sign in by email    |
| `apiFor(page)`                       | API calls as the signed-in person, with the CSRF header       |
| `uniqueName(label)`                  | A unique fictional name for this run                          |
| `shownDate(date)`, `shownTime(date)` | Dates and times as the app shows them                         |

## Running them

Agent computers have no network, so the app can't run there. Browser tests run on GitHub Actions.
While the repository is public, runs don't use Actions minutes, so there's no daily budget. The
Free plan still runs at most 20 jobs at a time for every team together, so group the runs:

- The nightly run on `main` (01:00 UTC) runs everything; the results page is updated from it.
- The Testing lead adds the label `e2e` to a pull request on its final head (once more after fixes,
  if needed). It runs only the files the pull request changes. Builders don't add the label.
- On an agent computer, Playwright and Chromium are preinstalled, so a builder can still run pure
  logic checks and check that a file loads (`playwright test --list`) before pushing.

## Reporting a bug

When a flow finds a bug, open a GitHub issue labelled `bug` and the lane (`core`, `learning`,
`databases`, `team` or `extras`), titled `<check ID>: <what goes wrong>` (Extras titles start with
"Extras: "), with:

1. **Test:** the file and the test title, and the link to the failing run.
2. **Steps:** what the test does, as a person would do it.
3. **Expected:** what the spec says, with the spec and section.
4. **Actual:** what happened, with the error and a screenshot if there is one.

The Testing lead messages the owning lead about any bug that blocks a feature.
