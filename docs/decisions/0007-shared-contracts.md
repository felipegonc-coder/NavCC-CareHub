# 0007: Shared contracts between lanes

- **Status:** accepted (2026-10-26). Owner: the main lead. Binding for every lane.
- **Context:** Four lanes build in parallel: **Core** (main lead), **Learning**, **Databases and Forms**, and **Team tools**. They need fixed names for folders, branches, the user and session API, the page model, permission checks, and how a feature adds tables, routes and screens. Anything here that turns out wrong is changed by a new decision record from the main lead, never by a lane on its own.
- **How to read it:** names in `code` are exact. "ETA" is when the piece is expected on `main`. Until a piece lands, code against the names here (behind a small stand-in if needed) and switch when it lands.

## 1. Lanes, folders and branches

A lane changes only its own folders, its own `// feature: <name>` lines and the pre-approved root lines in section 1.2. Anything else: ask the main lead, who changes it or approves one small PR.

| Lane (reviewer) | Folders | Migrations | Branches | Decision numbers |
| --- | --- | --- | --- | --- |
| **Core** (main lead) | Everything not listed below: root files, `.github/`, `deploy/`, `scripts/`, `packages/{shared,ui,editor}`, `apps/server/src/{app.ts,index.ts,config.ts,cli.ts,seed.ts,db/,core/,testing/}`, `apps/server/src/features/{auth,admin,workspaces,pages,collab,comments,mentions,files,search,history,templates,import-export,sharing,roles}/`, `apps/web/src/` outside other lanes' feature folders, `tests/e2e/` outside lane folders | `*_<core feature>_*.sql` | `feat/<name>` | 0001–0099 |
| **Learning** (Learning lead) | `packages/learning*/`, `apps/server/src/features/learning/`, `apps/web/src/features/learning/`, `tests/e2e/learning/`, `docs/learning/` | `*_learning_*.sql` | `feat/learning-*` | 0300–0399 |
| **Databases and Forms** (Databases lead) | `packages/databases*/`, `apps/server/src/features/{databases,forms}/`, `apps/web/src/features/{databases,forms}/`, `tests/e2e/{databases,forms}/`, `docs/databases/` | `*_databases_*.sql`, `*_forms_*.sql` | `feat/db-*`, `feat/forms-*` | 0200–0299 |
| **Team tools** (Team tools lead) | `packages/team-*/`, `apps/server/src/features/{messages,notices,live,push,jobs,reminders,home,calendar,meetings,automations,analytics,status,claude}/`, `apps/web/src/features/` (same names, plus `notifications`), `tests/e2e/team/`, `docs/team/` | `*_<one of those features>_*.sql` | `feat/team-*` | 0100–0199 |

- Lane packages are normal internal packages (AGENTS.md section 4). A lane package may use subpath exports (`"./*": "./src/*.ts"`) instead of one index, so builders never edit a shared index.
- Lane leads review and squash-merge their own lane's PRs. The main lead reviews everything else, including any PR that touches a core file.

### 1.1 Registration lines

Each feature replaces only its own line with one lazy registration. Lines are separated by blank lines so parallel PRs never edit the same lines. The main lead adds every line listed here (ETA Oct 27 morning).

| File | What a line does | Lines |
| --- | --- | --- |
| `apps/server/src/app.ts` | `await app.register(import('./features/<f>/routes'), { prefix: '/api/<f>' });` | auth, admin, workspaces, pages, collab, comments, mentions, files, search, history, templates, import-export, sharing, roles, learning, databases, forms, messages, notices, live, push, jobs, reminders, home, calendar, meetings, automations, analytics, status, claude |
| `apps/server/src/seed.ts` | `await (await import('./features/<f>/seed')).seed(ctx);` | same names |
| `apps/web/src/routes.tsx` | spreads the feature's lazy `RouteObject`s into `publicRoutes` or `appRoutes` | public: auth, status, design (the design kit gallery). App: shell, home, pages, settings, search, learning, databases, forms, messages, calendar, meetings, automations, analytics, notifications, claude |
| `apps/web/src/slots.ts` | `import('./features/<f>/slots')`, see section 5.3 | one line per web feature |
| `tests/e2e/screens.ts` | spreads `tests/e2e/<lane>/screens.ts` | learning, databases, forms, team |

