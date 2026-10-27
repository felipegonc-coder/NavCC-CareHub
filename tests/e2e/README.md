# Browser tests

Playwright with Chromium. Every screen in [`screens.ts`](screens.ts) is opened in four projects:
`desktop-light`, `desktop-dark` (1280×800) and `phone-light`, `phone-dark` (390×844, mobile
emulation). For each one the test

- saves a full-page screenshot as `screenshots/<screen>-<project>.png`,
- checks that the page loads without uncaught errors, has exactly one `<main>` and a title that
  starts with "Care Hub",
- runs axe with the WCAG 2.1 A and AA rules (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`) and
  expects no violations.

[`health.api.e2e.ts`](health.api.e2e.ts) checks that `GET /api/health` answers `status: "ok"`
(once, in `desktop-light`). Fix accessibility problems in the markup; do not turn axe rules off
without asking the lead.

## Add a screen

Each lane lists its screens in its own file, which [`screens.ts`](screens.ts) already includes,
so pull requests of different lanes never edit the same lines:

| Lane      | File                                           | Screen names start with |
| --------- | ---------------------------------------------- | ----------------------- |
| learning  | [`learning/screens.ts`](learning/screens.ts)   | `learning-`             |
| databases | [`databases/screens.ts`](databases/screens.ts) | `databases-`            |
| forms     | [`forms/screens.ts`](forms/screens.ts)         | `forms-`                |
| team      | [`team/screens.ts`](team/screens.ts)           | `team-`                 |

```ts
import type { Screen } from '../screens.js';

export const screens: Screen[] = [
  { name: 'learning-courses', path: '/learning' },
  {
    name: 'learning-course-editor',
    path: '/learning/courses/new',
    // Runs after the page has loaded and before the checks: sign in, open a dialog, fill a form.
    setup: async (page) => {
      await page.getByLabel('Title').fill('Fictional first aid course');
    },
  },
];
```

Names are unique and kebab-case; they are used in the test titles and the screenshot names. The
core screens (`home`) stay in `screens.ts`. `npm test --workspace tests/e2e` checks the lists
without a browser. Use fictional data only. In CI the database is seeded first (see below); the
seeded accounts use the password in `process.env.CAREHUB_SEED_PASSWORD`, which CI makes up anew
for each run. Nothing has a default for it, so set it yourself when you run them locally.

## Run them in CI

Browser tests cost CI minutes, so they do not run on every push
([`.github/workflows/e2e.yml`](../../.github/workflows/e2e.yml)):

1. When the quick checks pass and your screens are ready, add the label `e2e` to your pull
   request, for example with the GitHub tool `issue_write` (method `update`, `labels`). `labels`
   replaces the whole list, so keep the labels the pull request already has.
2. Each time the label is added, one run starts. To run again, remove the label and add it again.
   **At most 2 runs per pull request** without asking the lead first.
3. The run writes one comment on the pull request, separate from the quick checks' comment, and
   updates it on later runs. Its first line, "✅ Browser tests passed" or "❌ Browser tests
   failed on <commit>", comes from GitHub: go by that line. Below it is the test job's report
   (the counts, the failed checks, on failure the end of the failed step's log, for the tests
   also the end of the server output), then a table with the screenshots (linked to full size).
   On failure the Playwright report is also uploaded as the artifact `playwright-report`.
4. Put the result and the link to that comment in your pull request description, for example
   `Browser tests: passed (run 1 of 2), screenshots: <link to the comment>`.

The runs use GitHub's Ubuntu runner. Pull requests from forks never run them.

When every file a pull request changes is in `tests/e2e/flows/` or `docs/testing/`, the run uses
`--only-changed=origin/<base branch>`: only the test files that changed, or that import a changed
file, run (none for a docs-only change). Any other changed file means the full run.

### What a run does

Two jobs, so that no code from a pull request or its dependencies gets a token that can write
(decision 0011):

- **Browser tests** has a read-only token and does not keep it after the checkout. It installs
  with `npm ci --ignore-scripts` (`npm install --ignore-scripts` when `package-lock.json` is out
  of date), starts PostgreSQL from the npm package `embedded-postgres`
  ([`ci/postgres.mjs`](ci/postgres.mjs)), builds, runs `node apps/server/dist/cli.js seed` (once
  the server has that command) with a new random `CAREHUB_SEED_PASSWORD`, starts the server on port 38080 with `NODE_ENV=production` and
  `CAREHUB_PUBLIC_URL` set to that address, installs Chromium and runs the tests. npm,
  Playwright, the database and temporary files stay in `$RUNNER_TEMP`, and the server and
  PostgreSQL are stopped even when a step fails. The report, the screenshots and Playwright's
  `test-results/results.json` are uploaded as the artifact `e2e-results` (kept 7 days).
- **Publish the results** always runs on GitHub's Ubuntu runner and is the only job that can
  write. It checks out nothing and runs no npm: it downloads `e2e-results`, checks the file names
  and sizes, pushes the screenshots and `results.json` (every test's status) to the branch
  `ci-screenshots`, one folder per pull request (`pr-12/`, and `main/` for the nightly run), and
  writes the comment: the result line from the test job's result, then the uploaded report. That branch has a single commit and is rewritten on every
  run; do not base work on it.

The workflow also runs every night at 01:00 UTC on `main` when `main` had a commit in the last
24 hours, and can be started by hand (Actions → Browser tests → Run workflow). A failing nightly
run opens the issue "Nightly browser tests failing" or comments on it; a passing one closes it.

## Run them on your machine

```sh
npx playwright install chromium     # once per Playwright version
npm run build                       # the tests start apps/server/dist/index.js on a free port
npm run e2e                         # fewer: npm run e2e -w tests/e2e -- --project phone-dark -g home
```

The server needs PostgreSQL in `DATABASE_URL`; the tests start it with `NODE_ENV=production` and
`CAREHUB_PUBLIC_URL` set to its address, as in CI. To test a server that is already running (for
example one with a seeded database), set its address: `E2E_BASE_URL=http://localhost:3000`. A
throwaway database like the one in CI:

```sh
export DATABASE_URL=postgres://carehub@127.0.0.1:55432/carehub
node tests/e2e/ci/postgres.mjs start /tmp/carehub-postgres   # and later: stop /tmp/carehub-postgres
```

The screenshots end up in `tests/e2e/screenshots/`, the HTML report in
`tests/e2e/playwright-report/` (both ignored by git).
