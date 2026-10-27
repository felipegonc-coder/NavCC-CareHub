# Learning decisions (0301–0399)

Written from the spec. No code copied from AppFlowy or the old Care Hub.

Short records of choices made in the Learning lane. Newest last. Shared contracts live in
`docs/decisions/0007-shared-contracts.md`; the main lead's answers in decision 0010.

## 0301 · Order of work and styling (Felipe, Oct 27)
Felipe's bar for Friday Oct 31 is "everything" (Notion parity, but better). Every builder gets a basic working
version of every feature in their track onto main before polishing any one. All colours, fonts, sizes and spacing
come from design-kit tokens and `@carehub/ui` components, with no one-off styles, because Felipe restyles Care Hub
himself later.

## 0302 · Learners never receive graded quiz answers
- `GET /courses/:id` (B1) sends the learner view: `learnerCourse(course)` (B2, `quiz/`) drops the questions of
  graded quiz lessons and the bank-draw copies, keeping id, title, settings and a question count.
- `POST /courses/:id/quizzes/:lessonId/attempts` (B3) plans the attempt on the server (`planAttempt` with a server
  seed), stores the plan, records `quiz_attempt_started` and returns `{ attemptId, questions }`, where
  `quizPaper(quiz, plan)` (B2) writes each question without its answer: no `correct` flags or feedback, blanks
  without accepted answers, matching answers shuffled under per-attempt ids, ordering items shuffled, hotspot
  spots without `correct`. `paperResponses(quiz, plan, responses)` (B2) maps the answers back before scoring.
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
- Editing: B8's `RichTextInput` (`studio/editors/text/`) is the only rich-text input; it ships first as a small PR
  with `studio/editors/registry.tsx` and the empty editor family files, a plain text area until `RichTextField`
  lands.
- Showing: B5's `RichTextView({ value, course, go })` (`blocks/text/`), built on `linkTarget`, is the only
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
- It opens one draft read-only, plus comments on its blocks, and nothing else. Signed-in people only (Felipe's
  default), so there is no public route.

## 0310 · Learner events carry no typed text
- Events that can wait in the offline queue carry ids, choices and numbers only: `knowledge_check_answered` is
  `{ lessonId, blockId, correct }` (practice; only "answered" counts for continue blocks).
- `quiz_attempt_submitted` is never queued: the quiz view posts it at once with `sendNow` (a quiz needs a
  connection, 0302).
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
- `GET /courses/:id` (B1) returns the learner view of the version of the learner's latest run, else the live
  version, with `version`. B3 provides `runVersion(db, { workspaceId, userId, courseId })` in the progress
  server; B1 provides `getCourseVersion(db, workspaceId, courseId, version)`. `GET /courses/:id/progress` and the
  quiz attempts route use the same version. There is no `?version=` parameter.

## 0312 · Reset and mark complete need `learning.assign`
People with only `learning.analytics` see reports but get no Reset or Mark complete; those need `learning.assign`.

## 0313 · Learning notices have one button
Every Learning notice has one in-app button: "Open course" (`/learning/courses/:courseId`) for learners,
"Open in Studio" (`/learning/studio/courses/:courseId`) for authors, "Open certificate"
(`/learning/certificates/:certificateId`) for certificate expiry. Course titles only go to people who can see the
course.

## 0314 · Quiz papers: surveys too, plain shuffles, per-attempt ids
Adds to 0302 (B2, #192).
- `learnerCourse(course)` removes the questions and bank-draw copies of every quiz lesson, surveys included, and
  keeps id, title, intro, settings and `questionCount`. Every quiz, graded or survey, starts on the server and
  gets its questions from the paper.
- Shuffles are plain random orders, so the listed order can come up (never allowing it would give away a
  two-item answer). `shuffleOptions` covers choice options only; matching answers and ordering items are always
  shuffled.
- On the paper, matching answers and ordering items get per-attempt ids (`match-1`, `item-1`, … in the order
  shown); choice option and hotspot spot ids stay real. `paperResponses(quiz, plan, responses)` maps answers
  back before `scoreAttempt`.
- Who does what: B1's `GET /courses/:id` sends `learnerCourse(course)`. B3's attempts route sends
  `quizPaper(lesson, plan)` as `questions`, and the submit step in `progress/reduce.ts` calls `paperResponses`
  first. B9's Studio label for `shuffleOptions` says it shuffles choice options.
