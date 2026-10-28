# Learning API (`/api/learning/*`)

Written from the spec. No code copied from AppFlowy or the old Care Hub.

JSON over HTTP, signed-in users only (except where noted), validated with zod on both sides. Errors:
`{ error: { code: string; message: string; issues?: { path: string; message: string }[] } }` with 400, 401, 403
(missing permission), 404, 409 (stale revision), 422 (publish problems). Request/response schemas live in the
owner's package module (`<module>/api.ts`). The server re-runs the shared logic; it never trusts scores or
completion sent by a browser. Permissions: build = `learning.build`, assign = `learning.assign`,
analytics = `learning.analytics` (managers see their own teams).

| Owner | Method and path | Who | In → out |
|---|---|---|---|
| B1 | GET `/studio/courses?archived=` | build | → CourseSummary[] (id, title, type, state draft/live/changed, version, updatedAt, archived, listed) |
| B1 | POST `/studio/courses` | build | { type, title?, exampleId? } → { course, revision } |
| B1 | GET / PUT `/studio/courses/:id` | build | → { course, revision, liveVersion } / { course, revision } → { revision } or 409 |
| B1 | POST `/studio/courses/:id/publish` | build | { notify: none, tell or retake; note? } → { version } or 422 with checkPublishable issues |
| B1 | GET `/studio/courses/:id/versions`, POST `.../rollback` | build | → versions / { version } → { version } (roll back = publish a copy of that version) |
| B1 | POST `/studio/courses/:id/duplicate`, `/archive`, `/unarchive` | build | → CourseSummary |
| B1 | GET `/studio/examples`; GET, POST `/studio/block-templates`, DELETE `/studio/block-templates/:id` | build | example courses to copy; { name, blocks } |
| B1 | GET `/catalog?q=&topic=` | anyone | → CatalogEntry[] (live, listed, not archived) |
| B1 | GET `/courses/:id` | anyone | → { course (the version of the learner's latest run, else live, 0311; learner view: `learnerCourse(course)` removes the questions and bank-draw copies of every quiz lesson, surveys too, and adds `questionCount`, decisions 0302 and 0314), version } (hidden courses open by link; drafts never) |
| B1 | POST, GET `/studio/courses/:id/review-links`, DELETE `/studio/review-links/:linkId` | build | → { id, url, expiresAt } (url `/learning/review#<token>`, token shown once) / list without tokens; DELETE stops sharing |
| B1 | GET `/review`, POST `/review/comments` (token in the `X-Review-Token` header, 0309) | signed in, with the link | → { course (draft), comments } / { lessonId, blockId?, body } → Comment |
| B1 | GET `/studio/courses/:id/comments` (+ `.csv`), PATCH `/studio/comments/:id` | build | → Comment[] / { resolved } |
| B3 | GET `/courses/:id/progress`, POST `/courses/:id/events` | the learner | → LearnerCourseState / { events } → { state, rejected } (idempotent by event id) |
| B3 | POST `/courses/:id/quizzes/:lessonId/attempts` | the learner | → { attemptId, questions: QuizPaperQuestion[] } (the server plans the attempt with its own seed, records quiz_attempt_started and sends the question paper with no answers; browsers never send quiz_attempt_started; decisions 0302 and 0314) |
| B3 | POST `/people/:personId/courses/:courseId/reset`, `.../complete` | assign (0312) | { note? } → state |
| B3 | GET `/certificates`, GET `/certificates/:id` | the learner, analytics | → Certificate[] / Certificate |
| B3 | GET `/paths/:id`; GET, POST `/studio/paths`, GET, PUT, DELETE `/studio/paths/:id` | anyone / build | → { path, progress } / LearningPath |
| B3 | GET `/reports/people/:personId`, `/reports/team`, `/reports/paths/:id` (+ `?format=csv`) | analytics, self for own transcript | report rows |
| B4 | GET `/me` | the learner | → MyLearning (continue, assigned, overdue, finished) |
| B4 | GET, POST `/assignments`, DELETE `/assignments/:id` | assign | { target: course or path, people, groups, dueDate? or dueInDays? } → Assignment[] |
| B4 | server functions in `apps/server/src/features/learning/public.ts` (stub by B1), read by Team tools for the Calendar layer and Home | server only | `isLearningEnabled(workspaceId)`; `listLearningDueDates({ userId, workspaceId, from, to })` → `{ assignmentId, courseId, title, dueDate: YYYY-MM-DD, href }[]`; `listMyLearning({ userId, workspaceId, limit })` → `{ courseId, title, dueDate, overdue, progressPercent, href }[]`, already filtered to that person |
| B4 | GET `/reports/overview`, `/reports/courses/:id`, `/reports/overdue` (+ `?format=csv`) | analytics | report rows (course report includes question analysis and drop-off) |
| B9 | GET, POST `/studio/banks`; GET, PUT, DELETE `/studio/banks/:id`; POST `/studio/banks/:id/import` | build | GET → { bank, revision, updatedAt }; PUT { bank, revision } → { revision } or 409 when someone saved first (decision 0304) / { csv } → { added, errors[] } |
| B9 | GET `/reports/courses/:id/surveys/:lessonId` | analytics | → answer counts per question (no names) |
| B10 | no Learning endpoint: files go through the core files API (0007 section 4.3): web `uploadFile(file, { scope: 'learning:<courseId>', onProgress })`, `POST /api/files?scope=learning:<id>`; server `registerFileScope('learning', { canRead, canWrite })` (canRead: the person can see the course; canWrite: learning.build). No Learning upload route (decision 0305): the stand-in (#70) closes once core's `POST /api/files` is on main; `uploadFile` also takes an AbortSignal (`signal`) for Cancel | | |

## Learning help (Claude, decision 0315)

Claude help for authors in Studio, behind the `learning_help` switch in Settings → Claude (off by default; Studio
shows no help buttons while `GET /api/claude/status` says it's off). Every route is a POST that needs build, and
only the shared client in `apps/server/src/features/claude` talks to Claude. The browser sends ids, the draft's
`revision` and, for a selection, offsets; the server reads the saved draft after Learning's access check, cuts the
selection itself and sends course text only. Nothing is saved: Studio changes the draft only when the author
accepts an answer. Shapes live in `help/api.ts`.

| Method and path | Who | In → out |
|---|---|---|
| POST `/help/write` | build | { courseId, revision, lessonId, blockId, action: improve, fix_grammar, change_tone (with tone: professional, friendly, direct or empathetic), shorter, simpler or continue; selection?: { start, end } } → { text } (plain text, no links) |

Offsets are string indexes into `blockHelpText(block)`: the block's text parts, blank ones left out, joined by a
blank line. Continue writing reads the block up to `selection.end` (or all of it) and answers with the new text
only. Errors: 404 for a course, lesson or block that isn't there; 409 `conflict` when the saved draft is no longer
at `revision` (reload); 400 for a selection outside the block or no text to work on. Refusals from the shared
client keep its status, code and message (`CLAUDE_ERRORS` in `@carehub/extras/claude`) and add
`details: { reason }`, for example 409 with `{ reason: 'switched_off' }`.

Jobs (daily, once the main lane's scheduler or a simple interval exists): reminders for assignments (B4),
certificate expiry heads-up (B3), review-due reminders for authors (B1). Every notice goes through Team tools'
`sendNotice({ workspaceId, userId, kind: 'reminder' | 'alert', sender: 'Learning', icon?, title, text?, card?,
buttons?: { label, href }[] })` from `apps/server/src/features/notices/index.ts`; keep course titles out of the text
when the person might not have access. Every Learning table has `workspace_id`, and every query is scoped to the signed-in person's workspace.

Main-lane hooks (0007): people and groups from `GET /api/workspace/members` (each with groupIds and managerId) and
`GET /api/workspace/groups` (`{ id, name, memberIds }[]`), on the server `listGroupMembers(db, groupId)` and
`listReports(db, managerId)` (0007 section 4.3, Oct 29). Embeds: call `registerFrameSources('learning', EMBED_FRAME_ORIGINS)`
from our server plugin once core's security.ts has it (about Oct 28); https origins only, a leading `*.` is the only
wildcard. Page access levels: use `atLeast()`, never a hardcoded list. Tiptap nodes for Learning blocks inside pages
go in `packages/editor/src/lanes/learning.ts` (our file; never rename a node or attribute once on main).
PRs that add dependencies or touch .github/, deploy/, a Dockerfile or .npmrc need the security reviewer's OK first. Jobs: Team tools' `registerJobHandler` / `scheduleJob` / `registerPeriodicTask`;
until they land, our own interval guarded by `pg_try_advisory_lock`. Never email. E2E data: `seed(ctx)` in
`apps/server/src/features/learning/seed.ts` (fictional, idempotent; B1 stubs one seed function per area);
browser tests sign in as Tara Trainer (`signInAs(page, 'tara.trainer@example.test')`, role Trainer from the seed) plus one
no-access check with `'editor'`, and list screens in `tests/e2e/learning/screens.ts`.
Test hooks, for browser tests only: on when `CAREHUB_TEST_HOOKS=1` (moving to core's `testHooksEnabled()`, which is
always off in production). `POST /test/assignments/:id { dueDate }` moves an assignment's due date; it needs
`learning.assign` and works in the caller's own workspace. The assignment reminders job runs through the jobs
runner's hook, `POST /api/jobs/test/periodic/learning.reminders { now? }` (site admins), as of `now`.
Outside-folder one-liners (feature lines, the seed line, `@carehub/learning` and dnd-kit in the apps' package.json)
all go in B1's PR 3, which the main lead merges; every other Learning PR stays inside our folders.
