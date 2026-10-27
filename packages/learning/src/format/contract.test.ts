// Contract test: the zod schemas must infer exactly the types in docs/learning/course-format.md.
// The types below are copied from that document (plus the optional fields added since: they are marked "added").
// If this file stops compiling, either the schemas or the document drifted; fix whichever is wrong.
import { afterEach, describe, expect, it } from 'vitest';
import type * as F from './index';
import {
  BLOCK_TYPES,
  COURSE_FILE_FORMAT,
  COURSE_FORMAT_VERSION,
  COURSE_TYPES,
  LEARNING_PATH_FORMAT_VERSION,
  QUESTION_TYPES,
} from './index';

// ---------- Shared ----------
type Id = string;
type IsoDateTime = string;
type IsoDate = string;

type Mark = 'bold' | 'italic' | 'underline' | 'strike' | 'code';
type Link =
  | { kind: 'url'; url: string }
  | { kind: 'page'; pageId: string }
  | { kind: 'lesson'; lessonId: Id; blockId?: Id };
type TextRun = { text: string; marks?: Mark[]; link?: Link };
type Paragraph = { runs: TextRun[] };
type RichText = Paragraph[];

type MediaRef = { kind: 'file'; fileId: string } | { kind: 'url'; url: string };
type Image = { media: MediaRef; alt: string; caption?: string; decorative?: boolean };

// ---------- Course ----------
type CourseType = 'standard' | 'scenario_lab' | 'required_read' | 'microlearning' | 'certification';

type Course = {
  formatVersion: 1;
  id: Id;
  title: string;
  summary?: string;
  description?: RichText;
  cover?: Image;
  coverLayout?: 'banner' | 'split' | 'full'; // added
  type: CourseType;
  topics?: string[];
  estimatedMinutes?: number;
  settings: CourseSettings;
  lessons: Lesson[];
};

type CourseSettings = {
  lessonOrder: 'free' | 'sequential';
  completion: {
    requireAllLessons: boolean;
    requireQuizPass: boolean;
    requireAcknowledgement: boolean;
  };
  minimumCourseSeconds?: number;
  acknowledgement?: { statement: string };
  catalog: { listed: boolean };
  certificate: { enabled: boolean; validForMonths?: number };
  sidebar?: 'open' | 'closed' | 'hidden';
  labels?: Partial<Record<'start' | 'continue' | 'next' | 'complete' | 'submit' | 'retry', string>>;
  reviewEveryMonths?: number; // added
};

type Lesson = ContentLesson | QuizLesson;

type ContentLesson = {
  id: Id;
  kind: 'content';
  title: string;
  icon?: string;
  headerImage?: Image;
  minimumSeconds?: number;
  blocks: Block[];
};

type QuizLesson = {
  id: Id;
  kind: 'quiz';
  title: string;
  intro?: RichText;
  settings: QuizSettings;
  questions: Question[];
  bankDraws?: BankDraw[]; // added
};

type BankDraw = {
  // added
  bankId: Id;
  count: number;
  questions?: Question[];
};

type QuizSettings = {
  passMark: number;
  maxAttempts: number | null;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  poolSize?: number;
  revealAnswers: 'never' | 'after_each_attempt' | 'after_passing' | 'after_final_attempt';
  mode?: 'graded' | 'survey'; // added
};

// ---------- Blocks (28 kinds) ----------
type BlockBase = { id: Id };

type HeadingBlock = BlockBase & { type: 'heading'; level: 1 | 2 | 3; text: string };
type ParagraphBlock = BlockBase & { type: 'paragraph'; text: RichText };
type ListBlock = BlockBase & {
  type: 'list';
  style: 'bulleted' | 'numbered' | 'checkbox';
  items: { id: Id; text: RichText }[];
};
type CalloutBlock = BlockBase & {
  type: 'callout';
  tone: 'note' | 'tip' | 'warning' | 'success';
  title?: string;
  text: RichText;
};
type StatementBlock = BlockBase & { type: 'statement'; text: string };
type QuoteBlock = BlockBase & {
  type: 'quote';
  text: string;
  attribution?: string;
  background?: Image;
};
type QuoteCarouselBlock = BlockBase & {
  type: 'quote_carousel';
  quotes: { id: Id; text: string; attribution?: string }[];
};
type TwoColumnBlock = BlockBase & { type: 'two_column'; left: RichText; right: RichText };
type DividerBlock = BlockBase & { type: 'divider'; style: 'line' | 'numbered' | 'spacer' };
type CodeBlock = BlockBase & { type: 'code'; language?: string; code: string };
type TableBlock = BlockBase & { type: 'table'; headerRow: boolean; rows: string[][] };

