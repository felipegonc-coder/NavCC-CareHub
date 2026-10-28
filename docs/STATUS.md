# Status

_Last update: 2026-10-27 (22:45 UTC)._

## CI

The repository is public, so GitHub Actions minutes are free and CI runs again (since about 19:00
UTC, Oct 27). The savings in [decision 0006](decisions/0006-ci-within-free-minutes.md) stay:
drafts get no run, one push per pull request when it's ready, and lane-only pull requests run only
their lanes' unit tests. `main` is checked after every push, with every test, and merges need a
green run.

- **`main` is green** since 14dbce0 (#516 lint, #548 search, #558 versions, #567 the job store).
- **Merged while CI was out:** the core ones (#288, #304, #333, #180, #269) and the lane ones
  logged in each lane's status doc ([Team tools](team/STATUS.md),
  [Databases and Forms](databases/STATUS.md), [Testing](testing/)) are all covered by that green
  run of every test on `main`.
- **Known:** `npm audit` reports `@fastify/static` and `drizzle-orm`; #237 updates both.

## Done

- Repository, README, LICENSE, builder rules (`AGENTS.md`) and the plan in `docs/plan/`.
- CI rules ([decision 0006](decisions/0006-ci-within-free-minutes.md)): drafts get no run, and a
  lane-only pull request runs only its lanes' unit tests (#218); `main` after every push, the
  secret scan in its own workflow on every pull request and push (#386, #220); browser tests with
  the `e2e` label and every night (#369); the image check (#307).
- Monorepo skeleton and the quick checks (#1).
- Shared contracts between the lanes ([0007](decisions/0007-shared-contracts.md)), answers to the
  lane leads, the security review rule, deploy and anonymous-forms rules
  ([0010](decisions/0010-answers-to-lane-leads.md)), BlueOak-1.0.0 for shipped code
  ([0009](decisions/0009-blueoak-for-shipped-code.md)), license lists and CI hardening
  ([0011](decisions/0011-licenses-and-ci-hardening.md)).
- Specs: every Phase 1 core spec and the Phase 2 specs, with Formulas, Knowledge base, Data
  settings and the Notion parity checklist, in [`docs/plan/specs/`](plan/specs/README.md).
- Design kit: colour tokens, light and dark theme, base components, logo and the `/design`
  gallery (#2, [0008](decisions/0008-design-kit.md)); picked colours and cover gradients (#47);
  overlays and the app shell; loading, empty, error and offline states (#223); bottom sheets on
  phones (#304); toasts with Undo (#425); submenus (#486).
- Editor package: block editor on Yjs with Markdown shortcuts, safe links and other people's
  carets (#17); lane and block-group files with one shared schema and `nodeViews` (#62); the "/"
  menu; headings 2 to 4 and shortcuts (#262); CSS tokens (#263); the selection toolbar with a
  Comment slot (#269); the rich-text field for forms and properties (#105).
- Accounts: sessions, CSRF, guards and test helpers on the server (#29); workspaces, built-in and
  custom roles, members and guests (#55).
- Live co-editing: the page's Y.Doc storage (#183).
- Comments and mentions: mentions on the server (#206), comments on the web (#241, #333).
- Team tools wiring: notices, push, reminders, Home, live updates and jobs (#154, #156, #207,
  #209, #288), Home at `/` (#180); the job runner's test helpers (#567, #577).
- Installable web app: the service worker (#230) and app icons (#299).
- Lanes (each lead merges its own lane's pull requests): Databases and Forms
  ([status](databases/STATUS.md)), Team tools ([status](team/STATUS.md)), Learning, Extras, and
  Testing ([docs/testing](testing/)).

## In review

- #49 pages 1: the page model tables and the access check every feature uses.
- #197, #198 and #200 live co-editing on the server; #547 live co-editing in the web app.
- #237 dependency updates (the `npm audit` findings), #248 security headers, #352 sign-in screen,
  #573 request log without link codes or query values, #578 one test hooks switch.
- #279 editor block IDs and `revealBlock`; #543 "/" entries get the page being edited.
- #491 comments: taking comment marks off on comment-only connections.
- #526 deploy guide wording.

## In progress (Phase 1)

- Accounts 1c: sign-in, sign-out and password change on the server, and the `seed` command; then
  members, groups and guests, settings and the account screens.
- Spaces and pages (tree, move, cards, Trash, favorites, recent, sharing, share links, access
  requests), files, and the pages screens (sidebar tree, page view, new page, spaces).
- Editor: the block groups (toggle, callout, colours, code, table, columns, tabs, math, table of
  contents, synced blocks, page links, media and embeds).
- Comments in the editor (highlights, block comments, the comment-only rule for people who can
  comment), search, page history and Trash, templates and buttons, import and export.
- Learning, Databases and Forms, Team tools and Extras lanes; browser tests by the Testing lead's
  QA builders.
