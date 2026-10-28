# Learning decisions (0301–0399)

Written from the spec. No code copied from AppFlowy or the old Care Hub.

Short records of choices made in the Learning lane. Newest last. Shared contracts live in
`docs/decisions/0007-shared-contracts.md`, and answers on shared questions in decision 0010.

## 0301 · Order of work and styling
Every builder gets a basic working version of every feature in their track onto main before polishing any one.
All colours, fonts, sizes and spacing come from design-kit tokens and `@carehub/ui` components, with no one-off
styles, so Care Hub can be restyled later from the tokens alone.

## 0302 · Learners never receive graded quiz answers
- `GET /courses/:id` sends the learner view: `learnerCourse(course)` (in `quiz/`) drops the questions of
  graded quiz lessons and the bank-draw copies, keeping id, title, settings and a question count.
- `POST /courses/:id/quizzes/:lessonId/attempts` plans the attempt on the server (`planAttempt` with a server
  seed), stores the plan, records `quiz_attempt_started` and returns `{ attemptId, questions }`, where
  `quizPaper(quiz, plan)` writes each question without its answer: no `correct` flags or feedback, blanks
  without accepted answers, matching answers shuffled under per-attempt ids, ordering items shuffled, hotspot
  spots without `correct`. `paperResponses(quiz, plan, responses)` maps the answers back before scoring.
- Browsers never send `quiz_attempt_started`. `quiz_attempt_submitted` still goes through `POST /courses/:id/events`;
  the server re-scores, and the returned state carries the result per question (right or wrong, feedback) and the
  right answers only when the quiz settings reveal them.
- Knowledge checks, scenarios, sorting and flashcards are practice: their answers stay in the course so feedback
  is instant and works offline. The server still re-checks anything that counts towards completion.
- Studio preview works on the author's full draft and plans attempts locally.
- A quiz needs a connection to start and to submit; the quiz view says so in plain words.

## 0303 · Progress events are stored in full
The progress server stores every event that passes `ProgressEventSchema`, refused or not (unique per learner,
course and event id), and reduces the whole history on each read and write, so an event refused for arriving
before an older offline event counts once that one arrives. At most 200 events per request and 20,000 per
learner and course; beyond that the server answers 422 in plain words.

## 0304 · Bank saves carry a revision
Like course drafts: `GET /studio/banks/:id` returns `{ bank, revision, updatedAt }` and `PUT { bank, revision }`
answers 409 when someone saved first, so two authors never overwrite a shared bank.

## 0305 · Files go through core only
- Learning has no upload route. Files use core's files API (0007 §4.3): web `uploadFile(file, { scope:
  'learning:<courseId>', onProgress, signal })`, server `registerFileScope('learning', { canRead: canSeeCourse,
  canWrite: canEditCourse })`. The stand-in (#70) closes once core's `POST /api/files` is on main.
- Pictures from other sites are copied into Care Hub (core's `POST /api/files/from-url` when it exists; until then
  the picker says to download and upload the picture). Video from other sites plays only through the embed
  allow-list. Direct links to media files on other sites aren't played (the CSP has no media-src for them); the
  editor says to upload the file instead.
- Embeds: `registerFrameSources('learning', EMBED_FRAME_ORIGINS)` once core `security.ts` has it.

## 0306 · Rich text: one input, one view
- Editing: `RichTextInput` (`studio/editors/text/`) is the only rich-text input; it ships first as a small PR
  with `studio/editors/registry.tsx` and the empty editor family files, a plain text area until `RichTextField`
  lands.
- Showing: `RichTextView({ value, course, go })` (`blocks/text/`), built on `linkTarget`, is the only
  read-only rich-text view (lesson text, feedback, transcripts, accordion and tab bodies). Until it lands, others
  use a one-line stand-in that is swapped out.

## 0307 · Search inside a course shows locked lessons
Search results include locked lessons; opening one explains in plain words what to finish first or when it opens.

## 0308 · Shared family files
Whoever reaches main first creates a shared family file (for example `studio/editors/questions/index.tsx`) in the
agreed shape from PLAN.md, empty apart from its export; its owner then fills it. Nobody adds the same file twice.

## 0309 · Review links
- The link is `/learning/review#<token>`: the token sits in the fragment, which browsers never send, and the
  browser passes it to the API in the `X-Review-Token` header, never in a path or query, so it stays out of logs.
- Token: 32 random bytes (base64url), stored only as a SHA-256 hash and shown once, when the link is made.
- A link expires after 7, 30 (default) or 90 days, and the author can stop sharing it at any time.
- It opens one draft read-only, plus comments on its blocks, and nothing else. Signed-in people only, so there is no
  public route.

## 0310 · Learner events carry no typed text
- Events that can wait in the offline queue carry ids, choices and numbers only: `knowledge_check_answered` is
  `{ lessonId, blockId, correct }` (practice; only "answered" counts for continue blocks).
- `quiz_attempt_submitted` is never queued: it is posted at once, after the events already waiting (a quiz needs
  a connection, 0302).
- The queue is cleared on sign-out, other people's queued events are dropped on start, and the person always
  comes from the signed-in session.
