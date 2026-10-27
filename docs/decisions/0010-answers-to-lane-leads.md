# 0010: Answers to the lane leads (Oct 26)

- **Status:** accepted (2026-10-26). Adds to decision 0007; where they differ, 0007 wins.
- **Context:** When `main` opened (skeleton #1 merged), the Learning, Databases and Forms, and Team tools leads had open questions about folders, where features plug in, settings and when the core services arrive. Quick answers beat perfect ones, so these were sent the same evening.

## All lanes

- Lane leads review and squash-merge their own lane's PRs (squash, with the expected head commit) once the CI comment says the checks passed on the head commit. Any PR that touches a file outside the lane's folders (0007 section 1) goes to the main lead.
- A lane's first "contract" PR may be bigger than the ~600-line guide when it is mostly type declarations that the lane's later PRs import (Databases #6).
- The security reviewer files GitHub issues labelled `security` plus the lane: `core`, `learning`, `databases` or `team`. Leads fix serious ones first.
- Builder A adds every `// feature:` line, `app.events`, `readSettings`, the web `api` client, the slots registry, `usePageTitle`, `AccessLevel`, `atLeast` and `pageUrl`, plus the pre-approved web dependencies (PR `feat/lanes`, Oct 27 morning).
- Seed data: `apps/server/src/seed.ts` exports `SeedContext` and `seedFeatures(ctx)` with one line per feature. The accounts PR adds the `seed` command and the core seed (workspace and the four example people); the page model adds the team space and a few pages.

## Learning

- Uploads use the core files API (`scope=learning:<id>`, `registerFileScope('learning', ...)`), not a Learning media route. Until it lands (Oct 28), a stand-in with the same names lives in the Learning folder.
- The calendar belongs to Team tools. Learning exports `listLearningDueDates` from `apps/server/src/features/learning/public.ts` in the shape the Team tools lead published.
- Reminders use Team tools' `sendNotice` and jobs; until jobs land, an interval guarded by `pg_try_advisory_lock`. No email.
- Draft review links work only for signed-in people. `linkPickers` are available on both `BlockEditor` and `RichTextField`.
- Learning's five open product questions use the defaults the Learning lead proposed until Felipe says otherwise.

## Databases and Forms

- Confirmed as written in 0007: the row-page model, the `row` access resolver, the page service functions, the web slots `pageKindViews.database`, `pageHeaderExtras.row` and `editor`, live updates through Team tools' topics (`db:<id>`), people from `GET /api/workspace/members`, uploads through `POST /api/files`.

## Team tools

- The lane owns `packages/team-*/` and the web feature folders `jobs` and `notifications` as well as its server feature names.
- Optional settings (Google sign-in, web push keys, calendar secret key, Claude key, speech models folder) are read by each feature with `readSettings`; `config.ts` doesn't change. The lane lists them in `docs/team/settings.md` and sends the `deploy/.env.example` lines to the main lead.
- `GET /api/status` uses `config: { public: true }`; `/status` is in `publicRoutes`. Home takes `/`.
- The live updates, jobs and notices interfaces in the Team tools brief are adopted as written (0007 section 4.4).

## Security review before merge (added 2026-10-26, after the security reviewer's first pass)

- Every PR that adds dependencies, or touches `.github/`, `deploy/`, a Dockerfile or `.npmrc`, gets a look from the security reviewer before it merges. The author or lane lead messages the reviewer with the PR number and what each new package is for, and merges once it says OK or its comments are fixed. Other PRs don't wait; the reviewer still checks PRs and `main` twice a day.
- No workflow on any branch targets `self-hosted` (Felipe's Mac) until Felipe decides which macOS account the runner uses (issue #7). Before the first Mac job, browser-test jobs run with install scripts off, no sudo, nothing written outside the job folder and the tool cache, and the write token out of reach of installs, tests and the server (issue #8).
- Defaults while nothing is deployed: production runs a pinned image version that a person bumps (issue #10; revisit when the server is set up), and Care Hub is reachable only over the tailnet, with Caddy listening on the Tailscale interface (issue #15).