type ImageBlock = BlockBase & {
  type: 'image';
  image: Image;
  size: 'small' | 'medium' | 'full';
  layout?: 'standard' | 'image_and_text' | 'text_on_image' | 'banner';
  text?: RichText;
};
type GalleryBlock = BlockBase & { type: 'gallery'; layout: 'carousel' | 'grid'; images: Image[] };
type LabeledGraphicBlock = BlockBase & {
  type: 'labeled_graphic';
  image: Image;
  markers: { id: Id; x: number; y: number; title: string; text: RichText }[];
};
type VideoBlock = BlockBase & {
  type: 'video';
  media: MediaRef;
  title: string;
  captions?: { fileId: string; language: string; label?: string }[];
  transcript?: RichText;
};
type AudioBlock = BlockBase & {
  type: 'audio';
  media: MediaRef;
  title: string;
  transcript?: RichText;
};
type FileBlock = BlockBase & { type: 'file'; fileId: string; name: string; description?: string };
type EmbedBlock = BlockBase & { type: 'embed'; url: string; title: string; height?: number };

type AccordionBlock = BlockBase & {
  type: 'accordion';
  items: { id: Id; title: string; body: RichText }[];
};
type TabsBlock = BlockBase & { type: 'tabs'; tabs: { id: Id; title: string; body: RichText }[] };
type TimelineBlock = BlockBase & {
  type: 'timeline';
  items: { id: Id; label: string; title: string; body?: RichText }[];
};
type ProcessBlock = BlockBase & {
  type: 'process';
  intro?: { title: string; body?: RichText };
  steps: { id: Id; title: string; body: RichText; image?: Image }[];
  summary?: { title: string; body?: RichText };
};
type FlashcardsBlock = BlockBase & {
  type: 'flashcards';
  cards: { id: Id; front: string; back: string; frontImage?: Image; backImage?: Image }[];
};
type SortingBlock = BlockBase & {
  type: 'sorting';
  categories: { id: Id; title: string }[];
  items: { id: Id; text: string; categoryId: Id }[];
};
type ButtonBlock = BlockBase & {
  type: 'button';
  label: string;
  description?: string;
  target: ButtonTarget;
};
type ButtonTarget =
  | { kind: 'url'; url: string }
  | { kind: 'page'; pageId: string }
  | { kind: 'file'; fileId: string }
  | { kind: 'lesson'; lessonId: Id; blockId?: Id };
type ContinueBlock = BlockBase & {
  type: 'continue';
  label?: string;
  requires: 'click' | 'complete_above';
};
type KnowledgeCheckBlock = BlockBase & {
  type: 'knowledge_check';
  question: Question;
  allowRetry: boolean;
};
type ScenarioBlock = BlockBase & {
  type: 'scenario';
  title: string;
  intro?: RichText;
  characters: { id: Id; name: string; role?: string; avatar?: Image }[];
  startSceneId: Id;
  scenes: ScenarioScene[];
  passScore?: number;
};
type ScenarioScene = {
  id: Id;
  speakerId?: Id;
  text: string;
  choices: ScenarioChoice[];
  ending?: { outcome: 'great' | 'okay' | 'poor'; title: string; text?: RichText };
};
type ScenarioChoice = {
  id: Id;
  text: string;
  points: number;
  coaching?: RichText;
  next: { kind: 'scene'; sceneId: Id } | { kind: 'retry' } | { kind: 'lesson'; lessonId: Id };
};

