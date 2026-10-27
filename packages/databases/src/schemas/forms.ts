/** Schemas for forms: questions, show-when logic and the form settings a form view saves. */
import { z } from 'zod';
import { isAnonymousForm, validateFormDefinition } from '../forms';
import { LIMITS } from '../types';
import type {
  FormCondition,
  FormConditionOp,
  FormDefinition,
  FormLogic,
  FormQuestion,
  Property,
} from '../types';
import {
  REQUEST_LIMITS,
  iconSchema,
  idListSchema,
  idSchema,
  instantSchema,
  isUniqueBy,
  keysOf,
  lineSchema,
  textSchema,
} from './common';
import { fileRefSchema, richTextSchema } from './values';

const CONDITION_OPS = keysOf<FormConditionOp>({
  is: true,
  is_not: true,
  contains: true,
  does_not_contain: true,
  eq: true,
  neq: true,
  gt: true,
  lt: true,
  gte: true,
  lte: true,
  is_any_of: true,
  is_none_of: true,
  contains_any: true,
  contains_all: true,
  contains_none: true,
  is_checked: true,
  is_not_checked: true,
  before: true,
  after: true,
  is_empty: true,
  is_not_empty: true,
});

/** One show-when condition on an earlier answer: text of up to 10,000 characters or up to 500 ids. */
export const formConditionSchema = z.strictObject({
  id: idSchema,
  questionPropertyId: idSchema,
  op: z.enum(CONDITION_OPS),
  value: z.union([z.string().max(LIMITS.text), idListSchema(LIMITS.relationLinks)]).exactOptional(),
}) satisfies z.ZodType<FormCondition>;

/** When a question shows: all or any of up to 10 conditions. */
export const formLogicSchema = z.strictObject({
  combinator: z.enum(['and', 'or']),
  conditions: z
    .array(formConditionSchema)
    .max(LIMITS.formConditions)
    .refine((list) => isUniqueBy(list, (c) => c.id), 'Each condition once.'),
}) satisfies z.ZodType<FormLogic>;

/** One question: up to 2,000 characters, a description of up to 2,000, and optional logic. */
export const formQuestionSchema = z.strictObject({
  propertyId: idSchema,
  text: textSchema(LIMITS.title),
  description: richTextSchema(LIMITS.formDescription),
  required: z.boolean(),
  display: z.enum(['default', 'long', 'dropdown']),
  logic: formLogicSchema.nullable(),
  logicChanged: z.boolean().exactOptional(),
}) satisfies z.ZodType<FormQuestion>;

/** True if every condition is on a question above its own (so the first question has none). */
function logicLooksUp(questions: readonly FormQuestion[]): boolean {
  const above = new Set<string>();
  for (const q of questions) {
    if (q.logic?.conditions.some((c) => !above.has(c.questionPropertyId))) return false;
    above.add(q.propertyId);
  }
  return true;
}

/**
 * A form's settings: up to 100 questions (each property once, logic only on questions above), a
 * description and confirmation of up to 2,000 characters, and a link code of letters, digits, "-"
 * and "_". An anonymous form (or one anyone can fill in) must allow more than one response. Rules
 * that need the database's properties are checked by formDefinitionSchemaFor.
 */
export const formDefinitionSchema = z
  .strictObject({
    title: textSchema(LIMITS.title),
    description: richTextSchema(LIMITS.formDescription),
    questions: z
      .array(formQuestionSchema)
      .max(LIMITS.formQuestions)
      .refine((list) => isUniqueBy(list, (q) => q.propertyId), 'Each property once.')
      .refine(logicLooksUp, 'Logic can only use questions above.'),
    submitLabel: lineSchema(REQUEST_LIMITS.label),
    confirmation: richTextSchema(LIMITS.formDescription),
    allowMultiple: z.boolean(),
    accepting: z.boolean(),
    linkCode: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    linkChangedAt: instantSchema.nullable(),
    anonymous: z.boolean(),
    notifyUserIds: idListSchema(REQUEST_LIMITS.notifyPeople),
    audience: z.enum(['members', 'members_and_guests', 'anyone']).exactOptional(),
    closeAt: instantSchema.nullable().exactOptional(),
    maxResponses: z.int().min(1).nullable().exactOptional(),
    cover: fileRefSchema.nullable().exactOptional(),
    icon: iconSchema.nullable().exactOptional(),
  })
  .refine(
    (def) => def.allowMultiple || !isAnonymousForm(def),
    'An anonymous form must allow more than one response.',
  ) satisfies z.ZodType<FormDefinition>;

/**
 * formDefinitionSchema plus the rules that need the database's properties (validateFormDefinition):
 * questions on properties that exist and can be questions, logic only on earlier questions, and no
 * Person or Relation questions on a form anyone can fill in.
 */
export function formDefinitionSchemaFor(properties: readonly Property[]) {
  return formDefinitionSchema.refine((def) => validateFormDefinition(def, properties) === null, {
    message: "The form doesn't fit the database.",
    when: (p) => p.issues.length === 0,
  });
}
