import { z } from 'zod';
import { IdSchema, LIMITS } from '../format/primitives';
import { ContentLessonSchema } from '../format/course';
import { QuestionSchema } from '../format/questions';

// Requests and answers for Learning help (docs/learning/api.md, decision 0315). Requests name the course,
// lesson and block by id with the draft's revision; the server reads the saved draft itself.

/** What writing help can do to a block's text, or to the part of it that is selected. */
export const HELP_WRITE_ACTIONS = [
  'improve',
  'fix_grammar',
  'change_tone',
  'shorter',
  'simpler',
  'continue',
] as const;
export type HelpWriteAction = (typeof HELP_WRITE_ACTIONS)[number];

export const HELP_WRITE_LABELS: Readonly<Record<HelpWriteAction, string>> = {
  improve: 'Improve writing',
  fix_grammar: 'Fix grammar',
  change_tone: 'Change tone',
  shorter: 'Make shorter',
  simpler: 'Simplify',
  continue: 'Continue writing',
};

export const HELP_TONES = ['professional', 'friendly', 'direct', 'empathetic'] as const;
export type HelpTone = (typeof HELP_TONES)[number];

export const HELP_TONE_LABELS: Readonly<Record<HelpTone, string>> = {
  professional: 'Professional',
  friendly: 'Friendly',
  direct: 'Direct',
  empathetic: 'Empathetic',
};

/** The most key points a summary has. */
export const HELP_KEY_POINTS = 8;

/** The question types Claude writes, and the most questions it writes at once. */
export const HELP_QUESTION_TYPES = ['single_choice', 'multiple_choice', 'true_false'] as const;
export type HelpQuestionType = (typeof HELP_QUESTION_TYPES)[number];
export const HELP_MAX_QUESTIONS = 10;

/** The longest description an author can give for a course draft, and the most lessons in a draft. */
export const HELP_DESCRIPTION_CHARS = 1000;
export const HELP_MAX_DRAFT_LESSONS = 8;

const RevisionSchema = z.number().int().min(1);

/**
 * Where the selection starts and ends in the block's text (`blockHelpText`), counted like JavaScript string
 * indexes. The browser never sends the text itself.
 */
export const HelpSelectionSchema = z
  .object({ start: z.number().int().min(0), end: z.number().int().min(1) })
  .refine(({ start, end }) => end > start, { error: 'Select some text first.', path: ['end'] });
export type HelpSelection = z.infer<typeof HelpSelectionSchema>;

export const HelpWriteRequestSchema = z
  .object({
    courseId: IdSchema,
    revision: RevisionSchema,
    lessonId: IdSchema,
    blockId: IdSchema,
    action: z.enum(HELP_WRITE_ACTIONS),
    tone: z.enum(HELP_TONES).optional(),
    selection: HelpSelectionSchema.optional(),
  })
  .refine(({ action, tone }) => (action === 'change_tone') === (tone !== undefined), {
    error: 'Pick a tone for Change tone, and only for it.',
    path: ['tone'],
  });
export type HelpWriteRequest = z.infer<typeof HelpWriteRequestSchema>;

/** Plain text for the author to look at before choosing Replace or Insert below. */
export const HelpWriteReplySchema = z.object({ text: z.string().min(1).max(LIMITS.richText) });
export type HelpWriteReply = z.infer<typeof HelpWriteReplySchema>;

/** A summary and key points for one lesson, or for the whole course without `lessonId`. */
export const HelpSummaryRequestSchema = z.object({
  courseId: IdSchema,
  revision: RevisionSchema,
  lessonId: IdSchema.optional(),
});
export type HelpSummaryRequest = z.infer<typeof HelpSummaryRequestSchema>;

const line = z.string().trim().min(1).max(LIMITS.shortText);

/** Claude's answer and the reply: plain text that fits the course summary and list items. */
export const HelpSummarySchema = z.object({
  summary: line,
  keyPoints: z.array(line).min(1).max(HELP_KEY_POINTS),
});
export type HelpSummary = z.infer<typeof HelpSummarySchema>;

