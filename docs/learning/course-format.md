# Care Hub Learning course format (v1)

Written from the spec. No code copied from AppFlowy or the old Care Hub.

This is the contract for `packages/learning/src/format`. The zod schemas must infer exactly these types
(`type Course = z.infer<typeof CourseSchema>` and so on). Every other Learning module builds on them.

## Principles

- Structured JSON only. No HTML anywhere, so content is safe to render and easy to import, version and diff.
- `formatVersion` lives on every stored document. Adding an optional field does not bump it. Renaming, removing
  or changing the meaning of a field bumps it and ships a migration in `format/migrations.ts`.
- Two levels of checking:
  1. **Schema** (structure, types, maximum sizes). Drafts must pass it, so Studio can save half-finished work.
  2. **Publish checks** (`checkPublishable`): completeness and references, returned as plain-language problems
     such as `Lesson 2 "Escalations": question 3 has no correct answer.` Publishing needs zero problems.
- Ids: `/^[A-Za-z0-9_-]{1,64}$/`. Lesson, block and question ids are unique across the course (events and
  reports use them). Nested ids (options, pairs, steps, scenes, choices…) are unique within their parent.
  Questions copied from a bank (`bankDraws[].questions`) only need ids unique within their quiz lesson, so one bank
  can feed several lessons. Names that exist on every JavaScript object (`constructor`, `__proto__`, …) are not ids.
- Every field is part of v1, including the ones once marked "Later" (they are all optional). Fields added since the
  first version of this document are marked "added".
- Fictional data only in fixtures and tests.

## Types

