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

## Run them in CI

Browser tests cost CI minutes, so they do not run on every push
([`.github/workflows/e2e.yml`](../../.github/workflows/e2e.yml)):

1. When your screens are ready, add the label `e2e` to your pull request, for example with the
   GitHub tool `issue_write` (method `update`, `labels`). `labels` replaces the whole list, so keep
   the labels the pull request already has.
2. Each time the label is added, one run starts. To run again, remove the label and add it again.
   **At most 2 runs per pull request** without asking the lead first.
3. The run writes one comment on the pull request and updates it on later runs: passed or failed,
   the failed checks, a table with the screenshots (linked to full size) and, on failure, the end
   of the logs. On failure the Playwright report is also uploaded as the artifact
   `playwright-report`.
4. Put the result and the link to that comment in your pull request description, for example
   `Browser tests: passed (run 1 of 2), screenshots: <link to the comment>`.

The screenshots are stored on the branch `ci-screenshots`, one folder per pull request (`pr-12/`).
That branch has a single commit and is rewritten on every run; do not base work on it.

The workflow also runs every night at 03:30 UTC on `main` when `main` had a commit in the last
24 hours, and can be started by hand (Actions → Browser tests → Run workflow). A failing nightly
run opens the issue "Nightly browser tests failing" or comments on it; a passing one closes it.

## Run them on your machine

```sh
npx playwright install chromium     # once per Playwright version
npm run build                       # the tests start apps/server/dist/index.js on a free port
npm run e2e                         # fewer: npm run e2e -w tests/e2e -- --project phone-dark -g home
```

To test a server that is already running, set its address: `E2E_BASE_URL=http://localhost:3000`.
The screenshots end up in `tests/e2e/screenshots/`, the HTML report in
`tests/e2e/playwright-report/` (both ignored by git).

## Add a screen

Add an entry to [`screens.ts`](screens.ts):

```ts
export const screens: Screen[] = [
  { name: 'home', path: '/' },
  {
    name: 'note-editor',
    path: '/notes/new',
    // Runs after the page has loaded and before the checks: sign in, open a dialog, fill a form.
    setup: async (page) => {
      await page.getByLabel('Title').fill('Fictional visit note');
    },
  },
];
```

`name` is unique and kebab-case; it is used in the test title and the screenshot names.
`npm test --workspace tests/e2e` checks the list without a browser. Use fictional data only.
