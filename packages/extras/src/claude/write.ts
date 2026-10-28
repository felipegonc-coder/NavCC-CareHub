// @carehub/extras/claude/write: writing help's actions, limits and requests, shared by the web app
// and the server (Claude features spec, section 3.2; checks CL-06 to CL-08). Rules for everything
// sent to Claude: docs/extras/claude.md.
import { z } from 'zod';

/** The Ask Claude menu, in its order. Change tone opens the tones. */
export const WRITE_ACTIONS = [
  'improve',
  'fix_grammar',
  'change_tone',
  'make_shorter',
  'simplify',
  'continue',
  'summarize',
  'draft',
] as const;

export type WriteAction = (typeof WRITE_ACTIONS)[number];

export const WRITE_ACTION_LABELS: Readonly<Record<WriteAction, string>> = {
  improve: 'Improve writing',
  fix_grammar: 'Fix grammar',
  change_tone: 'Change tone',
  make_shorter: 'Make shorter',
  simplify: 'Simplify',
  continue: 'Continue writing',
  summarize: 'Summarize',
  draft: 'Draft',
};

export const WRITE_TONES = ['professional', 'friendly', 'direct', 'empathetic'] as const;

export type WriteTone = (typeof WRITE_TONES)[number];

export const WRITE_TONE_LABELS: Readonly<Record<WriteTone, string>> = {
  professional: 'Professional',
  friendly: 'Friendly',
  direct: 'Direct',
  empathetic: 'Empathetic',
};

/** What writing help sends at most, in characters (section 3.2). */
export const WRITE_LIMITS = {
  /** The selection. More asks the person to select less. */
  selection: 10_000,
  /** The page's text on each side of the selection. */
  context: 2_000,
  /** Continue writing: the text above the cursor. */
  above: 4_000,
  /** Summarize with nothing selected: the whole page. */
  page: 40_000,
  /** Draft: what the person typed. */
  prompt: 2_000,
} as const;

/** The actions that rewrite selected text. The others also work with nothing selected. */
const SELECTION_ACTIONS: readonly WriteAction[] = [
  'improve',
  'fix_grammar',
  'change_tone',
  'make_shorter',
  'simplify',
];

export function needsSelection(action: WriteAction): boolean {
  return SELECTION_ACTIONS.includes(action);
}

/** Characters as people count them (code points), like the other limits in Care Hub. */
export function characterCount(text: string): number {
  return Array.from(text).length;
}

/** Text in a request; the exact limits are checked by `writeTooLong`, so the answer can say so. */
const requestText = z.string().max(200_000, { error: "That's too much text to send to Claude." });

/** POST /api/claude/write. The server loads the title and the text around the selection itself. */
export const writeRequestSchema = z
  .object({
    pageId: z.uuid({ error: "That page ID isn't right." }),
    action: z.enum(WRITE_ACTIONS, { error: "That isn't one of the writing help actions." }),
    /** Change tone only. */
    tone: z.enum(WRITE_TONES, { error: "That isn't one of the tones." }).optional(),
    /**
     * The person's selection, with line breaks between blocks. For Continue writing, the text
     * above the cursor (the server keeps its last 4,000 characters). Draft ignores it.
     */
    selection: requestText.default(''),
    /**
     * Where the selection starts in the page's text (blocks joined with line breaks, counted like
     * `String.length`), so the server finds the right one when the same words appear twice.
     */
    at: z.number().int().min(0).optional(),
    /** Draft only: what the person typed. */
    prompt: requestText.optional(),
  })
  .refine((input) => input.action !== 'change_tone' || input.tone !== undefined, {
    error: 'Pick a tone.',
    path: ['tone'],
  })
  .refine((input) => !needsSelection(input.action) || input.selection.trim() !== '', {
    error: 'Select some text first.',
    path: ['selection'],
  })
  .refine((input) => input.action !== 'draft' || Boolean(input.prompt?.trim()), {
    error: 'Say what Claude should write.',
    path: ['prompt'],
  });

export type WriteRequest = z.infer<typeof writeRequestSchema>;
export type WriteRequestInput = z.input<typeof writeRequestSchema>;

/** Over a limit of section 3.2 that asks the person for less (the server answers `too_long`). */
export function writeTooLong(
  input: Pick<WriteRequest, 'action' | 'selection' | 'prompt'>,
): boolean {
  if (input.action === 'draft') return characterCount(input.prompt ?? '') > WRITE_LIMITS.prompt;
  // Continue writing sends only the end of the text above the cursor, so any length is fine.
  if (input.action === 'continue') return false;
  return characterCount(input.selection) > WRITE_LIMITS.selection;
}

/** The answer: Claude's text in Markdown, to show in the result box and parse into blocks. */
export const writeResponseSchema = z.object({ text: z.string() });

export type WriteResponse = z.infer<typeof writeResponseSchema>;

/** How an accepted answer went into the page. */
export const WRITE_PLACEMENTS = ['replace', 'insert_below'] as const;

export type WritePlacement = (typeof WRITE_PLACEMENTS)[number];

/**
 * POST /api/claude/write/applied, after Replace or Insert below: the edit itself goes through the
 * editor like typing; this only tells page history it was made with Claude.
 */
export const writeAppliedSchema = z.object({
  pageId: z.uuid({ error: "That page ID isn't right." }),
  action: z.enum(WRITE_ACTIONS, { error: "That isn't one of the writing help actions." }),
  placement: z.enum(WRITE_PLACEMENTS, { error: 'Say where the text went.' }),
});

export type WriteApplied = z.infer<typeof writeAppliedSchema>;
