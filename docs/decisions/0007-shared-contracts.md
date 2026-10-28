# 0007: Shared contracts between lanes

- **Status:** accepted (2026-10-26). Owner: the main lead. Binding for every lane.
- **Context:** Five lanes build in parallel: **Core** (main lead), **Learning**, **Databases and Forms**, **Team tools** and **Extras** (decision 0400). They need fixed names for folders, branches, the user and session API, the page model, permission checks, and how a feature adds tables, routes and screens. Anything here that turns out wrong is changed by a new decision record from the main lead, never by a lane on its own.
- **How to read it:** names in `code` are exact. Until a piece is on `main`, code against the names here (behind a small stand-in if needed) and switch when it lands. [docs/STATUS.md](../STATUS.md) lists what is on `main`.

## 1. Lanes, folders and branches

A lane changes only its own folders, its own `// feature: <name>` lines and the pre-approved root lines in section 1.2. Anything else: ask the main lead, who changes it or approves one small PR.

| Lane (reviewer) | Folders | Migrations | Branches | Decision numbers |
| --- | --- | --- | --- | --- |
| **Core** (main lead) | Everything not listed below: root files, `.github/`, `deploy/`, `scripts/`, `packages/{shared,ui,editor}`, `apps/server/src/{app.ts,index.ts,config.ts,cli.ts,seed.ts,db/,core/,testing/}`, `apps/server/src/features/{auth,admin,workspaces,pages,collab,comments,mentions,files,sharing,roles}/`, `apps/web/src/` outside other lanes' feature folders, `tests/e2e/` outside lane folders | `*_<core feature>_*.sql` | `feat/<name>` | 0001–0099 |
| **Learning** (Learning lead) | `packages/learning*/`, `apps/server/src/features/learning/`, `apps/web/src/features/learning/`, `tests/e2e/learning/`, `docs/learning/` | `*_learning_*.sql` | `feat/learning-*` | 0300–0399 |
| **Databases and Forms** (Databases lead) | `packages/databases*/`, `apps/server/src/features/{databases,forms}/`, `apps/web/src/features/{databases,forms}/`, `tests/e2e/{databases,forms}/`, `docs/databases/` | `*_databases_*.sql`, `*_forms_*.sql` | `feat/db-*`, `feat/forms-*` | 0200–0299 |
| **Team tools** (Team tools lead) | `packages/team-*/`, `apps/server/src/features/{messages,notices,live,push,jobs,reminders,home,calendar,meetings,automations,analytics,status}/`, `apps/web/src/features/` (same names, plus `notifications`), `tests/e2e/team/`, `docs/team/` | `*_<one of those features>_*.sql` | `feat/team-*` | 0100–0199 |
| **Extras** (Extras lead) | `packages/extras/`, `apps/{server,web}/src/features/{search,history,templates,import-export,knowledge,claude}/`, `packages/editor/src/lanes/{extras,claude}.ts`, `tests/e2e/extras/`, `docs/extras/` | `*_<one of those features>_*.sql` | `feat/extras-*` | 0400–0499 |

- Lane packages are normal internal packages (AGENTS.md section 4). A lane package may use subpath exports (`"./*": "./src/*.ts"`) instead of one index, so builders never edit a shared index.
- Lane leads review and squash-merge their own lane's PRs. The main lead reviews everything else, including any PR that touches a core file.

### 1.1 Registration lines

Each feature replaces only its own line with one lazy registration. Lines are separated by blank lines so parallel PRs never edit the same lines. The main lead adds every line listed here; decision 0400 added the Extras lines (with `knowledge`).

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
- Team tools: `apps/web/public/sw.js`, `apps/web/public/manifest.webmanifest`, and the two lines that link them from `apps/web/index.html`. The service worker handles push only; it never caches `/api`. Core serves `/sw.js` with `Cache-Control: no-cache` (security headers PR), so a new version takes over at once.
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
- **Every other `/api` route also needs a member of the current workspace** (403 for guests, people outside it and removed members), unless it says `config: { allowGuests: true }` (guests too; the route then checks the page grant itself) or `config: { allowNonMembers: true }` (anyone signed in: only account routes such as `/api/auth/me`, and site-admin routes).
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

