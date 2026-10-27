# Status

_Updated by the lead. Last update: 2026-10-26 (evening, 23:59 UTC)._

## Done

- Repository, README, LICENSE, builder rules (`AGENTS.md`) and the plan in `docs/plan/`.
- CI rules to fit GitHub's free 2,000 minutes a month ([decision 0006](decisions/0006-ci-within-free-minutes.md)). Felipe's Mac runner is online but unused until Felipe picks the macOS account it runs under (issue #7).
- Monorepo skeleton and the quick checks (#1).
- Shared contracts between the lanes ([0007](decisions/0007-shared-contracts.md)), answers to the lane leads and the security review rule ([0010](decisions/0010-answers-to-lane-leads.md)), BlueOak-1.0.0 ([0009](decisions/0009-blueoak-for-shipped-code.md)), more permissive licenses and CI hardening ([0011](decisions/0011-licenses-and-ci-hardening.md)).
- Databases and Forms: shared contract and pure helpers in `packages/databases` (#6). Lane status: [docs/databases/STATUS.md](databases/STATUS.md).
- Design kit: colour tokens, light and dark theme, base components, logo and the `/design` gallery (#2, [0008](decisions/0008-design-kit.md)).
- Editor package: block editor on Yjs with Markdown shortcuts, safe links and other people's carets (#17).
- Specs: every Phase 1 core spec, plus Formulas, Knowledge base, Data settings and the Notion parity checklist (in Notion; copies are coming to `docs/plan/specs/`).

## In review

- #3 Docker image and deploy files: fixing security issues #10 and #15 first.
- #4 browser tests with screenshots: fixing security issue #8 first (read-only test job, separate publish job).
- #5 license check and `THIRD_PARTY_NOTICES.md`: adding the 0011 lists.

## In progress (Phase 1)

- Lane plumbing (`feat/lanes`: every `// feature:` line, events, settings, API client, slots), then security headers (#11), then the sign-in screens.
- Accounts and sign-in (server), spaces and pages (server), files, live co-editing, and the pages screens (sidebar tree, page view, new page).
- Design kit overlays (menus, dialogs, toasts), then the app shell.
- Editor: the "/" menu, the rich-text field, block IDs, then the block groups (toggle, callout, colours, code, table, columns, tabs, math, table of contents, synced blocks, page links, media and embeds).
- Learning, Databases and Forms, and Team tools lanes; each lead merges its own lane's PRs (for example #18, databases CSV import and export).

## Next

- Comments and mentions (needs Team tools' `sendNotice` and notifications chat, due Oct 28), sharing (guests, groups, share links, access requests), search, page history and Trash, templates and buttons, import and export, settings and members.

## CI minutes (estimate)

Free allowance: 2,000 minutes a month.

| Date | Used (est.) | Notes |
| --- | --- | --- |
| 2026-10-26 | ~60 | Rough estimate (our token can't read job times): quick checks on #1, #2, #5, #6, #17 and #18 and their merges (about 2 to 3 minutes a run), two browser-test runs on #4 and one image run on #3 (about 6 to 10 minutes each). |