### 1.2 Pre-approved root lines

- The one-line dependency on your own lane package in `apps/web/package.json` and `apps/server/package.json`.
- A third-party dependency line in `apps/web/package.json` or `apps/server/package.json` when the license is allowed (decision 0001, plus 0009). Already added by the main lead: `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`, `date-fns`, `recharts`.
- Team tools: `apps/web/public/sw.js`, `apps/web/public/manifest.webmanifest`, and the two lines that link them from `apps/web/index.html`. The service worker handles push only; it never caches `/api`.
- Never edit `package-lock.json` (the repo bot regenerates it on `main`).

## 2. Server basics

### 2.1 Database and migrations

- `app.db` is the Drizzle (node-postgres) database. Run several statements atomically with `app.db.transaction(async (tx) => { ... })`. Types: `import type { Db, Tx } from '../../db'`. Every service function below takes a `Db | Tx` as its first argument, so callers can use it inside their own transaction.
- Migrations: plain SQL in `apps/server/migrations/YYYYMMDDHHMM_<feature>_<what>.sql`, with the UTC time you wrote it. Forward only, never edited after merge. The runner applies, at start-up, every file not yet applied, in name order, each in a transaction, even if its name sorts before files already applied.
- Table names start with the feature (`learning_`, `db_`, `forms_`, `msg_`, `cal_`, ...). Core tables have no prefix: `users`, `sessions`, `workspaces`, `roles`, `workspace_members`, `spaces`, `pages`, `access_grants`, `page_docs`, `files`, and others added by core features.
- Foreign keys may point at core tables (`ON DELETE CASCADE` for data a row owns), never at another lane's tables. Across lanes, store the ID and use the other lane's functions or events.
- Drizzle table definitions live next to the feature (`features/<f>/schema.ts`).

### 2.2 Routes, input and errors

- A feature's routes are a Fastify plugin, the default export of `features/<f>/routes.ts`, registered on its line with the prefix `/api/<f>`. Other features import only from `features/<f>/index.ts` (or the files a lane names as public, such as `databases/api.ts`).
- Validate params, query and body with zod schemas from your lane package (core: `@carehub/shared`).
- **Every `/api` route needs a signed-in user unless it says `config: { public: true }`** (for example `GET /api/health`, sign-in, and `GET /api/status`). State-changing requests also need the CSRF header (section 3.1). Public routes still validate input and are rate-limited where they accept writes.
- Errors are JSON `{ "error": { "code": "...", "message": "..." } }`, with the message in plain words:

| Status | `code` | When |
| --- | --- | --- |
| 400 | `invalid` | Input fails validation (add `details` with the zod issues) |
| 401 | `signed_out` | No valid session |
| 403 | `forbidden` | Signed in, but not allowed. Message: "You don't have access to this." Never include the title or any content. |
| 404 | `not_found` | Doesn't exist or was deleted. Message: "This was deleted, or the link is wrong." |
| 409 | `conflict` | The request clashes with the current state (say what to do) |
| 413 | `too_large` | A limit was reached (say which one) |
| 429 | `rate_limited` | Too many tries (say when to try again) |

### 2.3 Settings

- Core settings are in `apps/server/src/config.ts` (`PORT`, `HOST`, `WEB_DIST_DIR`, `CAREHUB_VERSION`, `NODE_ENV`, `DATABASE_URL`, `SESSION_SECRET`, `CAREHUB_PUBLIC_URL`, `COOKIE_SECURE`, `FILES_DIR`).
- A feature reads its own optional settings in its own folder with `readSettings(schema)` from `apps/server/src/core/settings.ts`: a zod schema over `process.env`, where empty values count as unset. Missing optional settings switch that feature off with a plain message (for example "Google sign-in isn't set up yet."). They never stop the server.
- Each lane lists its settings in `docs/<lane>/settings.md` and sends the main lead the lines for `deploy/.env.example`. Secrets never go in the repository.
- Workspace settings that admins change in the app: `getWorkspaceSetting(db, workspaceId, key)` and `setWorkspaceSetting(db, workspaceId, key, value, userId)` from `apps/server/src/features/workspaces/index.ts`, with keys named `<feature>.<name>` (for example `pages.trashRetentionDays`, `claude.enabled`). Each feature validates its own keys.

