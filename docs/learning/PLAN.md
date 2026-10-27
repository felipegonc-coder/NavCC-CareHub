# Learning plan (technical)

Written from the spec. No code copied from AppFlowy or the old Care Hub.

How the Learning code is laid out and how its parts fit together. Format contract: `course-format.md`. Endpoints:
`api.md`. Choices: `decisions.md`. What is on main: `STATUS.md`.

## Paths (AGENTS.md section 5 is the source of truth)

| Path | What |
|---|---|
| `packages/learning*/` (`@carehub/learning`) | Pure TypeScript + zod: course format, logic, fictional sample courses. No React, no server code. |
| `apps/web/src/features/learning/**` | Learning screens (routes `/learning/*`): My learning, catalog, start page, player; later Studio and Reports. Use `@carehub/ui` tokens and components for all UI. |
| `apps/server/src/features/learning/**` | Learning API (`/api/learning/*`) and tables, after sign-in is on main. Use `requirePermission('learning.build' / 'learning.assign' / 'learning.analytics')`. |
| `apps/server/migrations/YYYYMMDDHHMM_learning_<what>.sql` | Learning migrations. |
| `tests/e2e/learning/**` | Playwright + axe checks for Learning screens; register screens in `tests/e2e/screens.ts`. |
| `docs/learning/**` | This plan, the format contract, STATUS.md. |

Mount points: the `// feature: learning` lines in `apps/server/src/app.ts` and `apps/web/src/routes.tsx`, and
`"@carehub/learning": "*"` in `apps/web/package.json` and `apps/server/package.json`. The sidebar Learning item comes
from the design-kit AppShell.

## `packages/learning` layout

Dependencies: `questions`/`quiz`/`scenario` and `reports`/`delivery` use only `format`/`util`; `progress`/`certificates`/`paths`
also use the scoring in `questions` and `quiz`. Each module has its own `index.ts`; the package `index.ts` re-exports
them all.

| Module | Contents |
|---|---|
| `format/` | zod schemas (contract in `course-format.md`, incl. `QuestionResponse` and `CourseStatus`), migrations, publish checks, presets, ids, rich-text helpers |
| `util/` | seeded random (`mulberry32`, `shuffle`, `sample`), calendar-day helpers (`addDays`, `addMonths`, `daysBetween` on `YYYY-MM-DD`), the Learning day (`LEARNING_DAY_ZONE`, `learningToday`, `profileZone`; 0317) |
| `fixtures/` | fictional sample courses + one learning path, all passing `parseCourse` and `checkPublishable` |
| `questions/`, `quiz/`, `scenario/` | scoring for the 8 question types, quiz attempts, scenario branching |
| `progress/`, `certificates/`, `paths/` | progress events, learner state, gating, completion, resume, certificates, learning paths |
| `reports/`, `delivery/` | report numbers, CSV, due dates, reminders, My learning buckets, catalog search |
| `api/`, `reviews/` | request/response schemas for course, catalog and review endpoints, error shape; review comments export, review-due dates |
| `player/` | player view logic: outline states, navigation, link targets, search inside a course, labels, text size |
| `authoring/` | pure editing logic, undo/redo, block catalog, paste-to-blocks, rich text to editor JSON and back |
| `banks/` | question banks, bank draws at publish, CSV question import, survey summaries |
| `media/` | file kinds and size limits, crop maths, caption (WebVTT) checks, embed allow-list |

Each module keeps the zod request/response schemas for its own endpoints in `<module>/api.ts`.

Pure functions only: no clocks (pass `now` / `today`), no randomness without a seed, no I/O.
The server re-runs the same functions, so it never trusts a score sent by a browser.

## Module contracts (sketch)

### questions / quiz / scenario

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

### progress / certificates / paths

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

### reports / delivery

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

## Scope

Every non-Later PRD feature. Order of work and styling: decision 0301.

### Format additions (optional fields, no formatVersion bump)
Every field marked "Later" in course-format.md is now in scope. New:
- `QuizSettings.mode?: "graded" | "survey"` (default graded). Survey: single and multiple choice only, no right
  answers needed, no score or pass mark, one submission; it counts as done when submitted and never for requireQuizPass.
- `QuizLesson.bankDraws?: { bankId: Id; count: number; questions?: Question[] }[]` (≤ 10, count 1..50). Drafts
  keep only bankId and count; publishing copies the bank's questions into `questions` (snapshot). planAttempt draws
  `count` from each snapshot on top of the lesson's own questions (poolSize applies to the lesson's own questions).
- `CourseSettings.reviewEveryMonths?: number` (1..36): the author is reminded to check the course.
- `Course.coverLayout?: "banner" | "split" | "full"` (default banner): how the start page shows the cover picture.

### Web folders (`apps/web/src/features/learning/`)
| Folder | Area |
|---|---|
| `routes.tsx`, `data/`, `review/` |
| `home/`, `catalog/`, `course/`, `player/`, `blocks/registry.tsx`, `blocks/text/` |
| `questions/`, `quiz/`, `scenario/`, `blocks/questions/`, `studio/editors/scenario/` |
| `certificates/`, `paths/`, `studio/paths/`, `reports/people/`, `reports/team/`, `reports/paths/` |
| `assign/`, `reports/` (the rest) | Assignments and reports |
| `studio/` (the rest), `studio/editors/registry.tsx`, `studio/editors/text/` |
| `studio/quiz/`, `studio/banks/`, `studio/editors/questions/` |
| `media/`, `blocks/media/`, `blocks/interactive/`, `studio/editors/media/`, `studio/editors/interactive/` |