```ts
// ---------- Shared ----------
type Id = string;
type IsoDateTime = string;   // ISO 8601, e.g. "2026-10-27T15:00:00.000Z"
type IsoDate = string;       // "YYYY-MM-DD", a calendar day in the workspace time zone

type Mark = "bold" | "italic" | "underline" | "strike" | "code";
type Link =
  | { kind: "url"; url: string }                    // https: or mailto: only
  | { kind: "page"; pageId: string }                // a Care Hub page (knowledge base)
  | { kind: "lesson"; lessonId: Id; blockId?: Id }; // somewhere in this course
type TextRun = { text: string; marks?: Mark[]; link?: Link };
type Paragraph = { runs: TextRun[] };              // "\n" inside text = line break
type RichText = Paragraph[];                       // max 20,000 characters in total

type MediaRef =
  | { kind: "file"; fileId: string }               // Care Hub file storage
  | { kind: "url"; url: string };                  // https only; the player also applies the embed allow-list
type Image = { media: MediaRef; alt: string; caption?: string; decorative?: boolean };
// Publish check: alt may be empty only when decorative is true.

// ---------- Course ----------
const COURSE_FILE_FORMAT = "carehub.learning.course";
const COURSE_FORMAT_VERSION = 1;

type CourseType = "standard" | "scenario_lab" | "required_read" | "microlearning" | "certification";

type Course = {
  formatVersion: 1;
  id: Id;
  title: string;                 // 1..200
  summary?: string;              // ≤ 500, course card
  description?: RichText;        // start page
  cover?: Image;
  coverLayout?: "banner" | "split" | "full"; // added: how the start page shows the cover; missing = "banner"
  type: CourseType;
  topics?: string[];             // catalog tags: ≤ 10, each 1..40
  estimatedMinutes?: number;     // 1..600
  settings: CourseSettings;
  lessons: Lesson[];             // ≤ 100 (publish: ≥ 1)
};

type CourseSettings = {
  lessonOrder: "free" | "sequential";
  completion: {                  // publish: at least one true
    requireAllLessons: boolean;
    requireQuizPass: boolean;    // every quiz lesson passed (publish: needs ≥ 1 quiz lesson)
    requireAcknowledgement: boolean;
  };
  minimumCourseSeconds?: number; // 1..36000; the course can't be finished before this much active time
  acknowledgement?: { statement: string }; // ≤ 500; publish: required when requireAcknowledgement
  catalog: { listed: boolean };  // false = hidden from the catalog (link or assignment only)
  certificate: { enabled: boolean; validForMonths?: number }; // 1..120; set = re-certification
  sidebar?: "open" | "closed" | "hidden";  // player outline; missing = "open"
  labels?: Partial<Record<"start" | "continue" | "next" | "complete" | "submit" | "retry", string>>; // renamed buttons, each ≤ 40
  reviewEveryMonths?: number;    // added: 1..36; the author is reminded to check the course this often
};

type Lesson = ContentLesson | QuizLesson;

type ContentLesson = {
  id: Id; kind: "content";
  title: string;                 // 1..200
  icon?: string;                 // one emoji (1..32 characters)
  headerImage?: Image;
  minimumSeconds?: number;       // 1..3600; the lesson can't be completed sooner
  blocks: Block[];               // ≤ 300 (publish: ≥ 1)
};

type QuizLesson = {
  id: Id; kind: "quiz";
  title: string;
  intro?: RichText;
  settings: QuizSettings;
  questions: Question[];         // ≤ 200 (publish: ≥ 1 question or bank draw)
  bankDraws?: BankDraw[];        // added: ≤ 10
};

type BankDraw = {                // added
  bankId: Id;
  count: number;                 // 1..50 questions per attempt (publish: ≤ questions.length once copied)
  questions?: Question[];        // ≤ 500; drafts leave it out, publishing copies the bank's questions here
};
// Each attempt draws `count` questions from every bank draw on top of the lesson's own questions
// (poolSize applies to the lesson's own questions only).

type QuizSettings = {
  passMark: number;              // 0..100 percent
  maxAttempts: number | null;    // 1..20, null = unlimited
  shuffleQuestions: boolean;
  shuffleOptions: boolean;       // choice options, matching lists; never true/false
  poolSize?: number;             // draw this many per attempt (publish: 1..questions.length)
  revealAnswers: "never" | "after_each_attempt" | "after_passing" | "after_final_attempt";
  mode?: "graded" | "survey";    // added; missing = "graded"
};
// Survey mode: single and multiple choice only, no right answers needed, no score or pass mark, one submission.
// A survey lesson counts as done when submitted and never for requireQuizPass (publish: requireQuizPass needs
// at least one graded quiz lesson).

// ---------- Blocks (28 kinds) ----------
type BlockBase = { id: Id };

// Text
type HeadingBlock       = BlockBase & { type: "heading"; level: 1 | 2 | 3; text: string };          // ≤ 200
type ParagraphBlock     = BlockBase & { type: "paragraph"; text: RichText };
type ListBlock          = BlockBase & { type: "list"; style: "bulleted" | "numbered" | "checkbox"; items: { id: Id; text: RichText }[] }; // ≤ 100 (publish ≥ 1)
type CalloutBlock       = BlockBase & { type: "callout"; tone: "note" | "tip" | "warning" | "success"; title?: string; text: RichText };
type StatementBlock     = BlockBase & { type: "statement"; text: string };                           // ≤ 300
type QuoteBlock         = BlockBase & { type: "quote"; text: string; attribution?: string; background?: Image }; // background = quote on a picture
type QuoteCarouselBlock = BlockBase & { type: "quote_carousel"; quotes: { id: Id; text: string; attribution?: string }[] }; // ≤ 10 (publish ≥ 2)
type TwoColumnBlock     = BlockBase & { type: "two_column"; left: RichText; right: RichText };
type DividerBlock       = BlockBase & { type: "divider"; style: "line" | "numbered" | "spacer" };
type CodeBlock          = BlockBase & { type: "code"; language?: string; code: string };            // ≤ 20,000; shown, never run
type TableBlock         = BlockBase & { type: "table"; headerRow: boolean; rows: string[][] };       // ≤ 50 rows × ≤ 10 columns; publish: rectangular

// Media
type ImageBlock         = BlockBase & { type: "image"; image: Image; size: "small" | "medium" | "full";
                                        layout?: "standard" | "image_and_text" | "text_on_image" | "banner"; text?: RichText }; // missing layout = "standard"
type GalleryBlock       = BlockBase & { type: "gallery"; layout: "carousel" | "grid"; images: Image[] }; // ≤ 20 (publish ≥ 2)
type LabeledGraphicBlock= BlockBase & { type: "labeled_graphic"; image: Image;
                                        markers: { id: Id; x: number; y: number; title: string; text: RichText }[] }; // x, y: % 0..100; ≤ 20
type VideoBlock         = BlockBase & { type: "video"; media: MediaRef; title: string;
                                        captions?: { fileId: string; language: string; label?: string }[]; transcript?: RichText };
type AudioBlock         = BlockBase & { type: "audio"; media: MediaRef; title: string; transcript?: RichText };
type FileBlock          = BlockBase & { type: "file"; fileId: string; name: string; description?: string };
type EmbedBlock         = BlockBase & { type: "embed"; url: string; title: string; height?: number };  // https only; height 100..1200

// Interactive
type AccordionBlock     = BlockBase & { type: "accordion"; items: { id: Id; title: string; body: RichText }[] };  // ≤ 20 (publish ≥ 1)
type TabsBlock          = BlockBase & { type: "tabs"; tabs: { id: Id; title: string; body: RichText }[] };        // ≤ 10 (publish ≥ 2)
type TimelineBlock      = BlockBase & { type: "timeline"; items: { id: Id; label: string; title: string; body?: RichText }[] }; // ≤ 30 (publish ≥ 2)
type ProcessBlock       = BlockBase & { type: "process"; intro?: { title: string; body?: RichText };
                                        steps: { id: Id; title: string; body: RichText; image?: Image }[];       // ≤ 20 (publish ≥ 2)
                                        summary?: { title: string; body?: RichText } };
type FlashcardsBlock    = BlockBase & { type: "flashcards"; cards: { id: Id; front: string; back: string; frontImage?: Image; backImage?: Image }[] }; // ≤ 30 (publish ≥ 1)
type SortingBlock       = BlockBase & { type: "sorting"; categories: { id: Id; title: string }[];               // ≤ 4 (publish ≥ 2)
                                        items: { id: Id; text: string; categoryId: Id }[] };                     // ≤ 20 (publish ≥ 2)
type ButtonBlock        = BlockBase & { type: "button"; label: string; description?: string; target: ButtonTarget };
type ButtonTarget =
  | { kind: "url"; url: string } | { kind: "page"; pageId: string }
  | { kind: "file"; fileId: string } | { kind: "lesson"; lessonId: Id; blockId?: Id };
type ContinueBlock      = BlockBase & { type: "continue"; label?: string; requires: "click" | "complete_above" };
// Everything after a continue block stays hidden until it is passed. "complete_above" also needs every
// knowledge check, scenario, process, flashcards and sorting block since the previous continue to be completed.
type KnowledgeCheckBlock= BlockBase & { type: "knowledge_check"; question: Question; allowRetry: boolean }; // never counts towards the score
type ScenarioBlock      = BlockBase & { type: "scenario"; title: string; intro?: RichText;
                                        characters: { id: Id; name: string; role?: string; avatar?: Image }[];
                                        startSceneId: Id; scenes: ScenarioScene[]; passScore?: number };
type ScenarioScene = {
  id: Id;
  speakerId?: Id;                // a character id
  text: string;                  // what they say or what happens, ≤ 2,000
  choices: ScenarioChoice[];     // ≤ 6; empty = an ending
  ending?: { outcome: "great" | "okay" | "poor"; title: string; text?: RichText }; // publish: required when choices is empty
};
type ScenarioChoice = {
  id: Id; text: string;
  points: number;                // -10..10
  coaching?: RichText;           // coaching note shown after the choice
  next: { kind: "scene"; sceneId: Id } | { kind: "retry" } | { kind: "lesson"; lessonId: Id };
};
// Publish: startSceneId and every sceneId exist, scene links have no cycles ("retry" is not a cycle),
// every scene can reach an ending, and a "retry" choice has points ≤ 0 (added: it can be picked again and again).

type Block =
  | HeadingBlock | ParagraphBlock | ListBlock | CalloutBlock | StatementBlock | QuoteBlock | QuoteCarouselBlock
  | TwoColumnBlock | DividerBlock | CodeBlock | TableBlock
  | ImageBlock | GalleryBlock | LabeledGraphicBlock | VideoBlock | AudioBlock | FileBlock | EmbedBlock
  | AccordionBlock | TabsBlock | TimelineBlock | ProcessBlock | FlashcardsBlock | SortingBlock
  | ButtonBlock | ContinueBlock | KnowledgeCheckBlock | ScenarioBlock;

// ---------- Questions (8 types) ----------
type QuestionBase = {
  id: Id;
  prompt: RichText;
  image?: Image;
  points: number;                // 1..100 (default 1)
  feedback?: { correct?: RichText; incorrect?: RichText };
};
type ChoiceOption = { id: Id; text: string; correct: boolean; feedback?: RichText }; // per-answer feedback

type SingleChoiceQuestion   = QuestionBase & { type: "single_choice"; options: ChoiceOption[] };   // ≤ 6 (publish: 2..6, exactly 1 correct)
type MultipleChoiceQuestion = QuestionBase & { type: "multiple_choice"; options: ChoiceOption[] }; // ≤ 6 (publish: 2..6, ≥ 1 correct)
type TrueFalseQuestion      = QuestionBase & { type: "true_false"; answer: boolean; feedbackTrue?: RichText; feedbackFalse?: RichText };
type MatchPair = { id: Id; prompt: string; match: string };
type MatchingQuestion       = QuestionBase & { type: "matching"; pairs: MatchPair[] };      // pick from a list; ≤ 8 (publish ≥ 2)
type DragMatchingQuestion   = QuestionBase & { type: "drag_matching"; pairs: MatchPair[] }; // same data and scoring, drag interaction
type FillBlankQuestion      = QuestionBase & { type: "fill_blank"; parts: FillPart[] };     // publish: ≥ 1 blank
type FillPart =
  | { kind: "text"; text: string }
  | { kind: "blank"; id: Id; answers: string[]; caseSensitive?: boolean };                    // answers ≤ 10 (publish ≥ 1)
type OrderingQuestion       = QuestionBase & { type: "ordering"; items: { id: Id; text: string }[] }; // listed order is correct; ≤ 10 (publish ≥ 2)
type HotspotQuestion        = QuestionBase & { type: "hotspot"; image: Image; spots: HotspotSpot[] };   // ≤ 10 (publish: ≥ 1 correct)
type HotspotSpot = { id: Id; shape: "rect" | "ellipse"; x: number; y: number; width: number; height: number; // % of the image; x, y = top-left
                     correct: boolean; label: string }; // label = keyboard and screen-reader alternative

type Question =
  | SingleChoiceQuestion | MultipleChoiceQuestion | TrueFalseQuestion | MatchingQuestion
  | DragMatchingQuestion | FillBlankQuestion | OrderingQuestion | HotspotQuestion;

// ---------- Learner answers and statuses (stored in progress events and quiz attempts) ----------
type QuestionResponse =
  | { type: "single_choice"; optionId: Id }
  | { type: "multiple_choice"; optionIds: Id[] }
  | { type: "true_false"; value: boolean }
  | { type: "matching" | "drag_matching"; matches: Record<Id, Id> }   // pair id -> the pair id whose match was chosen
  | { type: "fill_blank"; blanks: Record<Id, string> }               // ≤ 500 characters each
  | { type: "ordering"; order: Id[] }
  | { type: "hotspot"; pick: { kind: "point"; x: number; y: number } | { kind: "spot"; spotId: Id } }; // x, y in %
type CourseStatus = "not_started" | "in_progress" | "completed" | "passed" | "failed";

// ---------- Learning paths ----------
type LearningPath = {
  formatVersion: 1;
  id: Id;
  title: string;
  description?: string;
  courseIds: Id[];               // ≤ 30, unique (publish ≥ 2)
  order: "sequential" | "free";
};

// ---------- Files (import and export) ----------
type CourseFile = { format: "carehub.learning.course"; exportedAt?: IsoDateTime; course: Course };
```