/** Quiz questions about one lesson's text: 5 by default, of every type unless `types` narrows them. */
export const HelpQuestionsRequestSchema = z.object({
  courseId: IdSchema,
  revision: RevisionSchema,
  lessonId: IdSchema,
  count: z.number().int().min(1).max(HELP_MAX_QUESTIONS).default(5),
  types: z.array(z.enum(HELP_QUESTION_TYPES)).min(1).max(HELP_QUESTION_TYPES.length).optional(),
});
export type HelpQuestionsRequest = z.infer<typeof HelpQuestionsRequestSchema>;

const draftBase = { prompt: line, explanation: line.optional() };
const choices = z
  .array(z.object({ text: line, correct: z.boolean() }))
  .min(2)
  .max(LIMITS.options);

/** Claude's answer: questions without ids, which the server turns into course questions (`helpQuestions`). */
export const HelpQuestionDraftsSchema = z.object({
  questions: z
    .array(
      z.discriminatedUnion('type', [
        z.object({ type: z.literal('single_choice'), ...draftBase, options: choices }),
        z.object({ type: z.literal('multiple_choice'), ...draftBase, options: choices }),
        z.object({ type: z.literal('true_false'), ...draftBase, answer: z.boolean() }),
      ]),
    )
    .min(1)
    .max(HELP_MAX_QUESTIONS),
});
export type HelpQuestionDraft = z.infer<typeof HelpQuestionDraftsSchema>['questions'][number];

/** Course questions with fresh ids that pass the course checks, for Studio to add when the author accepts. */
export const HelpQuestionsReplySchema = z.object({
  questions: z.array(QuestionSchema).min(1).max(HELP_MAX_QUESTIONS),
});
export type HelpQuestionsReply = z.infer<typeof HelpQuestionsReplySchema>;

/** A first draft of lessons from the author's own short description, which goes to Claude as the selection. */
export const HelpCourseDraftRequestSchema = z.object({
  courseId: IdSchema,
  revision: RevisionSchema,
  description: z.string().trim().min(1).max(HELP_DESCRIPTION_CHARS),
  lessons: z.number().int().min(1).max(HELP_MAX_DRAFT_LESSONS).default(4),
});
export type HelpCourseDraftRequest = z.infer<typeof HelpCourseDraftRequestSchema>;

const title = z.string().trim().min(1).max(LIMITS.title);
const paragraphs = z.string().trim().min(1).max(LIMITS.longText);

/** Claude's answer: a summary and lessons of simple text blocks, without ids (`helpCourseDraft` adds them). */
export const HelpCourseDraftAnswerSchema = z.object({
  summary: line,
  lessons: z
    .array(
      z.object({
        title,
        blocks: z
          .array(
            z.discriminatedUnion('type', [
              z.object({ type: z.literal('heading'), text: title }),
              z.object({ type: z.literal('paragraph'), text: paragraphs }),
              z.object({
                type: z.literal('list'),
                style: z.enum(['bulleted', 'numbered']),
                items: z.array(line).min(1).max(12),
              }),
              z.object({
                type: z.literal('callout'),
                tone: z.enum(['note', 'tip', 'warning']),
                text: paragraphs,
              }),
            ]),
          )
          .min(1)
          .max(20),
      }),
    )
    .min(1)
    .max(HELP_MAX_DRAFT_LESSONS),
});
export type HelpCourseDraftAnswer = z.infer<typeof HelpCourseDraftAnswerSchema>;
export type HelpDraftLesson = HelpCourseDraftAnswer['lessons'][number];

/** The summary, and content lessons with fresh ids that pass the course checks, for Studio to add. */
export const HelpCourseDraftReplySchema = z.object({
  summary: line,
  lessons: z.array(ContentLessonSchema).min(1).max(HELP_MAX_DRAFT_LESSONS),
});
export type HelpCourseDraftReply = z.infer<typeof HelpCourseDraftReplySchema>;
