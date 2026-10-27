import { z } from 'zod';

// Claude fields (docs/extras/claude.md, "Claude fields"; spec section 3.4), shared by the server's
// /api/claude/fields routes and the web app. Databases owns the property type and its cell; these
// are its setup, its value and the fill shapes. Import from '@carehub/extras/claude/fields'.

// stand-in: the Claude field's type name in Databases' PROPERTY_TYPES (phase 5).
export const CLAUDE_FIELD_TYPE = 'claude';

/** Summary (up to 3 sentences), Key points (up to 5 bullets) or Custom (its own instructions). */
export const CLAUDE_FIELD_KINDS = ['summary', 'key_points', 'custom'] as const;
export type ClaudeFieldKind = (typeof CLAUDE_FIELD_KINDS)[number];

/** New fields fill By hand. Automatically refills a row 2 minutes after its last change (CL-D4). */
export const CLAUDE_FIELD_FILLS = ['by_hand', 'auto'] as const;
export type ClaudeFieldFill = (typeof CLAUDE_FIELD_FILLS)[number];

export const CLAUDE_FIELD_LIMITS = {
  /** A Custom field's own instructions. */
  instructions: 1_000,
  /** Properties one field may use. */
  uses: 20,
  /** The row's page content, when the field uses it. */
  pageContent: 20_000,
  /** A value is text, like a Text property's. */
  value: 10_000,
  /** Rows one Fill may ask for. */
  rows: 1_000,
  /** Rows filling at the same time in the background. */
  atOnce: 5,
  /** Requests one database's Claude fields may send in an hour. */
  perDatabaseHour: 300,
  /** How long an automatic fill waits after a row's last change. */
  autoDelayMs: 2 * 60_000,
} as const;

/**
 * Types a field can't use: relations and rollups bring in other rows, a button has no value, and a
 * Claude field using another could fill in a loop. A formula counts too unless it reads only its row.
 */
export const CLAUDE_FIELD_UNUSABLE_TYPES: readonly string[] = [
  'relation',
  'rollup',
  'button',
  CLAUDE_FIELD_TYPE,
];

const id = z.string().min(1).max(100);

export const claudeFieldSetupSchema = z
  .object({
    kind: z.enum(CLAUDE_FIELD_KINDS),
    /** Custom only, such as "In one sentence: what does the customer want?" */
    instructions: z.string().trim().max(CLAUDE_FIELD_LIMITS.instructions).default(''),
    /** The row properties Claude reads. */
    uses: z.array(id).max(CLAUDE_FIELD_LIMITS.uses).default([]),
    /** Whether Claude reads the row's page content too. */
    usesPageContent: z.boolean().default(false),
    fill: z.enum(CLAUDE_FIELD_FILLS).default('by_hand'),
  })
  .refine((setup) => setup.kind !== 'custom' || setup.instructions !== '', {
    path: ['instructions'],
    message: 'Write what Claude should do.',
  })
  .refine((setup) => setup.uses.length > 0 || setup.usesPageContent, {
    path: ['uses'],
    message: 'Choose what Claude reads.',
  });
export type ClaudeFieldSetup = z.infer<typeof claudeFieldSetupSchema>;

/** A Claude field's value on a row. It's plain text: show it as text, never as HTML. */
export const claudeFieldValueSchema = z.object({
  text: z.string().max(CLAUDE_FIELD_LIMITS.value),
  /** When it last filled (ISO), or null before its first fill. */
  filledAt: z.string().nullable(),
  /** Who asked ("Filled by Claude for Avery Lin"), or null for "Filled by Claude automatically". */
  filledFor: z.string().nullable(),
  /** failed: the last try didn't work and `text` is the old value ("Couldn't fill. Try again."). */
  status: z.enum(['filled', 'failed']),
});
export type ClaudeFieldValue = z.infer<typeof claudeFieldValueSchema>;

/** Who can see a property, as Databases' PropertyAccess.see: null for everyone who sees the row. */
export type ClaudeFieldAudience = readonly { type: 'user' | 'group' | 'role'; id: string }[] | null;

export interface ClaudeFieldInput {
  id: string;
  type: string;
  see: ClaudeFieldAudience;
  /** For a formula: false only when it reads nothing but its own row. */
  readsOtherRows?: boolean;
}

/** What the routes answer, beyond CLAUDE_ERRORS, when a field can't fill. `details` has `reason`. */
export const CLAUDE_FIELD_ERRORS = {
  unusable_input: {
    status: 409,
    code: 'conflict',
    message:
      "This field uses a relation, rollup or other property Claude fields can't use. Change what it uses.",
  },
  hidden_input: {
    status: 409,
    code: 'conflict',
    message:
      "This field uses a property that some people who see the field can't see. Change what it uses.",
  },
  database_hour: {
    status: 429,
    code: 'rate_limited',
    message: "This database's Claude fields have filled a lot this hour. Try again later.",
  },
} as const;
export type ClaudeFieldErrorReason = keyof typeof CLAUDE_FIELD_ERRORS;

/**
 * Why a field can't use its inputs, or null. Its value reaches everyone who can see the field, so
 * it may use only what all of them can see: each input is open to everyone who sees the row (the
 * Name always is), or the field is limited to people the input is also limited to. Inputs that
 * bring in other rows are never allowed.
 */
export function claudeFieldInputProblem(
  field: { see: ClaudeFieldAudience },
  inputs: readonly ClaudeFieldInput[],
): 'unusable_input' | 'hidden_input' | null {
  const key = (principal: { type: string; id: string }) => `${principal.type}:${principal.id}`;
  for (const input of inputs) {
    if (CLAUDE_FIELD_UNUSABLE_TYPES.includes(input.type)) return 'unusable_input';
    if (input.type === 'formula' && input.readsOtherRows !== false) return 'unusable_input';
  }
  for (const input of inputs) {
    if (input.type === 'title' || input.see === null) continue;
    const allowed = new Set(input.see.map(key));
    if (field.see === null || !field.see.every((principal) => allowed.has(key(principal)))) {
      return 'hidden_input';
    }
  }
  return null;
}

/** POST /api/claude/fields/fill. More than one row comes with the background fills. */
export const claudeFieldFillRequestSchema = z
  .object({ databaseId: z.uuid(), propertyId: id, rowIds: z.array(z.uuid()).length(1) })
  .strict();

export const claudeFieldFillResultSchema = z.object({
  status: z.literal('filled'),
  rowId: z.uuid(),
  value: claudeFieldValueSchema,
});
export type ClaudeFieldFillResult = z.infer<typeof claudeFieldFillResultSchema>;