## Schema rules and limits

The schema (what every saved draft must pass) adds these rules to the comments above. `LIMITS` in
`@carehub/learning` holds every number, so editors can show character counters and disable "Add" buttons.

- **Strict objects.** Unknown keys are rejected everywhere, so a typo or smuggled HTML fails loudly instead of
  being dropped. Zod's record parsing also drops `__proto__` keys in learner answers.
- **Ids** match `/^[A-Za-z0-9_-]{1,64}$/` and are not one of the names on `Object.prototype` (`RESERVED_IDS`,
  `isReservedId`). File and page ids from other Care Hub services match `/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/`.
- **Addresses.** Media (`MediaRef` url), embeds: `https://` only. Links and button targets: `https://` or
  `mailto:`. Always a full address with a host, no spaces, no user name or password, at most 2,000 characters.
- **Dates.** `IsoDateTime` needs a time zone (`Z` or `+02:00`); `IsoDate` is a real calendar day.
- **Numbers.** Counts, seconds, minutes, months, points and heights are whole numbers. Percentages (pass mark,
  positions and sizes on images) may have decimals.
- **Caption languages** are language tags such as `en`, `es-MX` or `zh-Hant-TW`.
- **Drafts may be incomplete.** Plain text may be empty in drafts, except course, lesson and path titles, topics
  and icons; the publish checks ask for the text that matters (question prompts, option text, alt text…).

