# Learning lane plan (Care Hub rebuild)

Written from the spec. No code copied from AppFlowy or the old Care Hub.

Spec: the rebuild plan pages, the Learning PRD and the Learning feature tracker (behaviour only; every
tracker row counts as not built). Rulebook: "Builder rules and tech". Format contract: `course-format.md`.

## Lane (agreed with the main lead; AGENTS.md section 5 is the source of truth)

| Path | What |
|---|---|
| `packages/learning*/` (`@carehub/learning`) | Pure TypeScript + zod: course format, logic, fictional sample courses. No React, no server code. |
| `apps/web/src/features/learning/**` | Learning screens (routes `/learning/*`): My learning, catalog, start page, player; later Studio and Reports. Use `@carehub/ui` tokens and components for all UI. |
| `apps/server/src/features/learning/**` | Learning API (`/api/learning/*`) and tables, after sign-in is on main. Use `requirePermission('learning.build' / 'learning.assign' / 'learning.analytics')`. |
| `apps/server/migrations/YYYYMMDDHHMM_learning_<what>.sql` | Learning migrations. |
| `tests/e2e/learning/**` | Playwright + axe checks for Learning screens; register screens in `tests/e2e/screens.ts`. |
| `docs/learning/**` | This plan, the format contract, STATUS.md. |