- API paths are built with `apiPath(...)`, which encodes each segment and refuses `.`, `..` (also as `%2e`) and
  `\`; screens check route params with `IdSchema` first and show "not found" otherwise.
- Calendar and Home call `public.ts` with the signed-in person's id, and every `href` is an in-app `/learning/` path.

## 0311 · Learners keep the version they started
- Each learner's run is pinned to the course version it started on and reduced against that version, so editing
  a published course never breaks anyone mid-course. Finished runs keep their result.
- Publish options: **none**: nobody moves. **tell**: runs in progress move to the new version with their events
  replayed, and those learners get the alert; finished runs stay. **retake**: everyone who started, finished or
  not, begins a new run on the new version and gets the reminder.
- `GET /courses/:id` returns the learner view of the version of the learner's latest run, else the live
  version, with `version`. The progress server provides `runVersion(db, { workspaceId, userId, courseId })`
  and the courses server `getCourseVersion(db, workspaceId, courseId, version)`. `GET /courses/:id/progress` and the
  quiz attempts route use the same version. There is no `?version=` parameter.

## 0312 · Reset and mark complete need `learning.assign`
People with only `learning.analytics` see reports but get no Reset or Mark complete; those need `learning.assign`.

## 0313 · Learning notices have one button
Every Learning notice has one in-app button: "Open course" (`/learning/courses/:courseId`) for learners,
"Open in Studio" (`/learning/studio/courses/:courseId`) for authors, "Open certificate"
(`/learning/certificates/:certificateId`) for certificate expiry. Course titles only go to people who can see the
course.

## 0314 · Quiz papers: surveys too, plain shuffles, per-attempt ids
Adds to 0302 (#192).
- `learnerCourse(course)` removes the questions and bank-draw copies of every quiz lesson, surveys included, and
  keeps id, title, intro, settings and `questionCount`. Every quiz, graded or survey, starts on the server and
  gets its questions from the paper.
- Shuffles are plain random orders, so the listed order can come up (never allowing it would give away a
  two-item answer). `shuffleOptions` covers choice options only; matching answers and ordering items are always
  shuffled.
- On the paper, matching answers and ordering items get per-attempt ids (`match-1`, `item-1`, … in the order
  shown); choice option and hotspot spot ids stay real. `paperResponses(quiz, plan, responses)` maps answers
  back before `scoreAttempt`.
- Where: `GET /courses/:id` sends `learnerCourse(course)`. The attempts route sends
  `quizPaper(lesson, plan)` as `questions`, and the submit step in `progress/reduce.ts` calls `paperResponses`
  first. The Studio label for `shuffleOptions` says it shuffles choice options.

## 0315 · Learning help uses the shared Claude client
Learning help (writing help in blocks, summaries and key points, quiz questions from a lesson, a first draft of a
course) calls Extras' shared Claude client on the server: `askClaude`, `askClaudeJson` and `isClaudeFeatureOn` from
`apps/server/src/features/claude/index.ts`, with feature keys, error reasons and messages from `@carehub/extras/claude`.
Its feature key is `learning_help` (workspace setting `claude.learning_help`). The whole Care Hub has one key, one
monthly cap, one usage log split by feature, and one admin page (Settings → Claude).
- Off by default. While it's off, Learning shows no Claude buttons.
- Authors only (`learning.build`), in Studio. The shared client also needs `claude.use`.
- The server loads the course text itself, by course, lesson and block id, after Learning's own access check, and
  passes it as `documents`. It never sends text the browser says came from a course, so Studio saves the draft first.
- Only course content is sent: titles, lesson and block text. Never learner names, emails, answers, scores or
  progress.
- Summaries, key points, quiz questions and course drafts use `askClaudeJson` with Learning's own zod schemas, then
  the normal course checks. The reply is untrusted text: no raw HTML, a link in it keeps only its text, and nothing
  is saved until the author accepts it.
- A `ClaudeError` is answered with the shared client's `claudeHttpError(reason)`: its status, code and plain
  words, plus `details: { reason }`.
- Writing help on part of a block passes it as `selection`, cut on the server from the saved block text: the
  browser sends the block id and where the selection starts and ends in its plain text, never the text itself.
- Every help request carries the draft's `revision`, and the server answers 409 when the saved draft has changed
  since, so the selection always matches the saved text.
- A first draft of a course starts from the author's own short description (with a length cap), sent as their
  instruction, never as a document. Drafting from a knowledge-base page waits until Pages has a page loader with
  its access checks on main.

## 0316 · Right answers go out only after an attempt, in the paper's ids
Adds to 0302 and 0314.
- `paperAnswerKey(quiz, plan)` in `quiz/` gives each paper question's right answer as a `QuestionResponse` in
  the paper's ids (the per-attempt `match-…` and `item-…` ids; choice option and hotspot spot ids stay real).
  Fill-in blanks get their first accepted answer, hotspots their first right spot. Surveys have none.
- The progress server sends it as `answers` with a submitted attempt's results in the learner's quiz state (the reply to
  `POST /courses/:id/events` and `GET /courses/:id/progress`), only while `quizStatus(...).revealAnswers` is true.
  Never while an attempt is open, never in reports or CSVs, and only to the learner. Trainers see right answers in
  Studio.
- `QuizLessonView` shows the right answers next to the learner's when `answers` is there; otherwise only right
  or wrong and the feedback.

## 0317 · Times show in the person's profile time zone
- Times of day (started, finished, last active, sent) show in the signed-in person's profile time zone:
  `user.timeZone` from `GET /api/auth/me`, or `America/Denver` when it's empty. Never the browser's time zone.
- Calendar days (`IsoDate`: due dates, expiry dates) show as stored, with no time-zone shift.
- "Overdue", "due soon" and "expiring soon" compare against today in `America/Denver` (`LEARNING_DAY_ZONE`), on the
  server and in the browser, so everyone sees the same status on the same day.
- Web: `useProfileTimeZone()` and `LEARNING_DAY_ZONE` in `apps/web/src/features/learning/data/timeZone.ts` (query key
  `['auth', 'me']`, through core's api client). Learning screens format times through it.
- Package and server: `LEARNING_DAY_ZONE`, `learningToday(now)` and `profileZone(timeZone)` in `@carehub/learning`
  (`util/days.ts`). The server imports the first two from `features/learning/day.ts`. Jobs use the jobs runner's
  `now`, so its test hook can run them at any time.