| Text | Maximum characters |
|---|---|
| Course, lesson, block and item titles, names, headings, attributions, labels on images and timelines | 200 |
| Summary, captions, alt text, descriptions, option, pair, item, scenario choice and card-front text, acknowledgement | 500 |
| Quotes, scene text, card backs, fill-in-the-blank text | 2,000 |
| Statement | 300 |
| Code | 20,000 |
| Table cell | 1,000 |
| Rich text (all runs together; at most 2,000 paragraphs of 1,000 runs) | 20,000 |
| Renamed button labels, continue labels, caption labels, code language | 40 |
| Button block label | 100 |
| Fill-in-the-blank accepted answer / learner's typed answer | 200 / 500 |

| Counts | Maximum |
|---|---|
| Lessons per course / blocks per lesson / questions per quiz lesson | 100 / 300 / 200 |
| Bank draws per quiz lesson / questions per draw / questions in a bank copy | 10 / 50 / 500 |
| List items / quotes / gallery images / labeled-graphic markers / captions per video | 100 / 10 / 20 / 20 / 10 |
| Table rows × columns | 50 × 10 |
| Accordion items / tabs / timeline items / process steps / flashcards | 20 / 10 / 30 / 20 / 30 |
| Sorting categories / sorting items | 4 / 20 |
| Scenario characters / scenes / choices per scene | 10 / 100 / 6 |
| Choice options / matching pairs / fill-in parts / answers per blank / ordering items / hotspot spots | 6 / 8 / 50 / 10 / 10 / 10 |
| Courses per learning path / path description characters | 30 / 1,000 |