Mount points (pre-approved one-line edits): replace only the `// feature: learning` line in `apps/server/src/app.ts`
and `apps/web/src/routes.tsx`; add `"@carehub/learning": "*"` to `apps/web/package.json` and `apps/server/package.json`.
The sidebar Learning item comes from the design-kit AppShell. Never touch `package-lock.json` (a bot regenerates it);
add dependencies only to our own package.json. Anything else at root level goes through the main lead.
CI on every PR push (install from cache, type check, lint, Vitest, licence check) is the only place React code
gets type-checked: nobody's computer has network. Browser tests, axe and screenshots run only when a PR has the `e2e`
label (add it with issue_write once the screens are ready; at most 2 runs per PR without asking the main lead) and
nightly on main; put the result and the screenshot-comment link in the PR body. PRs stay under about 600 lines of
non-test code (tests, fixtures and docs don't count). One GitHub account is shared by every agent: push complete
batches in few commits, never poll in a loop, back off on rate-limit errors. Push work in progress to a feat/* branch with no open PR at least every 3 hours (branch
pushes run no CI), so no work lives only on one computer; never push half-done work to a branch with an open PR. Tracker: Care Hub rebuild tracker, Learning lane rows.

## `packages/learning` layout and ownership

Dependencies: B2 and B4 use only `format`/`util`; B3 also uses B2's scoring. Merge order: B1 → B2 → B3; every other module any time after B1.
Each module has its own `index.ts`; the package `index.ts` re-exports them all and is created once, with
stub modules, by the format PR, so later PRs never edit a shared file.

| Module | Owner | Contents |
|---|---|---|
| `format/` | B1 | zod schemas (contract in `course-format.md`, incl. `QuestionResponse` and `CourseStatus`), migrations, publish checks, presets, ids, rich-text helpers |
| `util/` | B1 | seeded random (`mulberry32`, `shuffle`, `sample`), calendar-day helpers (`addDays`, `addMonths`, `daysBetween` on `YYYY-MM-DD`) |
| `fixtures/` | B1 | fictional sample courses + one learning path, all passing `parseCourse` and `checkPublishable` |
| `questions/`, `quiz/`, `scenario/` | B2 | scoring for the 8 question types, quiz attempts, scenario branching |
| `progress/`, `certificates/`, `paths/` | B3 | progress events, learner state, gating, completion, resume, certificates, learning paths |
| `reports/`, `delivery/` | B4 | report numbers, CSV, due dates, reminders, My learning buckets, catalog search |
| `api/`, `reviews/` | B1 | request/response schemas for course, catalog and review endpoints, error shape; review comments export, review-due dates |
| `player/` | B5 | player view logic: outline states, navigation, link targets, search inside a course, labels, text size |
| `authoring/` | B8 | pure editing logic, undo/redo, block catalog, paste-to-blocks, rich text to editor JSON and back |
| `banks/` | B9 | question banks, bank draws at publish, CSV question import, survey summaries |
| `media/` | B10 | file kinds and size limits, crop maths, caption (WebVTT) checks, embed allow-list |

Every module owner also keeps the zod request/response schemas for its own endpoints in its module (`<module>/api.ts`).

Pure functions only: no clocks (pass `now` / `today`), no randomness without a seed, no I/O.
The server re-runs the same functions, so it never trusts a score sent by a browser.

## Module contracts (sketch; builders refine names, not meaning)

### B2 · questions / quiz / scenario

```ts
// QuestionResponse and CourseStatus come from format (see course-format.md).
type QuestionResult = { questionId: Id; answered: boolean; correct: boolean; earned: number; max: number;
                        fraction: number;            // 0..1 partial credit, for analysis only
                        feedback: RichText | null;   // per-answer feedback first, then correct/incorrect
                        picked: Id[] };              // chosen option/pair/spot ids, for question analysis
scoreQuestion(q: Question, r: QuestionResponse | undefined): QuestionResult   // all-or-nothing points
isResponseFor(q, r)                           // QuestionResponseSchema itself lives in format
normalizeAnswer(text, caseSensitive)          // trim, collapse spaces, NFKC, case-fold unless caseSensitive

type AttemptPlan = { attemptId: Id; seed: number; questionIds: Id[]; optionOrder: Record<Id, Id[]> };
planAttempt(quiz: QuizLesson, seed: number, attemptId: Id): AttemptPlan   // pool + shuffles, deterministic
scoreAttempt(quiz, plan, responses: Record<Id, QuestionResponse>): AttemptResult
type AttemptResult = { attemptId: Id; results: QuestionResult[]; earned: number; max: number;
                       percent: number; passed: boolean };   // passed: earned*100 >= passMark*max (no rounding)
quizStatus(quiz, attempts: AttemptResult[]): { attemptsUsed; attemptsRemaining: number | null;
  bestPercent: number | null; passed: boolean; canRetry: boolean; revealAnswers: boolean }

startScenario(block): ScenarioState; chooseScenario(block, state, choiceId): { state; coaching; ended }
scenarioResult(block, state): { score; maxScore; passed: boolean | null; ending; lessonJump: Id | null }
scenarioMaxScore(block)   // best path score over the scene graph
```

### B3 · progress / certificates / paths

```ts
type ProgressEvent = { id: Id; at: IsoDateTime } & (          // id = client uuid, for de-duplication
  | { type: "lesson_opened"; lessonId: Id }
  | { type: "time_active"; lessonId: Id; seconds: number }     // 1..60 per event
  | { type: "block_completed"; lessonId: Id; blockId: Id }     // continue, process, flashcards, sorting
  | { type: "knowledge_check_answered"; lessonId: Id; blockId: Id; correct: boolean } // no typed text (0310)
  | { type: "scenario_finished"; lessonId: Id; blockId: Id; choiceIds: Id[] }
  | { type: "lesson_completed"; lessonId: Id }
  | { type: "quiz_attempt_started"; lessonId: Id; plan: AttemptPlan }
  | { type: "quiz_attempt_submitted"; lessonId: Id; attemptId: Id; responses: Record<Id, QuestionResponse> }
  | { type: "acknowledged"; statement: string } );
ProgressEventSchema (zod)
reduceProgress(course, events): LearnerCourseState   // deterministic; sorts by at, then id; drops duplicates;
                                                     // invalid or too-early events go to `rejected` with a reason
// LearnerCourseState: status not_started | in_progress | completed | passed | failed; startedAt, completedAt,
// lastActivityAt, activeSeconds, percentComplete, lessons[] (locked | not_started | in_progress | completed,
// activeSeconds, completedBlockIds, minimumMet), quizzes (quizStatus), knowledgeChecks, scenarios,
// acknowledgedAt, score (best quiz percent; mean if several quizzes), resume { lessonId, blockId? }, rejected[].
canCompleteLesson(course, state, lessonId): { ok: true } | { ok: false; reason: "locked" | "minimum_time" |
  "continue_blocks"; secondsLeft?: number; blockIds?: Id[] }
visibleBlocks(lesson, completedBlockIds): Block[]    // up to and including the first unpassed continue block
nextLesson(course, state, fromLessonId): Id | null   // honours lesson order and scenario/button lesson jumps
// Anti-tamper: each time_active counts at most 60 s; total active time can't exceed the wall-clock span of
// the events + 60 s; quiz submissions are re-scored with scoreAttempt.

createCertificateCode(randomBytes: Uint8Array): string   // "XXXX-XXXX-XXXX", Crockford base32 + check character
isCertificateCodeWellFormed(code): boolean               // catches typos; real verification is a server lookup
certificateExpiry(issuedOn: IsoDate, validForMonths?): IsoDate | null
certificateStatus(cert, today, headsUpDays = 30): "valid" | "expiring_soon" | "expired"
pathProgress(path, statusByCourse): { completed; total; percent; nextCourseId; status; lockedCourseIds }
```

### B4 · reports / delivery

```ts
// Inputs are plain rows, so reports depend only on format (no imports from progress or quiz).
type EnrollmentRow = { learnerId: Id; learnerName: string; groupIds: Id[]; courseId: Id; courseTitle: string;
  status: CourseStatus; score: number | null; activeSeconds: number; attempts: number;
  startedAt?: IsoDateTime; completedAt?: IsoDateTime; dueDate?: IsoDate; lastLessonId?: Id; required: boolean };
courseReport(rows, today)        // total, notStarted, inProgress, completed, passed, failed, overdue,
                                 // completionPercent, averageScore, averageActiveSeconds
personTranscript(rows)           // one person's courses, newest first
questionAnalysis(quiz, attempts: { results: { questionId: Id; correct: boolean; picked: Id[] }[] }[]) // per question: answered, percentCorrect, wrong picks ranked; most-missed first
dropOff(course, rows)            // where unfinished learners stopped (lastLessonId), per lesson
teamView(rows, groups, today)    // per group: counts, completion %, overdue
overdueList(rows, today)         // who, course, days late
reportsOverview(rows, today)     // active learners this week, completions, pass rate
toCsv(columns, rows)             // RFC 4180; cells starting with = + - @ are prefixed with ' (formula-injection guard)

dueStatus(dueDate, completedAt, today, soonDays = 3): "none" | "upcoming" | "due_soon" | "overdue" |
  "done_on_time" | "done_late"
remindersDue(assignment, sentLog, today): ("assigned" | "due_soon" | "overdue")[]   // assigned once, the day
                                 // before the due date, then the day after and every 3 days until finished
expandAssignments(assignments, groups): per-learner assignments   // new group members included; earliest due wins
myLearning(enrollments, assignments, catalog, today): { continue; assigned; overdue; finished; catalog }
searchCatalog(courses, query, topic?)  // listed and published only; accent- and case-insensitive
```

## Builders and tracks (v2, Oct 26: every non-Later PRD feature live by Oct 31)

Up to 8 builders at once, each keeping one track to the end. Dates are when each PR should be open.
Last PR open Oct 30; anything not ready by Oct 31 is dropped; `docs/learning/STATUS.md` by Oct 30.

**Order of work (Felipe, Oct 27):** his bar is "everything" (Notion parity, but better). Get a basic working version of
every feature onto main before polishing any one. All colours, fonts, sizes and spacing come from design-kit tokens,
with no one-off styles, because Felipe restyles Care Hub himself later.

| Builder | Track |
|---|---|
| B1 Format, base, courses, reviews | 1 scaffold, schemas, parse (Oct 27) · 2 publish checks, fixtures, JSON schema (Oct 27) · 3 web and server base: `data/` HTTP client with the offline event queue, `routes.tsx` with every route below lazy-loading each area's `index.tsx` (stubs), server `index.ts` mounting every area router (stubs), the two mount lines (Oct 27–28) · 4 courses server: tables, Studio course API (draft save with revision check, publish = new live version, versions, roll back, duplicate, archive), catalog, examples, block templates (Oct 28) · 5 reviews: share a draft by link, comments on blocks, export comments as CSV, review-due reminders for authors (Oct 29) |
| B2 Questions, quizzes, scenarios | 1 scoring (Oct 27) · 2 quiz and scenario logic, incl. survey mode and bank draws (Oct 27) · 3 answer inputs for the 8 types + knowledge check block (Oct 28) · 4 quiz lesson view: intro, attempt, results, review, retry, survey mode (Oct 28–29) · 5 scenario block view + scenario editor (Oct 29) |
| B3 Progress, certificates, paths | 1 progress and completion logic (Oct 27) · 2 certificates and paths logic (Oct 27) · 3 progress server: events, state, resume, server-side re-scoring and completion, reset and mark complete, course-changed notices and retake (Oct 28) · 4 certificates: issue, my certificates, printable page, expiry and re-certification (Oct 29) · 5 paths: API, path page, path builder, auto-assign by team (Oct 29) · 6 reports: person transcript, team view for managers, path report (Oct 30) |
| B4 Delivery and reports | 1 reports and delivery logic (Oct 27) · 2 assignments server: people and groups, due dates, calendar items, reminders job (Oct 28) · 3 assign screens (Oct 29) · 4 reports server + overview, course report (question analysis, drop-off), overdue list, CSV export, reset and mark-complete screens (Oct 29–30) |
| B5 Player and My learning | 1 player logic (Oct 27) · 2 player shell: outline sidebar (open, closed, hidden), navigation, text blocks, continue block (Oct 28) · 3 gating and settings: continue, minimum time, lesson order, acknowledgement, links to lessons and blocks, search inside a course, renamed labels, bigger text (Oct 28–29) · 4 My learning, catalog, course start page with cover layouts (Oct 29) · 5 resume, offline, phone polish (Oct 30) |
| B8 Studio | 1 authoring logic (Oct 27) · 2 course list (new from a type or an example, duplicate, archive), outline, lesson canvas, block picker, drag and keyboard reorder (Oct 28) · 3 course settings, preview as computer or phone, publish, versions and roll back, undo and redo (Oct 29) · 4 text block editors on the editor's RichTextField (Oct 29) · 5 paste text into tidy blocks, block templates (Oct 30) |
| B9 Question authoring | 1 banks, CSV import and survey logic (Oct 27) · 2 question editors for the 8 types with feedback, knowledge check editor (Oct 28) · 3 quiz lesson editor: settings, pool, bank draws, survey mode (Oct 29) · 4 banks server, bank screens, spreadsheet import (Oct 29) · 5 survey results (Oct 30) |
| B10 Media and interactive blocks | 1 media logic (Oct 27) · 2 media server (upload, serve, limits) + MediaPicker and ImageField with crop (Oct 28) · 3 media blocks, view and edit: image and layouts, gallery, labeled graphic, video and audio with captions and transcript, file, embed (Oct 29) · 4 interactive blocks, view and edit: accordion, tabs, timeline, process, flashcards, sorting, button (Oct 29–30) |

Merge order: B1.1 first; then any package PR; B1.3 before any web or server PR; B1.4 before other server PRs.

### Format additions (optional fields, no formatVersion bump; B1 adds them in PR 1)
Every field marked "Later" in course-format.md is now in scope. New:
- `QuizSettings.mode?: "graded" | "survey"` (default graded). Survey: single and multiple choice only, no right
  answers needed, no score or pass mark, one submission; it counts as done when submitted and never for requireQuizPass.
- `QuizLesson.bankDraws?: { bankId: Id; count: number; questions?: Question[] }[]` (≤ 10, count 1..50). Drafts
  keep only bankId and count; publishing copies the bank's questions into `questions` (snapshot). planAttempt draws
  `count` from each snapshot on top of the lesson's own questions (poolSize applies to the lesson's own questions).
- `CourseSettings.reviewEveryMonths?: number` (1..36): the author is reminded to check the course.
- `Course.coverLayout?: "banner" | "split" | "full"` (default banner): how the start page shows the cover picture.

### Web folders (`apps/web/src/features/learning/`)
| Folder | Owner |
|---|---|
| `routes.tsx`, `data/`, `review/` | B1 |
| `home/`, `catalog/`, `course/`, `player/`, `blocks/registry.tsx`, `blocks/text/` | B5 |
| `questions/`, `quiz/`, `scenario/`, `blocks/questions/`, `studio/editors/scenario/` | B2 |
| `certificates/`, `paths/`, `studio/paths/`, `reports/people/`, `reports/team/`, `reports/paths/` | B3 |
| `assign/`, `reports/` (the rest) | B4 |
| `studio/` (the rest), `studio/editors/registry.tsx`, `studio/editors/text/` | B8 |
| `studio/quiz/`, `studio/banks/`, `studio/editors/questions/` | B9 |
| `media/`, `blocks/media/`, `blocks/interactive/`, `studio/editors/media/`, `studio/editors/interactive/` | B10 |

Routes (B1 creates them all in PR 3, each lazy-loading the owner's `index.tsx` stub, so nobody edits routes.tsx later):
`/learning` home, `/learning/catalog`, `/learning/courses/:courseId` start page, `.../lessons/:lessonId` player (B5);
`/learning/paths/:pathId`, `/learning/certificates`, `/learning/certificates/:certificateId` (B3);
`/learning/studio`, `/learning/studio/courses/:courseId`, `.../preview` (B8); `/learning/studio/paths[/:pathId]` (B3);
`/learning/studio/banks[/:bankId]` (B9); `/learning/assign` (B4); `/learning/reports`, `/learning/reports/courses/:courseId`,
`/learning/reports/overdue` (B4); `/learning/reports/people/:personId`, `/learning/reports/team`,
`/learning/reports/paths/:pathId` (B3); `/learning/review` with the token in the fragment (B1, 0309).

### Shared web contracts
- Block views (B5 owns `blocks/registry.tsx`; creates empty family files that their owners fill):
  `type BlockViewProps<B> = { block: B; lesson: ContentLesson; course: PlayerCourse; mode: "learn" | "preview" | "review";
  state: LearnerCourseState; emit(e: NewProgressEvent): void; go(link: Link): void }` and
  `blockViews: { [T in Block["type"]]?: (p: BlockViewProps<Extract<Block, { type: T }>>) => JSX.Element }`.
  Families: text and continue (B5), media and interactive (B10), knowledge_check and scenario (B2). Unknown types
  render a plain "This block can't be shown yet" note. `PlayerCourse` is `Course | LearnerCourse` (0314, #204): the
  learner view in the player (quiz lessons have `questionCount`, no questions), the full draft in preview. Block views
  use `course` only for links and labels.
- Block editors (B8 owns `studio/editors/registry.tsx`; same pattern): `type BlockEditorProps<B> = { block: B;
  onChange(next: B): void; course: Course; lessonId: Id }`. Families: text and continue (B8), media and interactive
  (B10), knowledge_check (B9), scenario (B2).
- Quiz: B2 exports `QuizLessonView({ course, lesson, state, emit, go })` (`go(link)` follows links in prompts and
  feedback, as in `BlockViewProps`; right answers per 0316); B9 exports `QuizLessonEditor({ lesson, onChange })`;
  B5 and B8 mount them.
- Media (B10): `MediaPicker`, `ImageField({ value: Image | undefined; onChange })` and `useMediaUrl(ref: MediaRef)`.
- Rich text: one adapter, `RichTextInput` (B8, `studio/editors/text/RichTextInput.tsx`), props `{ value, onChange,
  ariaLabel, placeholder?, singleLine?, marks?, course?, id?, ariaDescribedBy?, autoFocus?, readOnly? }`; it wraps the
  editor's RichTextField and the authoring converter and is a plain text area until the editor lands (Oct 28). Everyone
  edits rich text through it. Editor family files (B8 creates them empty): `studio/editors/media/index.tsx`
  (`mediaEditors`), `interactive/index.tsx` (`interactiveEditors`) for B10, `questions/index.tsx` (`questionEditors`)
  for B9, `scenario/index.tsx` (`scenarioEditors`) for B2.
- Data: B1's `data/http.ts` (`api<T>(method, path, body?, schema)`, typed errors, the offline event queue);
  each owner writes the calls and TanStack Query hooks for its own endpoints in its own folder.

### Server (`apps/server/src/features/learning/`)
B1 creates `index.ts` mounting one router per area (stubs) and owns `courses/` and `reviews/`; B3 `progress/`,
`certificates/`, `paths/`; B4 `assignments/`, `reports/` (B3 adds its report routes in its own routers); B9 `banks/`;
B10 `media/`. Publish hooks (stubs by B1, filled by the owners): `banks/publish.ts`
`resolveBankDraws(db, workspaceId, course)` (B9; it throws `cannotPublish(problems)` from `errors.ts` itself, listing
every bank problem by title, and returns the course with bank snapshots) and `progress/on-publish.ts` `onCoursePublished(db, { courseId, version, notify })`
(B3). B1 also stubs `public.ts` (isLearningEnabled, listLearningDueDates, listMyLearning for Team tools' Calendar and Home; B4 fills it). Each owner writes its own migration `YYYYMMDDHHMM_learning_<area>.sql`. Endpoints: `api.md`.

### Learning help (Claude, 0315)
Writing help in blocks, summaries and key points, quiz questions from a lesson, and a first draft of a course. Studio
only (`learning.author`, plus `claude.use`). Calls Extras' shared client on the server (`askClaude`, `askClaudeJson`,
`isClaudeFeatureOn` from `apps/server/src/features/claude/index.ts`; feature keys, error reasons and messages from
`@carehub/extras/claude`) with the feature key `learning_help`: off until an admin switches it on, and every button is
hidden while it's off. The server loads the course text itself by id; see 0315 for the rules.
Owner: to be named. Paths: `packages/learning/src/help/`, `apps/server/src/features/learning/help/`,
`apps/web/src/features/learning/studio/help/`. B8 and B9 give it a place for its buttons (rich text toolbar, lesson
editor, New course, quiz editor).

## Every Learning PR

- Says: "Written from the spec. No code copied from AppFlowy or the old Care Hub."
- Only touches the lane paths above (never package-lock.json).
- Vitest tests for logic; Playwright + axe and light/dark, desktop/phone screenshots for screens.
- Styles only through design-kit tokens and @carehub/ui components: no hard-coded colours, fonts, sizes or spacing.
- Type check, lint and license check pass in CI. Fictional data only. No secrets. Claude features stay off until an admin switches them on.
- Updates its Learning row in the Care Hub rebuild tracker.
- The Learning lead reviews and squash-merges with `expectedHeadSha`.
