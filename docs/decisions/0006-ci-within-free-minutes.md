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

## Consequences

A broken build or a broken screen can reach `main` and is then caught by the nightly run instead of the pull request. The review helper adds `e2e` to every pull request that changes screens before it is merged, which keeps that rare.