| Numbers | Range |
|---|---|
| Question points | 1..100 (default 1) |
| Scenario choice points / scenario pass score | -10..10 / -1,000..1,000 |
| Quiz attempts | 1..20 or unlimited |
| Certificate validity / review reminder | 1..120 / 1..36 months |
| Minimum time per lesson / per course | 1..3,600 / 1..36,000 seconds |
| Estimated minutes | 1..600 |
| Embed height | 100..1,200 pixels |

## Functions in `format`

| Function | Does |
|---|---|
| `parseCourse(raw: unknown, options?)` | Migrates older `formatVersion`s, then validates. Returns `{ ok: true, course, migratedFrom? }` or `{ ok: false, issues: { path, message }[] }` (at most 100 issues). Never throws. `options.migrations` swaps in other migrations (tests). |
| `parseCourseFile(raw)` / `toCourseFile(course, exportedAt?)` | Same for the import/export envelope. |
| `parseLearningPath(raw)` | Same for paths. |
| `checkPublishable(course)` | Plain-language publish problems: `{ path, lessonId?, blockId?, questionId?, message }[]`. |
| `createCourse({ type, title, id? })` | A new course with the preset settings for its type (microlearning starts with one lesson). |
| `presetFor(type, { hasQuiz? })` | `{ settings: CourseSettings, quiz: QuizSettings }` defaults for the 5 course types (standard asks for a quiz pass only with `hasQuiz`). |
| `newId()` | Random id (crypto.getRandomValues), matches the id pattern. |
| `richText(…)`, `plainText(rt)` | Builders for fixtures and tests; plain text for search and CSV. |
| `allQuestions(course)` | Every question with where it lives (quiz lesson, bank draw copy or knowledge-check block). |
| `courseFileJsonSchema()` | The JSON Schema for course files, generated with `z.toJSONSchema` and committed as `docs/learning/course.schema.json` for importers (a test fails when it's out of date). |

## Preset defaults

| Type | Order | Completion | Quiz | Certificate |
|---|---|---|---|---|
| Standard | free | all lessons (+ quiz pass if there's a quiz) | pass 80 %, unlimited tries, answers after each try | off |
| Scenario lab | free | all lessons | pass 70 %, unlimited tries | off |
| Required read | sequential | all lessons + acknowledgement + quiz pass | pass 100 %, unlimited tries, answers after passing | off |
| Microlearning | free | all lessons (one short lesson) | none | off |
| Certification | sequential | all lessons + quiz pass | pass 90 %, 3 tries, shuffle on, answers after the final try | on, 12 months |