type Block =
  | HeadingBlock
  | ParagraphBlock
  | ListBlock
  | CalloutBlock
  | StatementBlock
  | QuoteBlock
  | QuoteCarouselBlock
  | TwoColumnBlock
  | DividerBlock
  | CodeBlock
  | TableBlock
  | ImageBlock
  | GalleryBlock
  | LabeledGraphicBlock
  | VideoBlock
  | AudioBlock
  | FileBlock
  | EmbedBlock
  | AccordionBlock
  | TabsBlock
  | TimelineBlock
  | ProcessBlock
  | FlashcardsBlock
  | SortingBlock
  | ButtonBlock
  | ContinueBlock
  | KnowledgeCheckBlock
  | ScenarioBlock;

// ---------- Questions (8 types) ----------
type QuestionBase = {
  id: Id;
  prompt: RichText;
  image?: Image;
  points: number;
  feedback?: { correct?: RichText; incorrect?: RichText };
};
type ChoiceOption = { id: Id; text: string; correct: boolean; feedback?: RichText };

type SingleChoiceQuestion = QuestionBase & { type: 'single_choice'; options: ChoiceOption[] };
type MultipleChoiceQuestion = QuestionBase & { type: 'multiple_choice'; options: ChoiceOption[] };
type TrueFalseQuestion = QuestionBase & {
  type: 'true_false';
  answer: boolean;
  feedbackTrue?: RichText;
  feedbackFalse?: RichText;
};
type MatchPair = { id: Id; prompt: string; match: string };
type MatchingQuestion = QuestionBase & { type: 'matching'; pairs: MatchPair[] };
type DragMatchingQuestion = QuestionBase & { type: 'drag_matching'; pairs: MatchPair[] };
type FillBlankQuestion = QuestionBase & { type: 'fill_blank'; parts: FillPart[] };
type FillPart =
  | { kind: 'text'; text: string }
  | { kind: 'blank'; id: Id; answers: string[]; caseSensitive?: boolean };
type OrderingQuestion = QuestionBase & { type: 'ordering'; items: { id: Id; text: string }[] };
type HotspotQuestion = QuestionBase & { type: 'hotspot'; image: Image; spots: HotspotSpot[] };
type HotspotSpot = {
  id: Id;
  shape: 'rect' | 'ellipse';
  x: number;
  y: number;
  width: number;
  height: number;
  correct: boolean;
  label: string;
};

type Question =
  | SingleChoiceQuestion
  | MultipleChoiceQuestion
  | TrueFalseQuestion
  | MatchingQuestion
  | DragMatchingQuestion
  | FillBlankQuestion
  | OrderingQuestion
  | HotspotQuestion;

// ---------- Learner answers and statuses ----------
type QuestionResponse =
  | { type: 'single_choice'; optionId: Id }
  | { type: 'multiple_choice'; optionIds: Id[] }
  | { type: 'true_false'; value: boolean }
  | { type: 'matching' | 'drag_matching'; matches: Record<Id, Id> }
  | { type: 'fill_blank'; blanks: Record<Id, string> }
  | { type: 'ordering'; order: Id[] }
  | {
      type: 'hotspot';
      pick: { kind: 'point'; x: number; y: number } | { kind: 'spot'; spotId: Id };
    };
type CourseStatus = 'not_started' | 'in_progress' | 'completed' | 'passed' | 'failed';

// ---------- Learning paths ----------
type LearningPath = {
  formatVersion: 1;
  id: Id;
  title: string;
  description?: string;
  courseIds: Id[];
  order: 'sequential' | 'free';
};

// ---------- Files (import and export) ----------
type CourseFile = { format: 'carehub.learning.course'; exportedAt?: IsoDateTime; course: Course };

// ---------- Checks ----------
// Normalize flattens intersections (BlockBase & {...}) into plain objects, all the way down, so the
// comparison is about shape only. Equal is the strict "identical types" check.
type Normalize<T> = T extends readonly (infer U)[]
  ? Normalize<U>[]
  : T extends object
    ? { [K in keyof T]: Normalize<T[K]> }
    : T;
type Equal<A, B> =
  (<T>() => T extends Normalize<A> ? 1 : 2) extends <T>() => T extends Normalize<B> ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

