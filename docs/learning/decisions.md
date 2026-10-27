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