Routes (all in `routes.tsx`, each lazy-loading its area's `index.tsx`):
`/learning` home, `/learning/catalog`, `/learning/courses/:courseId` start page, `.../lessons/:lessonId` player;
`/learning/paths/:pathId`, `/learning/certificates`, `/learning/certificates/:certificateId`;
`/learning/studio`, `/learning/studio/courses/:courseId`, `.../preview`; `/learning/studio/paths[/:pathId]`;
`/learning/studio/banks[/:bankId]`; `/learning/assign`; `/learning/reports`, `/learning/reports/courses/:courseId`,
`/learning/reports/overdue`; `/learning/reports/people/:personId`, `/learning/reports/team`,
`/learning/reports/paths/:pathId`; `/learning/review` with the token in the fragment (0309).

### Shared web contracts
- Block views (`blocks/registry.tsx`, with one family file per group of block types):
  `type BlockViewProps<B> = { block: B; lesson: ContentLesson; course: PlayerCourse; mode: "learn" | "preview" | "review";
  state: LearnerCourseState; emit(e: NewProgressEvent): void; go(link: Link): void }` and
  `blockViews: { [T in Block["type"]]?: (p: BlockViewProps<Extract<Block, { type: T }>>) => JSX.Element }`.
  Families: text and continue, media and interactive, knowledge_check and scenario. Unknown types
  render a plain "This block can't be shown yet" note. `PlayerCourse` is `Course | LearnerCourse` (0314, #204): the
  learner view in the player (quiz lessons have `questionCount`, no questions), the full draft in preview. Block views
  use `course` only for links and labels.
- Block editors (`studio/editors/registry.tsx`, same pattern): `type BlockEditorProps<B> = { block: B;
  onChange(next: B): void; course: Course; lessonId: Id }`. Families: text and continue, media and interactive,
  knowledge_check, scenario.
- Quiz: `quiz/` exports `QuizLessonView({ course, lesson, state, emit, go })` (`go(link)` follows links in prompts
  and feedback, as in `BlockViewProps`; right answers per 0316); `studio/quiz/` exports
  `QuizLessonEditor({ lesson, onChange })`. The player and the Studio lesson editor mount them.
- Media: `MediaPicker`, `ImageField({ value: Image | undefined; onChange })` and `useMediaUrl(ref: MediaRef)`.
- Rich text: one adapter, `RichTextInput` (`studio/editors/text/RichTextInput.tsx`), props `{ value, onChange,
  ariaLabel, placeholder?, singleLine?, marks?, course?, id?, ariaDescribedBy?, autoFocus?, readOnly? }`; it wraps the
  editor's RichTextField and the authoring converter and is a plain text area until the editor lands. Everyone
  edits rich text through it. Editor family files: `studio/editors/media/index.tsx` (`mediaEditors`),
  `interactive/index.tsx` (`interactiveEditors`), `questions/index.tsx` (`questionEditors`) and `scenario/index.tsx`
  (`scenarioEditors`).
- Data: `data/http.ts` (`api<T>(method, path, body?, schema)`, typed errors, the offline event queue);
  each area writes the calls and TanStack Query hooks for its own endpoints in its own folder.

### Server (`apps/server/src/features/learning/`)
`index.ts` mounts one router per area: `courses/`, `reviews/`, `progress/`, `certificates/`, `paths/`,
`assignments/`, `reports/` (the person, team and path reports sit in the progress, certificates and paths routers),
`banks/` and `media/`. Publish hooks: `banks/publish.ts` `resolveBankDraws(db, workspaceId, course)` (it throws `cannotPublish(problems)` from `errors.ts` itself, listing
every bank problem by title, and returns the course with bank snapshots) and `progress/on-publish.ts` `onCoursePublished(db, { courseId, version, notify })`.
`public.ts` gives Team tools' Calendar and Home `isLearningEnabled`, `listLearningDueDates` and `listMyLearning`. Each
area has its own migration `YYYYMMDDHHMM_learning_<area>.sql`. Endpoints: `api.md`.

### Learning help (Claude, 0315)
Writing help in blocks, summaries and key points, quiz questions from a lesson, and a first draft of a course. Studio
only (`learning.author`, plus `claude.use`). Calls Extras' shared client on the server (`askClaude`, `askClaudeJson`,
`isClaudeFeatureOn` from `apps/server/src/features/claude/index.ts`; feature keys, error reasons and messages from
`@carehub/extras/claude`) with the feature key `learning_help`: off until an admin switches it on, and every button is
hidden while it's off. The server loads the course text itself by id; see 0315 for the rules.
Paths: `packages/learning/src/help/`, `apps/server/src/features/learning/help/`,
`apps/web/src/features/learning/studio/help/`. Studio gives it a place for its buttons (rich text toolbar, lesson
editor, New course, quiz editor).

## Every Learning PR

- Says: "Written from the spec. No code copied from AppFlowy or the old Care Hub."
- Only touches the Learning paths above (never package-lock.json).
- Vitest tests for logic; Playwright + axe and light/dark, desktop/phone screenshots for screens.
- Styles only through design-kit tokens and @carehub/ui components: no hard-coded colours, fonts, sizes or spacing.
- Type check, lint and license check pass in CI. Fictional data only. No secrets. Claude features stay off until an admin switches them on.