export type FormatContract = [
  Expect<Equal<F.Id, Id>>,
  Expect<Equal<F.IsoDateTime, IsoDateTime>>,
  Expect<Equal<F.IsoDate, IsoDate>>,
  Expect<Equal<F.Mark, Mark>>,
  Expect<Equal<F.Link, Link>>,
  Expect<Equal<F.TextRun, TextRun>>,
  Expect<Equal<F.Paragraph, Paragraph>>,
  Expect<Equal<F.RichText, RichText>>,
  Expect<Equal<F.MediaRef, MediaRef>>,
  Expect<Equal<F.Image, Image>>,
  Expect<Equal<F.CourseType, CourseType>>,
  Expect<Equal<F.Course, Course>>,
  Expect<Equal<F.CourseSettings, CourseSettings>>,
  Expect<Equal<F.Lesson, Lesson>>,
  Expect<Equal<F.ContentLesson, ContentLesson>>,
  Expect<Equal<F.QuizLesson, QuizLesson>>,
  Expect<Equal<F.BankDraw, BankDraw>>,
  Expect<Equal<F.CoverLayout, NonNullable<Course['coverLayout']>>>,
  Expect<Equal<F.QuizSettings, QuizSettings>>,
  Expect<Equal<F.HeadingBlock, HeadingBlock>>,
  Expect<Equal<F.ParagraphBlock, ParagraphBlock>>,
  Expect<Equal<F.ListBlock, ListBlock>>,
  Expect<Equal<F.CalloutBlock, CalloutBlock>>,
  Expect<Equal<F.StatementBlock, StatementBlock>>,
  Expect<Equal<F.QuoteBlock, QuoteBlock>>,
  Expect<Equal<F.QuoteCarouselBlock, QuoteCarouselBlock>>,
  Expect<Equal<F.TwoColumnBlock, TwoColumnBlock>>,
  Expect<Equal<F.DividerBlock, DividerBlock>>,
  Expect<Equal<F.CodeBlock, CodeBlock>>,
  Expect<Equal<F.TableBlock, TableBlock>>,
  Expect<Equal<F.ImageBlock, ImageBlock>>,
  Expect<Equal<F.GalleryBlock, GalleryBlock>>,
  Expect<Equal<F.LabeledGraphicBlock, LabeledGraphicBlock>>,
  Expect<Equal<F.VideoBlock, VideoBlock>>,
  Expect<Equal<F.AudioBlock, AudioBlock>>,
  Expect<Equal<F.FileBlock, FileBlock>>,
  Expect<Equal<F.EmbedBlock, EmbedBlock>>,
  Expect<Equal<F.AccordionBlock, AccordionBlock>>,
  Expect<Equal<F.TabsBlock, TabsBlock>>,
  Expect<Equal<F.TimelineBlock, TimelineBlock>>,
  Expect<Equal<F.ProcessBlock, ProcessBlock>>,
  Expect<Equal<F.FlashcardsBlock, FlashcardsBlock>>,
  Expect<Equal<F.SortingBlock, SortingBlock>>,
  Expect<Equal<F.ButtonBlock, ButtonBlock>>,
  Expect<Equal<F.ButtonTarget, ButtonTarget>>,
  Expect<Equal<F.ContinueBlock, ContinueBlock>>,
  Expect<Equal<F.KnowledgeCheckBlock, KnowledgeCheckBlock>>,
  Expect<Equal<F.ScenarioBlock, ScenarioBlock>>,
  Expect<Equal<F.ScenarioScene, ScenarioScene>>,
  Expect<Equal<F.ScenarioChoice, ScenarioChoice>>,
  Expect<Equal<F.Block, Block>>,
  Expect<Equal<F.ChoiceOption, ChoiceOption>>,
  Expect<Equal<F.SingleChoiceQuestion, SingleChoiceQuestion>>,
  Expect<Equal<F.MultipleChoiceQuestion, MultipleChoiceQuestion>>,
  Expect<Equal<F.TrueFalseQuestion, TrueFalseQuestion>>,
  Expect<Equal<F.MatchPair, MatchPair>>,
  Expect<Equal<F.MatchingQuestion, MatchingQuestion>>,
  Expect<Equal<F.DragMatchingQuestion, DragMatchingQuestion>>,
  Expect<Equal<F.FillBlankQuestion, FillBlankQuestion>>,
  Expect<Equal<F.FillPart, FillPart>>,
  Expect<Equal<F.OrderingQuestion, OrderingQuestion>>,
  Expect<Equal<F.HotspotQuestion, HotspotQuestion>>,
  Expect<Equal<F.HotspotSpot, HotspotSpot>>,
  Expect<Equal<F.Question, Question>>,
  Expect<Equal<F.QuestionResponse, QuestionResponse>>,
  Expect<Equal<F.CourseStatus, CourseStatus>>,
  Expect<Equal<F.LearningPath, LearningPath>>,
  Expect<Equal<F.CourseFile, CourseFile>>,
  Expect<Equal<(typeof BLOCK_TYPES)[number], Block['type']>>,
  Expect<Equal<(typeof QUESTION_TYPES)[number], Question['type']>>,
  Expect<Equal<(typeof COURSE_TYPES)[number], CourseType>>,
  Expect<Equal<typeof COURSE_FILE_FORMAT, 'carehub.learning.course'>>,
  Expect<Equal<typeof COURSE_FORMAT_VERSION, 1>>,
];