- Core settings are in `apps/server/src/config.ts` (`PORT`, `HOST`, `WEB_DIST_DIR`, `CAREHUB_VERSION`, `CAREHUB_BUILD_DATE` (set by the build, for the Status page), `NODE_ENV`, `DATABASE_URL`, `CAREHUB_PUBLIC_URL` (required when `NODE_ENV=production`), `COOKIE_SECURE`, `FILES_DIR`). There is no `SESSION_SECRET`: sessions are random tokens stored hashed.
- A feature reads its own optional settings in its own folder with `readSettings(schema)` from `apps/server/src/core/settings.ts`: a zod schema over `process.env`, where empty values count as unset. Missing optional settings switch that feature off with a plain message (for example "Google sign-in isn't set up yet."). They never stop the server.
- Each lane lists its settings in `docs/<lane>/settings.md` and sends the main lead the lines for `deploy/.env.example`. Secrets never go in the repository.
- Workspace settings that admins change in the app: `getWorkspaceSetting(db, workspaceId, key)` and `setWorkspaceSetting(db, workspaceId, key, value, userId)` from `apps/server/src/features/workspaces/index.ts`, with keys named `<feature>.<name>` (for example `pages.trashRetentionDays`, `claude.enabled`). Each feature validates its own keys.

### 2.4 Events between features

- `app.events.emit(name, payload)` and `app.events.on(name, handler)` (in-process; `apps/server/src/core/events.ts`). Emit only after the database commit. Handlers run asynchronously; an error in one is logged and never reaches the emitter.
- Names are `<feature>.<thing>.<verb>` or the short forms below, payloads are IDs plus small facts (never secrets or content).
- Core emits: `page.created`, `page.updated`, `page.viewed`, `page.trashed`, `page.restored`, `page.deleted`, `access.changed`, `member.added`, `member.removed`, `member.roleChanged`, `session.ended`, `comment.created`, `mention.created`. Lanes document theirs in their docs (Databases: `onDatabaseEvent` in `features/databases/events.ts`).

### 2.5 Tests and seed data

