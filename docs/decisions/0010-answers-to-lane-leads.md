# 0010: Answers to the lane leads (Oct 26)

- **Status:** accepted (2026-10-26). Adds to decision 0007; where they differ, 0007 wins.
- **Context:** When `main` opened (skeleton #1 merged), the Learning, Databases and Forms, and Team tools leads had open questions about folders, where features plug in, settings and when the core services arrive. Quick answers beat perfect ones, so these were sent the same evening.

## All lanes

- Lane leads review and squash-merge their own lane's PRs (squash, with the expected head commit) once the CI comment says the checks passed on the head commit. Any PR that touches a file outside the lane's folders (0007 section 1) goes to the main lead.
- A lane's first "contract" PR may be bigger than the ~600-line guide when it is mostly type declarations that the lane's later PRs import (Databases #6).
- The security reviewer files GitHub issues labelled `security` plus the lane: `core`, `learning`, `databases` or `team`. Leads fix serious ones first.
- Builder A adds every `// feature:` line, `app.events`, `readSettings`, the web `api` client, the slots registry, `usePageTitle`, `AccessLevel`, `atLeast` and `pageUrl`, plus the pre-approved web dependencies (PR `feat/lanes`, Oct 27 morning).
- Seed data: `apps/server/src/seed.ts` exports `SeedContext` and `seedFeatures(ctx)` with one line per feature. The accounts PR adds the `seed` command and the core seed (workspace and the four example people); the page model adds the team space and a few pages.

## Everyone (2026-10-27)

- Build a working basic version of every feature first; polish comes later.
- Every colour, font, size, spacing and corner radius comes from the design kit (`@carehub/ui`: the Tailwind preset's classes, or the `--ch-*` CSS variables in plain CSS). No one-off values, so Care Hub can be restyled from the design kit later.
- Each builder pushes its work in progress to its `feat/*` branch at least every 3 hours, without opening a PR, so nothing is lost if a session stops.

## Anonymous forms (2026-10-27, security reviewer)

Both stay off by default per form (FM-D2).

- **Uploads** (`registerFileScope('forms', { allowAnonymous: true, ... })`): each upload is tied to the response being filled in, a response attaches only its own uploads, and unattached files are deleted after about an hour. A daily byte quota per form plus a free-disk floor. Office files only as docx, xlsx and pptx (no macro files or old binary formats; the content must match the extension). Always served as a download, PDFs included; pictures re-encoded. Clean file names (path separators, control characters, U+202E) and an RFC 5987 `Content-Disposition`. Per-IP limits rely on `trustProxy` set to Caddy only.
- **Public routes** (`GET/POST /api/forms/public/:linkCode`, `config: { public: true }`, 30 responses a minute per form): codes from `crypto.randomBytes(16)` as base64url, kept out of the Caddy and Fastify logs. The server checks each response against the form definition, show-if rules included, and writes only the mapped questions. Atomic `closeAt`/`maxResponses` checks and batched notices; optionally a signed timestamp from the GET for a minimum fill time. No CORS headers. The CSRF double-submit still applies. Handlers ignore a signed-in user, so responses stay anonymous.

## Learning

- Uploads use the core files API (`scope=learning:<id>`, `registerFileScope('learning', ...)`), not a Learning media route. Until it lands (Oct 28), a stand-in with the same names lives in the Learning folder.
- The calendar belongs to Team tools. Learning exports `listLearningDueDates` from `apps/server/src/features/learning/public.ts` in the shape the Team tools lead published.
- Reminders use Team tools' `sendNotice` and jobs; until jobs land, an interval guarded by `pg_try_advisory_lock`. No email.
- Draft review links work only for signed-in people. `linkPickers` are available on both `BlockEditor` and `RichTextField`.
- Learning's five open product questions use the defaults the Learning lead proposed.

## Databases and Forms

- Confirmed as written in 0007: the row-page model, the `row` access resolver, the page service functions, the web slots `pageKindViews.database`, `pageHeaderExtras.row` and `editor`, live updates through Team tools' topics (`db:<id>`), people from `GET /api/workspace/members`, uploads through `POST /api/files`.

## Team tools

- The lane owns `packages/team-*/` and the web feature folders `jobs` and `notifications` as well as its server feature names.
- Optional settings (Google sign-in, web push keys, calendar secret key, Claude key, speech models folder) are read by each feature with `readSettings`; `config.ts` doesn't change. The lane lists them in `docs/team/settings.md` and sends the `deploy/.env.example` lines to the main lead.
- `GET /api/status` uses `config: { public: true }`; `/status` is in `publicRoutes`. Home takes `/`.
- The live updates, jobs and notices interfaces in the Team tools brief are adopted as written (0007 section 4.4).

## Security review before merge (added 2026-10-26, after the security reviewer's first pass)

- Every PR that adds dependencies, or touches `.github/`, `deploy/`, a Dockerfile or `.npmrc`, gets a look from the security reviewer before it merges. The author or lane lead messages the reviewer with the PR number and what each new package is for, and merges once it says OK or its comments are fixed. Other PRs don't wait; the reviewer still checks PRs and `main` twice a day.
- No Mac runner (issue #7 closed, 2026-10-27). No workflow targets `self-hosted`; everything runs on GitHub-hosted runners.
- **Deploy** (2026-10-27, replaces the pinned-image default of #10): a person picks a tag or commit that passed CI on `main`; the server clones the repo with a read-only deploy key and builds it with `docker compose up -d --build`. Nothing publishes images: `image.yml` runs only by hand or with the `image` label, without `packages: write`. Base images are pinned by digest and bumped by hand. Data lives outside the checkout (`CAREHUB_DATA_DIR`, default `/srv/carehub`). Care Hub is reachable only over the tailnet, with Caddy on the Tailscale interface (#15). Details: `deploy/README.md` (#3).
- **Standing OK** (every lane): `vitest` ^3.2, `zod` ^4 and existing `@carehub/*` workspace packages, in the same ranges as the rest of the repo. Tell the reviewer if the lockfile bot adds anything else.
- A package that's already in `package-lock.json` (for example one StarterKit already installs), added as a direct dependency in a range that matches the locked version, doesn't wait; the reviewer checks the bot's lockfile commit as usual.
- **Lockfile:** builders add packages to `package.json` only. CI installs them (`npm install --ignore-scripts` when the lockfile is out of sync); after the merge the repo bot updates `package-lock.json` on `main`, and the reviewer checks that commit.
