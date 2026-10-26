# Status

_Updated by the lead. Last update: 2026-10-26._

## Done

- Repository, README, LICENSE, builder rules (`AGENTS.md`) and the plan in `docs/plan/`.
- CI rules to fit GitHub's free 2,000 minutes a month ([decision 0006](decisions/0006-ci-within-free-minutes.md)).

## In progress (Phase 0)

- Monorepo skeleton and the quick checks (type check, lint, Vitest, license check).
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
| 2026-10-26 | 0 | No workflows on `main` yet. |
