# Status

_Updated by the lead. Last update: 2026-10-27 (03:00 UTC)._

## Done

- Repository, README, LICENSE, builder rules (`AGENTS.md`) and the plan in `docs/plan/`.
- CI rules to fit GitHub's free 2,000 minutes a month ([decision 0006](decisions/0006-ci-within-free-minutes.md)). No Mac runner (Felipe's decision, #7 closed): every job runs on GitHub-hosted runners.
- Monorepo skeleton and the quick checks (#1).
- Shared contracts between the lanes ([0007](decisions/0007-shared-contracts.md)), answers to the lane leads, the security review rule, deploy and anonymous-forms rules ([0010](decisions/0010-answers-to-lane-leads.md)), BlueOak-1.0.0 for shipped code ([0009](decisions/0009-blueoak-for-shipped-code.md)), license lists and CI hardening ([0011](decisions/0011-licenses-and-ci-hardening.md)).
- Specs: every Phase 1 core spec and the Phase 2 specs, with Formulas, Knowledge base, Data settings and the Notion parity checklist, in [`docs/plan/specs/`](plan/specs/README.md).
- Design kit: colour tokens, light and dark theme, base components, logo and the `/design` gallery (#2, [0008](decisions/0008-design-kit.md)); picked colours and cover gradients (#47).
- Editor package: block editor on Yjs with Markdown shortcuts, safe links and other people's carets (#17); lane and block-group files with one shared schema and `nodeViews` (#62).
- Accounts 1a: sessions, CSRF, guards and test helpers on the server (#29).
- Lanes (each lead merges its own lane's PRs): Databases and Forms ([status](databases/STATUS.md)): CSV, values, access levels, relations, templates and more (#6, #18 to #28, #54, #60); Team tools ([status](team/STATUS.md)): #22, #26, #32, #35, #37, #38, #63, #65, #66; Learning: course format (#36); Testing: shared test helpers (#61, [docs/testing](testing/)).

## In review

- #67 lane plumbing (every `// feature:` line, events, settings, API client, slots): merging main in.
- #55 accounts 1b (workspaces, roles, members) and #49 pages 1 (page model): rebasing after #29 and #67.
- #69 editor "/" menu; #27 design-kit overlays, then #34 app shell.
- #72 Team tools web push (service worker, manifest).
- #3 Docker image and deploy files, reworked for building on the server (decision 0010, Deploy).
- #4 browser tests with screenshots (#8 split) and #5 license check and `THIRD_PARTY_NOTICES.md`.

## In progress (Phase 1)

- Security headers (#11), then the sign-in screens and account settings.
- Spaces and pages (server PRs 2 to 7: tree, move, cards, trash, favorites, recent, sharing, share links, access requests), files, live co-editing, and the pages screens (sidebar tree, page view, new page, spaces).
- Editor: the rich-text field, block IDs, then the block groups (toggle, callout, colours, code, table, columns, tabs, math, table of contents, synced blocks, page links, media and embeds).
- A `snapshot` branch so builders without git can get a working copy of `main`.
- Learning, Databases and Forms, and Team tools lanes; browser tests by the Testing lead's QA builders.

## Next

- Comments and mentions (needs Team tools' `sendNotice` and notifications chat, due Oct 28), sharing screens (guests, groups, share links, access requests), search, page history and Trash, templates and buttons, import and export, settings and members.

## CI minutes (estimate)

Free allowance: 2,000 minutes a month.

| Date | Used (est.) | Notes |
| --- | --- | --- |
| 2026-10-26 | ~60 | Rough estimate (our token can't read job times): quick checks on #1, #2, #5, #6, #17 and #18 and their merges (about 2 to 3 minutes a run), two browser-test runs on #4 and one image run on #3 (about 6 to 10 minutes each). |
