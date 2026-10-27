import { z } from 'zod';
import {
  IdSchema,
  LIMITS,
  newId,
  parseWith,
  QuestionSchema,
  type FormatIssue,
  type Id,
  type Question,
} from '../format/index';
import { idAllocator } from './internal';

/** The version of the question bank format. Bump only together with a migration, as for courses. */
export const QUESTION_BANK_FORMAT_VERSION = 1;

/** Size limits for question banks, for the bank editor and the import screen. */
export const BANK_LIMITS = {
  title: LIMITS.title,
  description: 1_000,
  /** 500, so a whole bank fits in one bank-draw snapshot. */
  questions: LIMITS.bankSnapshotQuestions,
} as const;

/** A shared question bank: questions that quizzes in many courses can draw from. Question ids are unique in a bank. */
export const QuestionBankSchema = z.strictObject({
  formatVersion: z.literal(QUESTION_BANK_FORMAT_VERSION, {
    error: "This isn't a Care Hub question bank (formatVersion 1).",
  }),
  id: IdSchema,
  title: z
    .string()
    .max(BANK_LIMITS.title)
    .refine((title) => title.trim() !== '', { error: 'Give the bank a title.' }),
  description: z.string().max(BANK_LIMITS.description).optional(),
  questions: z
    .array(QuestionSchema)
    .max(BANK_LIMITS.questions, {
      error: `A bank holds at most ${BANK_LIMITS.questions} questions.`,
    })
    .superRefine((questions, ctx) => {
      const seen = new Set<Id>();
      questions.forEach((question, index) => {
        if (seen.has(question.id)) {
          ctx.addIssue({
            code: 'custom',
            path: [index, 'id'],
            message: `Question id "${question.id}" is used twice in this bank.`,
          });
        }
        seen.add(question.id);
      });
    }),
});

/** A shared question bank (see `QuestionBankSchema`). */
export type QuestionBank = z.infer<typeof QuestionBankSchema>;

/** The result of `parseQuestionBank`. Issue paths look like `questions[3].options[0].text`. */
export type ParseQuestionBankResult =
  { ok: true; bank: QuestionBank } | { ok: false; issues: FormatIssue[] };

/** Validates a stored or uploaded question bank, with readable messages. Never throws. */
export function parseQuestionBank(raw: unknown): ParseQuestionBankResult {
  const version =
    typeof raw === 'object' && raw !== null
      ? (raw as { formatVersion?: unknown }).formatVersion
      : undefined;
  if (typeof version === 'number' && version > QUESTION_BANK_FORMAT_VERSION) {
    const message = `This bank was saved by a newer version of Care Hub (format ${version}), so it can't be opened here.`;
    return { ok: false, issues: [{ path: 'formatVersion', message }] };
  }
  const result = parseWith(QuestionBankSchema, raw);
  return result.ok ? { ok: true, bank: result.value } : result;
}

/** A new, empty question bank. The title is trimmed and cut to the limit; a blank one becomes "Untitled bank". */
export function createQuestionBank(input: {
  title: string;
  description?: string;
  id?: Id;
}): QuestionBank {
  const bank: QuestionBank = {
    formatVersion: QUESTION_BANK_FORMAT_VERSION,
    id: input.id ?? newId(),
    title: input.title.trim().slice(0, BANK_LIMITS.title) || 'Untitled bank',
    questions: [],
  };
  const description = input.description?.trim().slice(0, BANK_LIMITS.description);
  return description ? { ...bank, description } : bank;
}

/**
 * Adds questions at the end of a bank (for example from a spreadsheet import). Ids already in the bank are
 * renamed (`id-2`, …); questions that don't fit in the 500-question limit are left out. `added` counts the
 * questions that went in, from the start of `questions`. The input bank is not changed.
 */
export function addQuestionsToBank(
  bank: QuestionBank,
  questions: readonly Question[],
): { bank: QuestionBank; added: number } {
  const room = Math.max(0, BANK_LIMITS.questions - bank.questions.length);
  const allocate = idAllocator(new Set(bank.questions.map((question) => question.id)));
  const fresh = questions
    .slice(0, room)
    .map((question) => ({ ...question, id: allocate(question.id) }));
  return { bank: { ...bank, questions: [...bank.questions, ...fresh] }, added: fresh.length };
}