### 2.4 Events between features

- `app.events.emit(name, payload)` and `app.events.on(name, handler)` (in-process; `apps/server/src/core/events.ts`, ETA Oct 27). Emit only after the database commit. Handlers run asynchronously; an error in one is logged and never reaches the emitter.
- Names are `<feature>.<thing>.<verb>` or the short forms below, payloads are IDs plus small facts (never secrets or content).
- Core emits: `page.created`, `page.updated`, `page.viewed`, `page.trashed`, `page.restored`, `page.deleted`, `access.changed`, `member.added`, `member.removed`, `member.roleChanged`, `comment.created`, `mention.created`. Lanes document theirs in their docs (Databases: `onDatabaseEvent` in `features/databases/events.ts`).

### 2.5 Tests and seed data

- `apps/server/src/testing/index.ts` (ETA Oct 27, with accounts PR 1): `createTestApp()` returns `{ app, db, close }` with an isolated database and all migrations; `createUser(db, { role?: 'admin' | 'editor' | 'commenter' | 'viewer', siteAdmin?, name?, email? })`; `injectAs(app, user, options)` signs in and sends the cookie and CSRF header. CI provides Postgres through `DATABASE_URL`.
- Seed: `node apps/server/dist/cli.js seed` loads fictional data only into an empty database (dev and the browser tests). Core creates the workspace "Care Hub", four people (`avery.admin@example.test` is site admin and Admin, `eli.editor@example.test`, `casey.commenter@example.test`, `val.viewer@example.test`, password from `CAREHUB_SEED_PASSWORD`), a team space and a few pages. Then each feature's `seed(ctx)` runs, with `ctx = { db, workspaceId, users: { admin, editor, commenter, viewer }, teamSpaceId, log }`. Fixtures are fictional and idempotent.
- Browser tests sign in with `signInAs(page, 'editor')` from `tests/e2e/helpers/auth.ts` (core, with the sign-in screens).

## 3. Accounts, sessions and permissions (core)

### 3.1 Sessions and the current user (accounts PR 1, ETA Oct 27)

- Cookies: `carehub_session` (HttpOnly, Secure, SameSite=Lax, 30-day sliding) and `carehub_csrf` (readable). Every state-changing `/api` request sends the `X-CSRF-Token` header with the `carehub_csrf` value, and the Origin is checked.
- `request.user`: `{ id, email, name, avatarUrl, isSiteAdmin, timeZone, use24h, weekStart, mustChangePassword }` (`timeZone` is IANA, default `America/Denver`; `weekStart` 0 = Sunday). `null` when signed out.
- `request.member`: `{ workspaceId, roleId, roleName, permissions: ReadonlySet<PermissionKey>, isAdmin }` for the current workspace, or `null`. One workspace for now ("Care Hub"); the model allows more.
- Guards (Fastify preHandlers): `app.requireUser`, `app.requireMember`, `app.requirePermission(key)`, `app.requireSiteAdmin`.
- For the live co-editing server: `getUserFromSessionToken(db, token)` and `SESSION_COOKIE`.
- HTTP: `GET /api/auth/me` returns `{ user, member, workspace: { id, name } }`. `PATCH /api/auth/profile` takes `name`, `timeZone`, `use24h`, `weekStart`. Sign-in, sign-out, sign-out everywhere and password changes are under `/api/auth/*`.

### 3.2 Roles and permission keys

Spec: [Roles and permissions](../plan/specs/roles-and-permissions.md).

