# Status

_Updated by the lead. Last update: 2026-10-26 (evening)._

## Done

- Repository, README, LICENSE, builder rules (`AGENTS.md`) and the plan in `docs/plan/`.
- CI rules to fit GitHub's free 2,000 minutes a month ([decision 0006](decisions/0006-ci-within-free-minutes.md)), with Felipe's Mac as a runner for browser tests once it is online.
- Monorepo skeleton and the quick checks (#1).
- Shared contracts between the four lanes ([decision 0007](decisions/0007-shared-contracts.md)); BlueOak-1.0.0 allowed in shipped code ([0009](decisions/0009-blueoak-for-shipped-code.md)).

## In progress (Phase 0)

- Browser tests on request: Playwright smoke test with axe, screenshots in light and dark; license check and `THIRD_PARTY_NOTICES.md`.
- Docker image (server also serves the web app), built and smoke-tested once a day or on request, pushed to a private GHCR package; `deploy/` for the ThinkCentre later.
- Design kit and app shell.

## In progress (Phase 1)

- Accounts and sign-in (server), spaces and pages (server), the editor package.

## Next

- Phase 1: sign-in screens, sidebar and page tree, page view, live co-editing.
- Phase 2 (pulled forward): Databases and Messages, from the specs.

## CI minutes (estimate)

Free allowance: 2,000 minutes a month. Estimated from check-run times (each job rounded up to the minute).

| Date | Used (est.) | Notes |
| --- | --- | --- |
| 2026-10-26 | ~5 | #1 (one quick-check run on the PR, one on `main`). |
