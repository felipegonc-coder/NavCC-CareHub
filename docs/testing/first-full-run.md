# First full run once CI runs again

Since Oct 27, 2026, pull requests have been merged without CI (decision 0006). They're listed in three places: core merges in `docs/STATUS.md`, each lane's merges in that lane's own list ("Merged without CI (tests not run)"), and QA merges in [Merged without CI](merged-without-ci.md). The first run on main checks all of them at once. It's the safety net for everything merged this way, so it comes before anything else.

## When

Runs start again when the repository is public (public repositories don't use Actions minutes), or when the minutes reset on Nov 1, 2026. Times here are UTC. Denver is 6 hours behind until 2:00 AM on Nov 1, then 7.

- **CI** (`ci.yml`) checks main every 3 hours, at 00:23, 03:23 and so on. Anyone with access to the Actions tab can also start it at once with Run workflow.
- **Browser tests** (`e2e.yml`) run on main every night at 01:00 if main has a commit from the last 24 hours, or by hand with Run workflow. A pull request with the `e2e` label that changes only `tests/e2e/flows/` or `docs/testing/` runs only its changed tests, so it can't stand in for the full run.
- **No daily budget** while runs are free, but the Free plan runs at most 20 jobs at a time for every team together. Group the runs: one push per round of fixes, and the `e2e` label only on a final head.

## Steps

1. **Hold, from the moment runs start again.** Until step 3's CI run has reported (at most about 3 hours), nobody adds an `e2e` label or merges anything except step 2's commit, and pushes to open pull requests wait unless they fix something. Every push starts a run of its own, and runs queue behind the 20-job limit. Holding them lets main's run go first and keeps each failure easy to trace.
2. **Make sure main gets checked.** A scheduled CI run skips main when an earlier run on the same commit has finished, and runs that failed for lack of minutes may count. So the first agent on after runs start again merges one commit to `docs/testing/` ("First full run started", with the time). That puts main on a commit no run has seen. A run started by hand doesn't need this.
3. **CI on main, at the next :23.** This runs the type check, lint, and every unit, route, database and screen test (`npm run test` in all workspaces, with Postgres), then the license check, the audit and the secret scan. If anything fails, the run opens the issue "Main checks failing" with the end of each failed step's log.
4. **Browser tests on main, once its CI passes:** the next 01:00 run, or Run workflow by hand. This runs every e2e check. Checks whose features are still `false` in `tests/e2e/flows/_support/features.ts` report "Not built yet". All the others must pass.
5. **Triage (Testing lead, within 30 minutes of each report).** For each failure:
   - find the pull request that brought the code in, using the three lists and then `git log` on the failing file;
   - open an issue labelled `bug` plus the lane (`core`, `learning`, `databases`, `team` or `extras`; Extras titles start with "Extras:"), with the failing test, the steps, and the expected and actual results;
   - message the owner.
6. **Fix within the hour, or revert.** The owner has one hour from the message to merge a fix. Otherwise the main lead reverts the pull request. If a browser check is wrong rather than the product, its builder fixes it in the same hour or marks it `test.fixme` with the issue number.
7. **Check again after the fixes.** For CI, run it by hand or wait for the next :23. For browser tests, add the `e2e` label to the fix pull request (one run, on its final head) or wait for the next 01:00.
8. **Back to normal once main's CI passes.** Open pull requests get their usual runs again on their next push.
9. **Results.** Each nightly run puts Playwright's `results.json` on the `ci-screenshots` branch, in `main/`. After the first full run, the Testing lead updates the Notion database "Care Hub test results" from it (one row per check), and then again after every nightly.

## Risks

- The CI checks job has 10 minutes. A full `npm run test` on main may need more than that. If it does, the issue says that no step failed, and the main lead decides whether to raise the limit.
- The browser-test job has 15 minutes on main today. #369 raises that to 25, with a 20-minute test budget at night.
- Runs queue when 20 jobs are already running, so a run may start later than its time.