- `PermissionKey` (from `@carehub/shared`): `pages.edit`, `pages.create`, `pages.comment`, `pages.share`, `templates.manage`, `claude.use`, `learning.build`, `learning.assign`, `learning.analytics`, `workspace.admin` (Admin settings; built-in Admin only, never on custom roles).
- Built-in roles (per workspace, can't be changed or deleted): **Admin** (all), **Editor** (edit, create, comment, share, templates, claude.use), **Commenter** (comment), **Viewer** (none). Custom roles: any mix except `workspace.admin` (Settings → Roles, ETA Oct 29).
- `hasPermission(member, key)` (from `@carehub/shared`) on both sides. A **site admin** (`isSiteAdmin`) manages accounts and the server. A workspace **Admin** is someone whose role has `workspace.admin`.
- Everyone, in every role, may use Home, Messages, Calendar, reminders and My learning, and fill in forms sent to them. Those routes need only `app.requireMember`.
- **Privacy (RP-D1):** admins never open other people's private spaces, chats they aren't in, private events, connected calendars, transcripts or Claude chats (403). Each lane enforces this for its own content.

### 3.3 Access to spaces, pages, databases and rows (page model PR, ETA Oct 27 evening)

- Levels: `'none' < 'view' < 'comment' < 'edit' < 'full'` (`AccessLevel` and `atLeast(level, min)` from `@carehub/shared`).
- Grants (`access_grants`) on a space or page, to a person, a role or everyone, with a level. `pages.inherit_access` false means "Stop inheriting".
- Effective level: take the highest grant that reaches the page (its space; its parent pages, up to the first one that stops inheriting; the page itself) for the person, their role or everyone. Then limit it by role: without `pages.edit` the most is `comment` (with `pages.comment`) or `view`; without `pages.share`, `full` works as `edit`; without `pages.comment`, `comment` works as `view`.
- Private spaces: only their owner. Team spaces: their grants; admins have `full` on every team space, never on private ones.
- Server functions, `apps/server/src/features/pages/index.ts`:
  - `getPageAccess(db, userId, pageId): Promise<AccessLevel>`
  - `getAccessForPages(db, userId, pageIds): Promise<Map<string, AccessLevel>>` (bulk; use it before showing any title, card, mention, backlink, search hit, notice or chart, so nothing leaks)
  - `app.requirePageAccess(min, (request) => pageId)` (preHandler; 404 if missing or deleted, 403 if below `min`)
  - `registerAccessResolver('row', (ctx) => Promise<AccessLevel>)`: the Databases lane adjusts a row's level from its row-access rules. `ctx = { db, userId, rowPageId, databasePageId, inherited }`. The role limit still applies after it.
  - `grantAccess(tx, { spaceId? , pageId?, principal: { type: 'user' | 'role' | 'everyone', id? }, level, grantedBy })` and `revokeAccess(tx, grantId, by)`. Nobody can grant above their own level.

## 4. Pages (core)

### 4.1 The page model

- Table `pages`: `id` (uuid), `workspace_id`, `space_id`, `parent_id` (null at the top of a space), `kind` (`page` | `database` | `row`), `is_inline`, `title`, `icon` (JSON: `{ type: 'emoji', emoji }` or `{ type: 'icon', name, color }`), `cover` (JSON: `{ type: 'file', fileId }` or `{ type: 'preset', name }`, or null), `full_width`, `inherit_access`, `position` (fractional key), `created_by`, `created_at`, `updated_by`, `updated_at`, `deleted_at`, `deleted_by`.
- **Database rows are pages.** A full-page database is `kind = 'database'` in the page tree. An inline database is `kind = 'database'` with `is_inline = true`; its parent is the host page and it isn't in the sidebar; the host page shows it with the editor block `database` (`{ databaseId, viewId? , linkedViewId? }`). A row is `kind = 'row'`, its parent is its database page, and it never appears in the tree. A row's name is `pages.title`. Icon, cover, content, comments, mentions, backlinks, history, Trash and search work for rows as for any page. Everything else about databases (properties, values, views, templates, forms, row rules) lives in the Databases lane's `db_*` and `forms_*` tables, keyed by page ID.
- Page URL for every kind: **`/p/<pageId>`** (`pageUrl(id)` from `@carehub/shared`). Links between pages store the page ID, so they never break. Card data for a pasted link or a mention: `GET /api/pages/:id/card` returns `{ id, kind, title, icon, spaceName }`, or 403 without any title.
- Server functions for other lanes (`apps/server/src/features/pages/index.ts`, all take `Db | Tx`): `createPage(tx, { workspaceId, spaceId?, parentId?, kind, title, icon?, isInline?, createdBy })` returns the page; `setPageTitle(tx, pageId, title, by)`; `trashPage(tx, pageId, by)` and `restorePage(tx, pageId, by)` (with sub-pages and rows); `getPrivateSpaceId(tx, userId)` (creates it on first use).
- HTTP (for screens): spaces `GET/POST /api/spaces`, `PATCH/DELETE /api/spaces/:id`; tree `GET /api/spaces/:id/tree`; pages `POST /api/pages`, `GET/PATCH /api/pages/:id`, `POST /api/pages/:id/move`, `DELETE /api/pages/:id`; Trash `GET /api/trash`, `POST /api/trash/:id/restore`, `DELETE /api/trash/:id`; `GET/PUT/DELETE /api/favorites`; `GET /api/recent`; people `GET /api/workspace/members?q=` (`{ id, name, email, avatarUrl, roleId, roleName }`).

### 4.2 Page content

- Each page's content is one Y.Doc, edited live through the collaboration server (`/api/collab`, WebSocket, ETA Oct 28). The server keeps the Y.Doc and a Markdown copy in `page_docs`.
- Server functions (`apps/server/src/features/collab/index.ts`): `getPageMarkdown(db, pageId)`, `copyPageContent(tx, fromPageId, toPageId)` (row templates, Duplicate), `setPageContentFromMarkdown(tx, pageId, markdown)` (imports, notes), `getPageText(db, pageId)` (search).

### 4.3 Other core services

- **Files** (ETA Oct 28): `POST /api/files` (multipart, field `file`, query `scope=<feature>:<id>`) returns `{ id, name, size, mimeType, url, width?, height? }`; `GET /api/files/:id` (supports Range and `?download=1`); `DELETE /api/files/:id`. Default limit 25 MB per file (setting `FILES_MAX_MB`); type checked from the file's content, not its name; no SVG. Each lane decides who may read its files: `registerFileScope(feature, { canRead(user, scopeId), canWrite(user, scopeId) })` from `apps/server/src/features/files/index.ts`. Web: `uploadFile(file, { scope, onProgress })` from `apps/web/src/lib/files.ts`.
- **People, teams and managers** (ETA Oct 29): `GET /api/workspace/members` also returns `managerId` and `teamIds`; `GET /api/workspace/teams` returns `{ id, name, memberIds }[]`; admins manage teams and managers in Settings → Members. Server: `listTeamMembers(db, teamId)`, `listReports(db, managerId)`.
- **Search** (ETA Oct 29): pages, databases and rows by title and text, filtered by access. A lane can add text for its own pages with `registerSearchText('row', (db, pageId) => Promise<string>)`.
- **Comments and mentions** (ETA Oct 29): comments on pages and rows; '@' mentions of people, pages and dates in the editor and in comments. Mentions send a notice through Team tools' `sendNotice`.

### 4.4 From the Team tools lane (names from its brief; that lead owns them)

- **Live updates:** SSE at `GET /api/live`. Server `publishToUsers(userIds, event)`, `publishTopic(topic, event)`, `registerTopic(prefix, canSubscribe)` from `apps/server/src/features/live/index.ts`; events are small nudges `{ type, data? }` (IDs only); clients refetch through normal APIs. Web `useLiveEvent(type, handler)` and `useLiveTopic(topic, handler)` from `apps/web/src/features/live/index.ts`. Page content uses the collaboration server instead.
- **Jobs:** `registerJobHandler`, `scheduleJob`, `registerPeriodicTask` from `apps/server/src/features/jobs/index.ts` (a Postgres queue; handlers must be idempotent). Until it lands, a feature may use its own interval guarded by `pg_try_advisory_lock`, then switch.
- **Notices:** `sendNotice({ workspaceId, userId, kind, sender, icon?, title, text?, card?, buttons?, groupKey? })` from `apps/server/src/features/notices/index.ts`. Notices arrive in the person's 🔔 Care Hub chat. Care Hub never sends email.
- **Calendar items from other lanes:** the Team tools lead publishes the source interface in its brief (for example Learning due dates through `listLearningDueDates`).

## 5. Web basics

### 5.1 Routes and screens

- `apps/web/src/routes.tsx` has `publicRoutes` (signed out, no shell: sign-in, set password, `/status`) and `appRoutes` (signed in, inside the AppShell). A feature exports `routes: RouteObject[]` from `features/<f>/routes.tsx` and loads its screens lazily.
- Paths: Home `/` (Team tools), pages, databases and rows `/p/:pageId`, Settings `/settings/*`, Learning `/learning/*`, forms to fill `/forms/:formId`, Messages `/messages/*`, Calendar `/calendar/*`, Meetings `/meetings/*`, Analytics `/analytics`, Status `/status` (public).
- Every screen: one `<main>`, a document title starting "Care Hub" (`usePageTitle('Messages')` gives "Care Hub · Messages"), the shared states from the specs' rules (loading skeleton after 300 ms, empty, error with Retry, No access, Not found, offline banner), phone layout under 768 px, 44 px touch targets, and every drag with a keyboard and menu alternative. Use `@carehub/ui` components and tokens only.
- Register each screen for the browser tests in `tests/e2e/<lane>/screens.ts`.

### 5.2 Data and the current user

- `api` from `apps/web/src/lib/api.ts` (ETA Oct 27): `api.get(path, { schema? })`, `api.post/put/patch/delete(path, body?, { schema? })`. It sends cookies and the CSRF header, parses JSON (with an optional zod schema) and throws `ApiError { status, code, message }`.
- TanStack Query for server data; query keys start with the feature name (`['pages', id]`).
- `useMe()` returns `{ user, member, workspace }`; `usePermission(key)`; `usePageAccess(pageId)` (from `apps/web/src/features/auth` and `features/pages`, ETA Oct 28).

### 5.3 Slots (`apps/web/src/slots.ts`, ETA Oct 27)

Each web feature may export `slots` (a partial `Slots` object) from `features/<f>/slots.ts`; one line per feature in `apps/web/src/slots.ts` collects them. The AppShell, page view and editor read only from here.

| Slot | Shape | Used for |
| --- | --- | --- |
| `sidebarItems` | `{ id, label, icon, to, order, useBadge?(): number \| undefined }` | Home, Messages (unread badge), Calendar, Learning |
| `sidebarSections` | `{ id, order, Component }` | Upcoming events under the top items |
| `settingsSections` | `{ id, label, path, order, permission?: PermissionKey \| 'siteAdmin', element }` | Members, Roles, Notifications, Automations, Claude, Learning |
| `commands` | `{ id, title, keywords?, group?, permission?, run(ctx) }` | Ctrl+K |
| `pageMenuItems` | `{ id, label, icon?, order, isVisible?(page), onSelect(page) }` | the page '…' menu, e.g. "Remind me" |
| `pageKindViews` | `{ database?: Component<{ page }> }` | the page view shows the Databases lane's `<DatabasePage>` for `kind = 'database'` |
| `pageHeaderExtras` | `{ row?: Component<{ page }> }` | a row's properties above the editor |
| `editor` | `{ extensions?, slashItems?, linkPickers?, bubbleItems? }` | extra blocks such as `database` and meeting notes, "/database", writing help |

### 5.4 The editor (`@carehub/editor`)

- `BlockEditor` for page content (core), with the extension props `extensions`, `slashItems`, `linkPickers` (`{ label, pick(): Promise<string | null> }`, returning a relative link) and `bubbleItems`. Lanes add blocks through the `editor` slot, never by editing the package.
- `RichTextField({ value, onChange, ariaLabel, placeholder?, marks?, singleLine?, autoFocus?, readOnly?, id?, ariaDescribedBy?, onPickPage?, linkPickers? })` for small rich-text fields without live co-editing (paragraphs and hard breaks; ETA Oct 28). `export type { JSONContent }`.

## 6. Process

- Small PRs (under about 600 lines of non-test code), CI per decision 0006, the clean-room line in every PR description.
- All agents share one GitHub account: push in few, larger commits; never poll in a loop (check the CI comment at most every 5 minutes); on any rate-limit or abuse error wait at least 5 minutes, then 15, before trying again.
- A security reviewer checks PRs and `main` twice a day and opens GitHub issues labelled `security` plus the lane. Lane leads watch for them and fix serious ones first.
- Each evening the browser tests (01:00 UTC) and the Docker image (01:30 UTC) run on `main` with everything merged. The main lead sends any breakage to the lead that owns it.

## Consequences

- Lanes can build in parallel against fixed names. Pieces that aren't on `main` yet are coded against these names and switched on when they land.
- A wrong name costs one decision record and one follow-up PR, not a lane-wide rewrite.