// A deliberately wrong shape must fail the check, or the check proves nothing.
export type ContractSelfTest = [
  Expect<Equal<Equal<F.Image, { media: MediaRef; alt: string }>, false>>,
  Expect<Equal<Equal<F.Image, Image & { extra: string }>, false>>,
  Expect<
    Equal<Equal<F.QuizSettings, Omit<QuizSettings, 'mode'> & { mode: 'graded' | 'survey' }>, false>
  >,
];

describe('course format contract', () => {
  it('has the documented constants', () => {
    expect(COURSE_FILE_FORMAT).toBe('carehub.learning.course');
    expect(COURSE_FORMAT_VERSION).toBe(1);
    expect(LEARNING_PATH_FORMAT_VERSION).toBe(1);
  });

  it('lists every block, question and course type once, in document order', () => {
    expect(BLOCK_TYPES).toHaveLength(28);
    expect(new Set(BLOCK_TYPES).size).toBe(28);
    expect(QUESTION_TYPES).toEqual([
      'single_choice',
      'multiple_choice',
      'true_false',
      'matching',
      'drag_matching',
      'fill_blank',
      'ordering',
      'hotspot',
    ]);
    expect(COURSE_TYPES).toEqual([
      'standard',
      'scenario_lab',
      'required_read',
      'microlearning',
      'certification',
    ]);
  });
});

// ---------- TEMPORARY CI probe (server and databases, node); removed in the next push ----------
// Runs other workspaces' tests inside this file so their failures show in the CI report.
declare global {
  interface ImportMeta {
    glob(pattern: string | string[]): Record<string, () => Promise<unknown>>;
  }
}
const probeFailures: string[] = [];
afterEach(({ task }) => {
  if (task.result?.state !== 'fail') return;
  const names = [task.name];
  for (let suite = task.suite; suite?.suite; suite = suite.suite) names.unshift(suite.name);
  const message = task.result.errors?.[0]?.message ?? '';
  probeFailures.push(`${names.join(' > ')}: ${message.slice(0, 200)}`);
});
const probeTests = import.meta.glob([
  '../../../../apps/server/src/**/*.test.ts',
  '../../../../apps/server/test/**/*.test.ts',
  '../../../../packages/databases/src/**/*.test.ts',
  '../../../../packages/databases/test/**/*.test.ts',
]);
for (const [file, load] of Object.entries(probeTests)) {
  describe(file, async () => {
    try {
      await load();
    } catch (error) {
      probeFailures.push(`${file} did not load: ${String(error).slice(0, 300)}`);
    }
  });
}
it('probe: the other tests were found and pass', () => {
  expect(Object.keys(probeTests).length).toBeGreaterThan(0);
  expect(probeFailures).toEqual([]);
});
