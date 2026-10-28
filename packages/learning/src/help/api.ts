import { z } from 'zod';
import { IdSchema, LIMITS } from '../format/primitives';

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
