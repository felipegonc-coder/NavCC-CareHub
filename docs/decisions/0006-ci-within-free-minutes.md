# 0006: CI within GitHub's free minutes

- Status: accepted
- Date: 2026-10-26

## Context

The repository is private on GitHub Free, which includes 2,000 Actions minutes a month. There is no paid budget. Jobs are billed per job, rounded up to the whole minute. Agent computers have no network, so the app can't be installed or run on them; GitHub Actions is the only place the whole app runs.

## Decision

- Every pull request and every push to `main` run only the quick checks: install (cached), type check, lint, unit tests and the license check, in one job. Docs-only, Markdown-only, `deploy/`-only and workflow-only changes skip them. A newer push cancels the older run on the same branch.
- Browser tests (Playwright, axe, screenshots) run in `e2e.yml` only when a pull request gets the label `e2e`, every night on `main`, or by hand. At most 2 labelled runs per pull request without asking the lead.
- The Docker image is built and smoke-tested once a day on `main` (only if `main` changed), by hand, or when a pull request gets the label `image`.
- The lead estimates the minutes used from the check-run times and records them in `docs/STATUS.md`.
- If the minutes run out before the month ends, work continues: the lead reviews the code and the latest results by hand and merges anyway, then reruns the checks when minutes are back.

## Update 2026-10-26: Felipe's Mac as a self-hosted runner

> **Superseded 2026-10-27:** Felipe decided against a Mac runner (issue #7 closed), and decision 0011 keeps CI on GitHub-hosted runners. Every job runs on GitHub-hosted `ubuntu-latest`, and nothing below applies.

Felipe is adding a free self-hosted runner on his Mac (labels `self-hosted`, `macOS`, `ARM64`; Apple M2, 8 GB, one job at a time; it may sleep at night, and jobs then wait up to 24 hours).

- **Split:** once the Mac is online, the browser tests (`e2e.yml`: the `e2e` label, nightly, by hand) run on the Mac. The label `e2e-linux` runs the same tests on `ubuntu-latest` when the Mac is asleep and a result is needed now (costs minutes). The quick checks stay on `ubuntu-latest` until the free minutes get low, then move to the Mac in one small PR. `image.yml` always stays on `ubuntu-latest` (it needs Docker).
- **Postgres on the Mac:** macOS runners have no service containers, so the Mac jobs start Postgres with the `embedded-postgres` npm package (a dev dependency of `tests/e2e`; the license check must pass), with its data folder under `$RUNNER_TEMP`. Felipe installs nothing.
- **Security on the Mac** (jobs run as Felipe's user): no `pull_request_target`; no secrets beyond `GITHUB_TOKEN`, with minimal `permissions`; jobs only for pull requests from this repository; install with `npm ci --ignore-scripts` when the lockfile matches, otherwise `npm install --ignore-scripts`; nothing written outside the job folder, `$RUNNER_TEMP` and the tool cache (set `npm_config_cache` and `PLAYWRIGHT_BROWSERS_PATH` there); no global installs, no `sudo`, no background processes left behind. The security reviewer checks every workflow change that touches the Mac.
- **Screenshots** from the Mac and from Linux render fonts differently: they are never compared with each other. Each screenshot comment says which runner made it.
- Node comes from `actions/setup-node`; Playwright's Chromium has a mac-arm64 build.

## Update 2026-10-27: saving minutes

About 170 pull requests in the first 10 hours used most of October's 2,000 minutes. The root coordinator approved these savings; Felipe decides whether to add a paid Actions budget.

- Draft pull requests get no quick checks. Marking one ready for review starts its first run.
- `main` is checked every 3 hours and by hand instead of after every merge, and a scheduled run stops after a short gate job when `main` hasn't changed since a finished run, since each pull request was checked against `main` when it last changed. A failed run opens the issue "Main checks failing" with the end of each failed step's log; the next passing run closes it. On `main` the secret scan covers the whole history, so nothing merged between two runs is missed.
- A pull request that changes only lane folders runs only those lanes' unit tests (`scripts/ci-test-scope.mjs`). Anything else, including any `package.json`, migration or lane registration file, runs all of them. Type check, lint, license check, audit and secret scan always run in full.
- The `snapshot` branch is written every hour (when `main` has changed) instead of after every merge.
- What still runs when nothing changes: about 8 gate runs and 24 snapshot runs a day. GitHub rounds each job up to a whole minute, so that is about 32 minutes a day (about 1,000 a month). After the build week the snapshot can run less often.
- One push per pull request when it's ready, `main` merged in only for a conflict, and at most one `e2e` or `image` label run per pull request.
- Every job has a timeout of 15 minutes or less and runs on GitHub-hosted Linux.

If the minutes still run out, the last point of the decision applies: the lead reviews by hand and merges, smallest and safest pull requests first.

## Consequences

A broken build or a broken screen can reach `main` and is then caught by the nightly run instead of the pull request. The review helper adds `e2e` to every pull request that changes screens before it is merged, which keeps that rare.