- `apps/server/src/testing/index.ts`: `createTestApp()` returns `{ app, db, close }` with an isolated database and all migrations; `createUser(db, { role?: 'admin' | 'editor' | 'commenter' | 'viewer', permissions?: PermissionKey[], kind?: 'member' | 'guest', siteAdmin?, name?, email? })` (`permissions` makes a one-off custom role with those keys); `injectAs(app, user, options)` signs in and sends the cookie and CSRF header. CI provides Postgres through `DATABASE_URL`.
- Seed: `node apps/server/dist/cli.js seed` loads fictional data only into an empty database (dev and the browser tests). Core creates the workspace "Care Hub", four people (`avery.admin@example.test` is site admin and Admin, `eli.editor@example.test`, `casey.commenter@example.test`, `val.viewer@example.test`, password from `CAREHUB_SEED_PASSWORD`), a team space and a few pages. Then each feature's `seed(ctx)` runs, with `ctx = { db, workspaceId, users: { admin, editor, commenter, viewer }, teamSpaceId, log }`. `ctx` also has `createRole({ name, permissions })` and `createPerson({ key, name, email, roleId })` for a lane's own test people (for example Learning's "Trainer" role). Fixtures are fictional and idempotent.
- Jobs in tests (`features/jobs/testing.ts`): `drainJobsForTest({ now? })` runs the jobs that are due; `pauseJobsForTest()` holds the runner and returns a function that lets it go again, for tests that must act before a job runs. An app built while another test app is open shares the running runner.
- Browser tests sign in with `signInAs(page, 'editor')` (a role key or a seeded person's email) from `tests/e2e/helpers/auth.ts` (core, with the sign-in screens).
- **Test hooks** (security reviewer 1's conditions; the switch is core): one switch, `testHooksEnabled(config)`, true only when `CAREHUB_TEST_HOOKS` is exactly `'1'`. With it on, start-up refuses unless the host of `CAREHUB_PUBLIC_URL` and `HOST` are both loopback. Every test-only route or setting goes through it (for example `CAREHUB_TEST_CALENDAR_ORIGINS`, and `ANTHROPIC_BASE_URL` for the Claude stub). Hook routes are registered only when it's on, under `/api/<lane>/test/`, and each is an ordinary protected route (session, CSRF, permissions). A core test checks that no `/test/` route exists when it's off. Deploy never sets it. A lane's own switch (such as `testHooksOn()`) moves to it once it lands.

## 3. Accounts, sessions and permissions (core)

### 3.1 Sessions and the current user

- Cookies: `carehub_session` (HttpOnly, Secure, SameSite=Lax, 30-day sliding, 90 days at most) and `carehub_csrf` (readable). Over HTTPS both names get the `__Host-` prefix, so never hard-code them. Every state-changing `/api` request sends the `X-CSRF-Token` header with the CSRF cookie's value, and the Origin is checked. Web code never reads the cookie itself: `lib/api.ts` sends the header, using `readCsrfToken()` from `@carehub/shared`.
- `request.user`: `{ id, email, name, avatarUrl, isSiteAdmin, timeZone, use24h, weekStart, mustChangePassword }` (`timeZone` is IANA, default `America/Denver`; `weekStart` 0 = Sunday). `null` when signed out.
- `request.member`: `{ workspaceId, roleId, roleName, permissions: ReadonlySet<PermissionKey>, isAdmin }` for the current workspace, or `null`. One workspace for now ("Care Hub"); the model allows more.
- Guards (Fastify preHandlers): `app.requireUser`, `app.requireMember`, `app.requirePermission(key)`, `app.requireSiteAdmin`. Membership is already checked for every route without `allowNonMembers` (section 2.2).
- `getMembership(db, workspaceId, userId): Promise<Member | null>` for work done outside a request, like notices (skip non-members). It doesn't check whether the account is locked.
- `addMember(db, { userId, role })` (a built-in role key), `{ userId, roleId }` or `{ userId, kind: 'guest' }`: a member always gets a role, never a default one. `removeMember(app, userId)` ends all the person's sessions and then emits `member.removed { workspaceId, userId }`: live updates close their open streams and push deletes their browsers.
- `request.sessionId`: the current session's ID (never the token), for data tied to one device, like push subscriptions. `session.ended { sessionId, userId }` is emitted when a session ends: sign-out, sign-out everywhere, a password change, a locked account, or expiry.
- On public routes a failed session lookup (for example, the database is down) counts as signed out, so `GET /api/status` can still answer.
- For the live co-editing server: read the token with `app.sessionCookies.sessionToken(request)` (it knows the cookie names), then `getUserFromSessionToken(db, token)`. Check `Origin` on the WebSocket upgrade, because the CSRF check skips GET.
- HTTP: `GET /api/auth/me` returns `{ user, member, workspace: { id, name } }`. `PATCH /api/auth/profile` takes `name`, `timeZone`, `use24h`, `weekStart`. Sign-in, sign-out, sign-out everywhere and password changes are under `/api/auth/*`.

### 3.2 Roles and permission keys

Spec: [Roles and permissions](../plan/specs/roles-and-permissions.md).

- `PermissionKey` (from `@carehub/shared`): `pages.edit`, `pages.create`, `pages.comment`, `pages.share`, `templates.manage`, `claude.use`, `learning.build`, `learning.assign`, `learning.analytics`, `guests.add`, `pages.shareLinks`, `workspace.admin` (Admin settings; built-in Admin only, never on custom roles).
- Built-in roles (per workspace, can't be changed or deleted): **Admin** (all), **Editor** (edit, create, comment, share, templates, claude.use, guests.add, pages.shareLinks), **Commenter** (comment), **Viewer** (none). Custom roles: any mix except `workspace.admin` (Settings → Roles).
- Guests have no role (`roleId: null`): `hasPermission` is false for every key, and every route refuses them unless it sets `config: { allowGuests: true }`. Their page access comes only from grants (no role limit), capped at `edit`.
- `hasPermission(member, key)` (from `@carehub/shared`) on both sides. A **site admin** (`isSiteAdmin`) manages accounts and the server. A workspace **Admin** is someone whose role has `workspace.admin`.
- Everyone, in every role, may use Home, Messages, Calendar, reminders and My learning, and fill in forms sent to them. Those routes need no permission check (membership is checked for every route).
- **Privacy (RP-D1):** admins never open other people's private spaces, chats they aren't in, private events, connected calendars, transcripts or Claude chats (403). Each lane enforces this for its own content.

### 3.3 Access to spaces, pages, databases and rows

- Levels: `'none' < 'view' < 'comment' < 'edit_content' < 'edit' < 'full'` (`AccessLevel`, `ACCESS_LEVELS` and `atLeast(level, min)` from `@carehub/shared`). `edit_content` ("Can edit content") is offered only on databases: people edit rows and their content, but not the database's properties, views or settings; rows inherit it as `edit`. Grants may also use `rows_only` ("Only rows they're in", databases only; `GrantLevel = AccessLevel | 'rows_only'`): the database page resolves to `view`, its rows inherit `none`, and the Databases lane's `row` resolver opens the rows the person appears in.
- Grants (`access_grants`) on a space or page, to a person, a role, a group or everyone, with a level. `pages.inherit_access` false means "Stop inheriting".
- The person who creates a page gets a person grant of `full` on it (still limited by role, below). A new workspace has one open team space, "General", that new members join with Can edit (SB-01); "Private" is each person's own space, not a team space.
- Effective level: take the highest grant that reaches the page (its space; its parent pages, up to the first one that stops inheriting; the page itself) for the person, their role or everyone. Then limit it by role: without `pages.edit` the most is `comment` (with `pages.comment`) or `view`; without `pages.share`, `full` works as `edit`; without `pages.comment`, `comment` works as `view`.
- Private spaces: only their owner. Team spaces: their grants; admins have `full` on every team space, never on private ones.
- Guests (membership `kind = 'guest'`; Roles and permissions spec, RP-16 to RP-26) reach pages only through grants to them or to a group they're in. Role and everyone grants don't apply to them, they never get `full`, and they have no Messages (RP-D2).
- Share links (`share_links`, a later PR) give view-only access to anyone with the link; Admins can turn links off (RP-D3). Access requests (`access_requests`): someone without access asks, and a person with `full` approves.
- Server functions, `apps/server/src/features/pages/index.ts`:
  - `getPageAccess(db, userId, pageId): Promise<AccessLevel>`
  - `getAccessForPages(db, userId, pageIds): Promise<Map<string, AccessLevel>>` (bulk; use it before showing any title, card, mention, backlink, search hit, notice or chart, so nothing leaks)
  - `app.requirePageAccess(min, (request) => pageId)` (preHandler; 404 if missing or deleted, 403 if below `min`)
  - `registerAccessResolver('row', (ctx) => Promise<AccessLevel>)`: the Databases lane adjusts a row's level from its row-access rules. `ctx = { db, userId, rowPageId, databasePageId, inherited, grantLevel }` (`grantLevel` is the `GrantLevel` that reached the database, so the lane can handle `rows_only`). The role limit still applies after it.
  - `grantAccess(tx, { spaceId? , pageId?, principal: { type: 'user' | 'role' | 'group' | 'everyone', id? }, level, grantedBy })` and `revokeAccess(tx, grantId, by)`. Nobody can grant above their own level.
  - `registerShareLinkGuard(kind, (db, pageId) => Promise<{ ok: boolean, reason? }>)`: called before a share link is made (the Databases lane refuses databases with row rules or property access).
  - `changePageKind(tx, pageId, { kind: 'page' | 'row', parentId, spaceId? }, by)` for "Move to" between a database and normal pages; emits `page.kindChanged { pageId, from, to }`.
  - `getPagePreviews(db, userId, pageIds, { maxChars })`: text previews from the stored text copy, filtered by access (Feed view, cards).
  - `getPageCards(db, userId, pageIds): Promise<Map<string, PageCard | { id, deleted: true } | { id, locked: true }>>` with `PageCard = { id, kind, title, icon: PageIcon | null, spaceName }`; no access gives `locked`. Route: `POST /api/pages/cards { ids }`, same entries. A deleted page's own `GET` is 404.

## 4. Pages (core)

### 4.1 The page model

- Table `pages`: `id` (uuid), `workspace_id`, `space_id`, `parent_id` (null at the top of a space), `kind` (`page` | `database` | `row`), `is_inline`, `title`, `icon` (JSON: `{ type: 'emoji', emoji }` or `{ type: 'icon', name, color }`), `cover` (JSON: `{ type: 'file', fileId }` or `{ type: 'preset', name }`, or null), `full_width`, `inherit_access`, `position` (fractional key), `created_by`, `created_at`, `updated_by`, `updated_at`, `deleted_at`, `deleted_by`.
- **Database rows are pages.** A full-page database is `kind = 'database'` in the page tree. An inline database is `kind = 'database'` with `is_inline = true`; its parent is the host page and it isn't in the sidebar; the host page shows it with the editor block `database` (`{ databaseId, viewId? , linkedViewId? }`). A row is `kind = 'row'`, its parent is its database page, and it never appears in the tree. A row's name is `pages.title`. Icon, cover, content, comments, mentions, backlinks, history, Trash and search work for rows as for any page. Everything else about databases (properties, values, views, templates, forms, row rules) lives in the Databases lane's `db_*` and `forms_*` tables, keyed by page ID.
- Page URL for every kind: **`/p/<pageId>`** (`pageUrl(id)` from `@carehub/shared`). Links between pages store the page ID, so they never break. Card data for a pasted link or a mention: `GET /api/pages/:id/card` returns `{ id, kind, title, icon, spaceName }`, or 403 without any title.
- Server functions for other lanes (`apps/server/src/features/pages/index.ts`, all take `Db | Tx`): `createPage(tx, { workspaceId, spaceId?, parentId?, kind, title, icon?, isInline?, createdBy })` returns the page; `setPageTitle(tx, pageId, title, by)`; `trashPage(tx, pageId, by)` and `restorePage(tx, pageId, by)` (with sub-pages and rows); `getPrivateSpaceId(tx, userId)` (creates it on first use).
- HTTP (for screens): spaces `GET/POST /api/spaces`, `PATCH/DELETE /api/spaces/:id`; tree `GET /api/spaces/:id/tree`; pages `POST /api/pages`, `GET/PATCH /api/pages/:id`, `POST /api/pages/:id/move`, `DELETE /api/pages/:id`; Trash `GET /api/trash`, `POST /api/trash/:id/restore`, `DELETE /api/trash/:id`; `GET/PUT/DELETE /api/favorites`; `GET /api/recent`; people `GET /api/workspace/members?q=` (`{ id, name, email, avatarUrl, roleId, roleName, isGuest }`, guests included).

### 4.2 Page content

- Each page's content is one Y.Doc, edited live through the collaboration server (`/api/collab`, WebSocket). The server keeps the Y.Doc and a Markdown copy in `page_docs`.
- Server functions (`apps/server/src/features/collab/index.ts`): `getPageMarkdown(db, pageId)`, `copyPageContent(tx, fromPageId, toPageId)` (row templates, Duplicate), `setPageContentFromMarkdown(tx, pageId, markdown)` (imports, notes), `getPageText(db, pageId)` (search).

### 4.3 Other core services

- **Files:** `POST /api/files` (multipart, field `file`, query `scope=<feature>:<id>`) returns `{ id, name, size, mimeType, url, width?, height? }`; `GET /api/files/:id` (supports Range and `?download=1`); `DELETE /api/files/:id`. Default limit 100 MB per file (setting `FILES_MAX_MB`; Data settings may lower it per type); the type is checked from the file's content, not its name, and programs are refused. SVG is accepted only as a picture. Every file response sends `X-Content-Type-Options: nosniff` and a sandboxing `Content-Security-Policy`; anything that isn't a picture, video, audio or PDF is sent as a download. Picture locations (EXIF GPS) are removed on upload (Pages and blocks 3.4). Each lane decides who may read its files: `registerFileScope(feature, { canRead(ctx), canWrite(ctx) })` with `ctx = { db, user, member, scopeId }` (`user` and `member` are null only in a scope registered with `allowAnonymous: true`, for anonymous forms, under the security reviewer's conditions in 0010) from `apps/server/src/features/files/index.ts`. `POST /api/files/from-url { url, scope }` copies a pasted web picture (pictures only, up to 10 MB, 5 s timeout, private and tailnet addresses refused) and returns the same shape. HEIC stays as uploaded (location removed); the web uploader turns it into JPEG first when the browser can. Server, for other features: `getFiles(db, ids): Promise<Map<string, FileInfo>>` with `FileInfo = { id, name, size, mimeType, scope, uploadedBy, createdAt }` (no access check: the caller checks its own scope) and `deleteFiles(tx, ids)` (the bytes are removed after the commit). Web: `uploadFile(file, { scope, onProgress, signal })` from `apps/web/src/lib/files.ts` (`signal` cancels).
- **People, groups and managers:** `GET /api/workspace/members` also returns `managerId` and `groupIds`; `GET /api/workspace/groups` returns `{ id, name, memberIds }[]`; admins manage groups and managers in Settings → Members (Settings and members spec). Server: `listGroupMembers(db, groupId)`, `listReports(db, managerId)`.
- **Search** (Extras lane, 0400): pages, databases and rows by title and text, filtered by access. A lane can add text for its own pages with `registerSearchText('row', (db, pageId) => Promise<string>)`.
- **Security headers:** core sends a strict Content-Security-Policy and the usual security headers on every response. `frame-src` is the admin-managed embed list (Pages and blocks, PB-D4) plus the origins a lane registers with `registerFrameSources(feature, origins)` from `apps/server/src/core/security.ts` (https only; a leading `*.` is the only wildcard). Core never imports lane packages for this. The rest of the policy: `default-src 'self'`; `script-src 'self' 'wasm-unsafe-eval'` (in-browser transcription); `style-src 'self' 'unsafe-inline'` (Radix and the editor set inline styles); `img-src 'self' data: blob:`; `connect-src 'self'` plus the WebSocket origin; `worker-src 'self'` (no `blob:`); `manifest-src 'self'`; `object-src 'none'`; `base-uri 'none'`; `form-action 'self'`; `frame-ancestors 'none'`. `Permissions-Policy` allows only `microphone=(self)` (camera off). No COEP (it would break embeds). HSTS when served over HTTPS.
- **Comments and mentions:** comments on pages and rows; '@' mentions of people, pages and dates in the editor and in comments. Mentions send a notice through Team tools' `sendNotice`. Server: `listComments(db, userId, pageId, { limit })`, filtered by access. HTTP: `POST /api/comments { pageId, text, blockId?, threadId? }` returns `{ id, threadId }` (no `threadId` starts a new thread); `GET /api/comments?pageId=` lists the page's threads.

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

- `api` from `apps/web/src/lib/api.ts`: `api.get(path, { schema? })`, `api.post/put/patch/delete(path, body?, { schema? })`. It sends cookies and the CSRF header, parses JSON (with an optional zod schema) and throws `ApiError { status, code, message }`.
- TanStack Query for server data; query keys start with the feature name (`['pages', id]`).
- Routing: React Router 7. Import from `react-router` (for example `RouterProvider`, `useNavigate`), not `react-router-dom` or `react-router/dom`.
- `useMe()` returns `{ user, member, workspace }`; `usePermission(key)`; `usePageAccess(pageId)` (from `apps/web/src/features/auth` and `features/pages`).

### 5.3 Slots (`apps/web/src/slots.ts`)

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
| `treeItemChildren` | `{ database?: Component<{ page }> }` | a database's views under it in the sidebar tree when expanded |
| `appStart` | `{ id, run(ctx: { api, navigate }) }` | run once after sign-in, from `RequireAuth` (Team tools re-sends the push subscription, opens a chat from a notification) |
| `editor` | `{ nodeViews?, slashItems?, linkPickers?, bubbleItems?, extensions? }` | React views for lane blocks by node name (`nodeViews`, e.g. `database`, meeting notes), "/database", writing help; `extensions` only for things that aren't nodes or marks |
| `overlays` | `{ id, Component }` | rendered once by the app shell, such as the Ctrl+K window (0400) |
| `pageBanners` | `{ id, order, Component<{ page }> }` | rendered by the page view above the title (0400) |

### 5.4 The editor (`@carehub/editor`)

- `BlockEditor` for page content (core), with the extension props `extensions`, `slashItems`, `linkPickers` (`{ label, pick(): Promise<string | null> }`, returning a relative link) and `bubbleItems`. Lanes add blocks through their own `lanes/<lane>.ts` file and the `editor` slot, never by editing the rest of the package. `extensions` is only for behavior (shortcuts, plugins); nodes and marks there are ignored with a console warning.
- **Core block groups** (#62): each group's schema is in `packages/editor/src/blocks/<group>.ts` (Tiptap packages only, no React) and its "/" entries and views in `blocks/<group>.ui.ts` (with the "/" menu, #69). Groups: text, lists, toggle, callout, colors, code, table, columns, tabs, math, toc, synced, page, media, embed. The builder of a group owns its two files; core owns `blocks/index.ts` and `blocks/ui.ts`.
- **Lane blocks share one schema** on the server and every client, because a client that doesn't know a node deletes it from the shared document. Each lane puts its schema-only Tiptap nodes (no React or app code; only `@tiptap/core` and `@tiptap/pm`) in `packages/editor/src/lanes/<lane>.ts`: `databases` and `forms` (Databases and Forms lane), `meetings` and `claude` (Team tools), `learning` (Learning). The lane owns that file; core owns `lanes/index.ts`, which collects them with one `// feature:` line each. `createPageSchema()` and `BlockEditor` always include them. React views come through the `editor` slot's `nodeViews`; a node without a view shows a plain "needs <feature>" box and is never deleted. Node and attribute names never change once they're on `main`.
- The collab server tells each client its build; a client on another build stops editing until it reloads.
- `RichTextField({ value, onChange, ariaLabel, placeholder?, marks?, singleLine?, autoFocus?, readOnly?, id?, ariaDescribedBy?, onPickPage?, linkPickers? })` for small rich-text fields without live co-editing (paragraphs and hard breaks). `export type { JSONContent }`.

## 6. Process

- Small PRs (under about 600 lines of non-test code), CI per decision 0006, the clean-room line in every PR description.
- All agents share one GitHub account: push in few, larger commits; never poll in a loop (check the CI comment at most every 5 minutes); on any rate-limit or abuse error wait at least 5 minutes, then 15, before trying again.
- Before merge, the security reviewer looks at every PR that adds dependencies or touches `.github/`, `deploy/`, a Dockerfile or `.npmrc` (decision 0010).
- A security reviewer checks PRs and `main` twice a day and opens GitHub issues labelled `security` plus the lane. Lane leads watch for them and fix serious ones first.
- Each night the browser tests run on `main` with everything merged; the main lead sends any breakage to the lead that owns it. The Docker image is built only on request (by hand or the `image` label): the server builds its own (0010, Deploy).

## Consequences

- Lanes can build in parallel against fixed names. Pieces that aren't on `main` yet are coded against these names and switched on when they land.
- A wrong name costs one decision record and one follow-up PR, not a lane-wide rewrite.
