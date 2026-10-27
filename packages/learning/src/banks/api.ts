import { z } from 'zod';
import { IdSchema, IsoDateTimeSchema, QUESTION_TYPES } from '../format/index';
import { BANK_LIMITS, QuestionBankSchema } from './bank';
import { QUESTION_CSV_MAX_CHARACTERS, type QuestionCsvError } from './import';
import type { SurveySummary } from './survey';

// Request and reply schemas for the question bank and survey endpoints (docs/learning/api.md), shared by the
// server routes and the studio screens.

const CountSchema = z.number().int().min(0);

/** A bank's save counter. A save based on an older revision is refused with 409, so nobody overwrites someone else's work. */
export const BankRevisionSchema = CountSchema;

/** One bank in the list: its questions are only counted. */
export const BankSummarySchema = z.object({
  id: IdSchema,
  title: z.string(),
  description: z.string().optional(),
  questionCount: CountSchema,
  updatedAt: IsoDateTimeSchema,
});
export type BankSummary = z.infer<typeof BankSummarySchema>;

/** Reply to `GET /studio/banks`: the workspace's banks. */
export const BankListSchema = z.array(BankSummarySchema);

/** `POST /studio/banks`: a new, empty bank. The reply is a `BankReplySchema`. */
export const CreateBankRequestSchema = z.strictObject({
  title: z
    .string()
    .trim()
    .min(1, { error: 'Give the bank a title.' })
    .max(BANK_LIMITS.title, { error: `Keep the title to ${BANK_LIMITS.title} characters.` }),
  description: z
    .string()
    .trim()
    .max(BANK_LIMITS.description, {
      error: `Keep the description to ${BANK_LIMITS.description} characters.`,
    })
    .optional(),
});
export type CreateBankRequest = z.infer<typeof CreateBankRequestSchema>;

/** Reply to `GET /studio/banks/:id` and `POST /studio/banks`: the bank and the revision to send with the next save. */
export const BankReplySchema = z.object({
  bank: QuestionBankSchema,
  revision: BankRevisionSchema,
  updatedAt: IsoDateTimeSchema,
});
export type BankReply = z.infer<typeof BankReplySchema>;

/** `PUT /studio/banks/:id`: the whole bank (its id must match the path) and the revision it was based on. */
export const SaveBankRequestSchema = z.strictObject({
  bank: QuestionBankSchema,
  revision: BankRevisionSchema,
});
export type SaveBankRequest = z.infer<typeof SaveBankRequestSchema>;

/** Reply to a save: the new revision. */
export const SaveBankReplySchema = z.object({ revision: BankRevisionSchema });

/** `POST /studio/banks/:id/import`: spreadsheet text (CSV) whose questions go at the end of the bank. */
export const ImportQuestionsRequestSchema = z.strictObject({
  csv: z.string().max(QUESTION_CSV_MAX_CHARACTERS, {
    error: 'This file is too big. Import at most about 2 MB at a time.',
  }),
});
export type ImportQuestionsRequest = z.infer<typeof ImportQuestionsRequestSchema>;

const QuestionCsvErrorSchema = z.object({
  row: z.number().int().min(1),
  column: z.string().optional(),
  message: z.string(),
}) satisfies z.ZodType<QuestionCsvError>;

/** Reply to an import: how many questions went in, and the rows left out with what to fix (`parseQuestionCsv`). */
export const ImportQuestionsReplySchema = z.object({
  added: CountSchema,
  errors: z.array(QuestionCsvErrorSchema),
});
export type ImportQuestionsReply = z.infer<typeof ImportQuestionsReplySchema>;

/** Reply to `GET /reports/courses/:id/surveys/:lessonId`: answer counts per question, without names (`summarizeSurvey`). */
export const SurveySummarySchema = z.object({
  lessonId: IdSchema,
  submissions: CountSchema,
  questions: z.array(
    z.object({
      questionId: IdSchema,
      type: z.enum(QUESTION_TYPES),
      prompt: z.string(),
      answered: CountSchema,
      answers: z.array(
        z.object({
          optionId: IdSchema,
          text: z.string(),
          count: CountSchema,
          percent: z.number().int().min(0).max(100).nullable(),
        }),
      ),
    }),
  ),
}) satisfies z.ZodType<SurveySummary>;
