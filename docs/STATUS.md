# Status

_Updated by the lead. Last update: 2026-10-27 (16:30 UTC)._

## CI minutes are out (since about 12:00 UTC, Oct 27)

This month's GitHub Actions minutes ran out, so nothing runs: no quick checks, browser tests,
image builds or repo bot. Felipe is choosing what to do about it ([decision 0006](decisions/0006-ci-within-free-minutes.md)).
Until the minutes return:

- **Core pull requests:** the main lead reviews every line by hand and merges. Security reviewer 1
  still OKs everything rule 0010 covers (dependencies, `.github/`, `deploy/`, the Dockerfile,
  `.npmrc`).
- **Lane pull requests:** each lane lead may merge lane-only pull requests (its own folders, tests
  and docs; at most about 400 non-test lines) after reading every line. Route, database and screen
  tests may be written but not run yet; `tsc` runs locally where the builder can. Migrations only
  add (tables, columns, indexes).
- **Waiting for the minutes:** new third-party dependencies, because the repo bot can't update
  `package-lock.json` (for example #197, #198 and #200).
- **Logged:** every merge without CI, with its head commit: core ones below, lane ones in each
  lane's status doc ([Team tools](team/STATUS.md), [Databases and Forms](databases/STATUS.md),
  [Testing](testing/); Learning and Extras in their own status docs).
- **When the minutes return:** a full run on `main` first, then the browser tests. Owners fix
  anything red within the hour, or the pull request is reverted.

### Merged without CI (core)

| PR | What | Head |
| --- | --- | --- |
| #288 | Team tools: live updates and jobs registered in `app.ts` | 46c038a |
| #304 | Design kit: pop-ups as bottom sheets on phones, full-screen phone menu; DK-14 fix (#255) | 98563e9 |
| #333 | Comments on the web, part 2 (panel, thread cards); mention notice limits (#224) | 665831f |
| #180 | Home at `/` (the lane part passed CI on a64cef9; the `routes.tsx` lines and core tests didn't run) | 138032c |
| #269 | Editor: selection toolbar in the spec's order, read-only Comment (passed CI on this head before the outage, not on today's `main`) | cf67ac7 |

## Done

- Repository, README, LICENSE, builder rules (`AGENTS.md`) and the plan in `docs/plan/`.
- CI rules to fit GitHub's free 2,000 minutes a month ([decision 0006](decisions/0006-ci-within-free-minutes.md)), and the savings in #218: drafts get no run, `main` is checked every 3 hours (only if it changed), and a lane-only pull request runs only its lanes' unit tests. No Mac runner (Felipe's decision, #7 closed).
- Monorepo skeleton and the quick checks (#1).
- Shared contracts between the lanes ([0007](decisions/0007-shared-contracts.md)), answers to the lane leads, the security review rule, deploy and anonymous-forms rules ([0010](decisions/0010-answers-to-lane-leads.md)), BlueOak-1.0.0 for shipped code ([0009](decisions/0009-blueoak-for-shipped-code.md)), license lists and CI hardening ([0011](decisions/0011-licenses-and-ci-hardening.md)).
- Specs: every Phase 1 core spec and the Phase 2 specs, with Formulas, Knowledge base, Data settings and the Notion parity checklist, in [`docs/plan/specs/`](plan/specs/README.md).
- Design kit: colour tokens, light and dark theme, base components, logo and the `/design` gallery (#2, [0008](decisions/0008-design-kit.md)); picked colours and cover gradients (#47); overlays and the app shell; loading, empty, error and offline states (#223); bottom sheets on phones (#304).
- Editor package: block editor on Yjs with Markdown shortcuts, safe links and other people's carets (#17); lane and block-group files with one shared schema and `nodeViews` (#62); the "/" menu; headings 2 to 4 and shortcuts (#262); CSS tokens (#263); the selection toolbar with a Comment slot (#269).
- Accounts 1a: sessions, CSRF, guards and test helpers on the server (#29).
- Live co-editing: the page's Y.Doc storage (#183).
- Comments and mentions: mentions on the server (#206), comments on the web (#241, #333).
- Team tools wiring: notices, push, reminders, Home, live updates and jobs (#154, #156, #207, #209, #288), Home at `/` (#180).
- Lanes (each lead merges its own lane's PRs): Databases and Forms ([status](databases/STATUS.md)), Team tools ([status](team/STATUS.md)), Learning, Extras, and Testing ([docs/testing](testing/)).

## In review

- #55 accounts 1b (workspaces, roles, members): security reviewer 1 first, then merge. #49 pages 1 (page model) right after it.
- #279 editor block IDs and `revealBlock`: reviewed; waits for reviewer 1's OK on one dependency line.
- #197, #198 and #200 live co-editing server: reviews, then the new dependencies wait for the minutes.
- #237 dependency updates (fix the `npm audit` findings in `drizzle-orm` and `@fastify/static`), #248 security headers, #352 sign-in screen: security reviewer 1.
- #386 secret scan on every pull request and push (`secrets.yml`, #220), #369 browser-test workflow, #307 image follow-up: security reviewer 1.
- #105 editor rich-text field: R's review.

## In progress (Phase 1)

- Accounts 1c (sign-in, members, groups and guests, settings), then the account screens.
- Spaces and pages (tree, move, cards, Trash, favorites, recent, sharing, share links, access requests), files, and the pages screens (sidebar tree, page view, new page, spaces).
- Editor: the block groups (toggle, callout, colours, code, table, columns, tabs, math, table of contents, synced blocks, page links, media and embeds).
- Comments in the editor (highlights, block comments, the comment-only rule for people who can comment), search, page history and Trash, templates and buttons, import and export.
- Learning, Databases and Forms, Team tools and Extras lanes; browser tests by the Testing lead's QA builders.

## CI minutes (estimate)

Free allowance: 2,000 minutes a month.

| Date | Used (est.) | Notes |
| --- | --- | --- |
| 2026-10-26 | ~60 | Rough estimate (our token can't read job times): quick checks on #1, #2, #5, #6, #17 and #18 and their merges (about 2 to 3 minutes a run), two browser-test runs on #4 and one image run on #3 (about 6 to 10 minutes each). |
| 2026-10-27 | the rest | The month's minutes ran out at about 12:00 UTC. No runs since. |
