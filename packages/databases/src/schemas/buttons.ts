/** Schemas for button properties: the value edits and the actions a button runs. */
import { z } from 'zod';
import { fitsNumberLimits } from '../decimal';
import { LIMITS } from '../types';
import type { ButtonAction, ValueEdit } from '../types';
import {
  REQUEST_LIMITS,
  idListSchema,
  idSchema,
  isUniqueBy,
  lineSchema,
  nameSchema,
  safeWebLinkSchema,
  textSchema,
} from './common';
import { filterGroupSchema } from './filters';
import { valuesSchema } from './values';

/** A number as canonical decimal text ("12.5"): up to 15 digits before the point and 10 after. */
export const decimalSchema = z.string().refine((s) => fitsNumberLimits(s), 'Not a number.');

const formulaSchema = z.string().max(LIMITS.formulaLength);

/** How a button changes one value: set it, work it out, add or remove ids, or add to a number. */
export const valueEditSchema = z.union([
  z.strictObject({ set: z.unknown() }).refine((e) => e.set !== undefined, 'Set needs a value.'),
  z.strictObject({ formula: formulaSchema }),
  z.strictObject({ add: idListSchema(LIMITS.relationLinks) }),
  z.strictObject({ remove: idListSchema(LIMITS.relationLinks) }),
  z.strictObject({ addNumber: decimalSchema }),
]) satisfies z.ZodType<ValueEdit>;

/** Value edits by property id: up to 200. */
export const valueEditsSchema = z
  .record(idSchema, valueEditSchema)
  .refine((e) => Object.keys(e).length <= LIMITS.properties, 'Up to 200 edits.');

const variablesSchema = z
  .array(z.strictObject({ id: idSchema, name: nameSchema, formula: formulaSchema }))
  .max(REQUEST_LIMITS.variables)
  .refine((v) => isUniqueBy(v, (x) => x.id), 'Each variable once.')
  .refine((v) => isUniqueBy(v, (x) => x.name.toLowerCase()), 'Variable names must be different.');

/**
 * One button action. Links must be safe web links; a message goes to up to 50 people plus the
 * people in up to 200 properties; "Define variables" has up to 20 variables.
 */
export const buttonActionSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('set_values'),
    values: valuesSchema,
    edits: valueEditsSchema.exactOptional(),
  }),
  z.strictObject({
    kind: z.literal('add_row'),
    databaseId: idSchema,
    templateId: idSchema.nullable().exactOptional(),
    edits: valueEditsSchema,
    open: z.enum(['side_peek', 'center_peek', 'full_page']).nullable().exactOptional(),
  }),
  z.strictObject({
    kind: z.literal('edit_rows'),
    databaseId: idSchema,
    filter: filterGroupSchema.nullable(),
    edits: valueEditsSchema,
  }),
  z.strictObject({
    kind: z.literal('open_page'),
    pageId: idSchema.nullable(),
    openIn: z.enum(['side_peek', 'center_peek', 'full_page', 'new_tab']),
  }),
  z.strictObject({ kind: z.literal('open_link'), url: safeWebLinkSchema }),
  z.strictObject({
    kind: z.literal('send_message'),
    to: z.strictObject({
      userIds: idListSchema(LIMITS.buttonMessagePeople),
      propertyIds: idListSchema(LIMITS.properties),
      groupIds: idListSchema(REQUEST_LIMITS.principals).exactOptional(),
      roleIds: idListSchema(REQUEST_LIMITS.principals).exactOptional(),
      everyone: z.boolean().exactOptional(),
    }),
    message: textSchema(REQUEST_LIMITS.message),
  }),
  z.strictObject({
    kind: z.literal('confirm'),
    title: lineSchema(REQUEST_LIMITS.label),
    message: textSchema(REQUEST_LIMITS.message),
    confirmLabel: lineSchema(REQUEST_LIMITS.label),
  }),
  z.strictObject({ kind: z.literal('define_variables'), variables: variablesSchema }),
]) satisfies z.ZodType<ButtonAction>;

/** False if an "Open page" with no page comes before any "Add row" (it opens the added row). */
function opensAddedRow(actions: readonly ButtonAction[]): boolean {
  let added = false;
  for (const a of actions) {
    if (a.kind === 'add_row') added = true;
    else if (a.kind === 'open_page' && a.pageId === null && !added) return false;
  }
  return true;
}

/**
 * A button's actions, run in order: up to 10. "Open page" with no page opens the row an earlier
 * "Add row" made, so one must come before it.
 */
export const buttonActionsSchema = z
  .array(buttonActionSchema)
  .max(LIMITS.buttonActions)
  .refine(opensAddedRow, 'Open the new page after adding it.');
