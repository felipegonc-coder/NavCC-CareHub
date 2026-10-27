/** Schemas for properties: options, number display, and the settings of every property type. */
import { z } from 'zod';
import {
  AGGREGATES,
  CURRENCIES,
  DATE_FORMATS,
  LIMITS,
  NUMBER_FORMATS,
  STATUS_GROUPS,
} from '../types';
import type {
  ComputedKind,
  NumberDisplay,
  Property,
  PropertyConfig,
  SelectOption,
  StatusOption,
} from '../types';
import { propertyAccessSchema } from './access';
import { buttonActionsSchema } from './buttons';
import {
  REQUEST_LIMITS,
  iconSchema,
  idSchema,
  isUniqueBy,
  keysOf,
  lineSchema,
  optionColorSchema,
  textSchema,
} from './common';

/** Option names are compared like options.ts does: trimmed, NFC and ignoring case. */
const nameKey = (name: string): string => name.trim().normalize('NFC').toLowerCase();

const optionShape = {
  id: idSchema,
  name: lineSchema(LIMITS.optionName, 1).refine(
    (s) => !s.includes(','),
    "Option names can't have commas.",
  ),
  color: optionColorSchema,
  description: textSchema(REQUEST_LIMITS.optionDescription).exactOptional(),
};

/** A Select or Multi-select option: a name of 1 to 100 characters with no commas, and a color. */
export const selectOptionSchema = z.strictObject(optionShape) satisfies z.ZodType<SelectOption>;

/** A Status option: a Select option that also belongs to a group (to do, in progress, complete). */
export const statusOptionSchema = z.strictObject({
  ...optionShape,
  group: z.enum(STATUS_GROUPS),
}) satisfies z.ZodType<StatusOption>;

function optionList<T extends SelectOption>(option: z.ZodType<T>) {
  return z
    .array(option)
    .max(REQUEST_LIMITS.options)
    .refine((list) => isUniqueBy(list, (o) => o.id), 'Each option once.')
    .refine((list) => isUniqueBy(list, (o) => nameKey(o.name)), 'Option names must be different.');
}

/** A Select or Multi-select property's options: up to 1,000, names different ignoring case. */
export const selectOptionsSchema = optionList(selectOptionSchema);

/** A Status property's options: up to 1,000, names different ignoring case. */
export const statusOptionsSchema = optionList(statusOptionSchema);

let intlCurrencies: ReadonlySet<string> | null = null;

/** True for the listed currencies and any other three-letter code this runtime knows. */
function isKnownCurrency(code: string): boolean {
  if ((CURRENCIES as readonly string[]).includes(code)) return true;
  if (!/^[A-Z]{3}$/.test(code)) return false;
  if (!intlCurrencies) {
    try {
      intlCurrencies = new Set(Intl.supportedValuesOf('currency'));
    } catch {
      intlCurrencies = new Set();
    }
  }
  return intlCurrencies.has(code);
}

const numberDisplayShape = {
  format: z.enum(NUMBER_FORMATS),
  currency: z.string().refine(isKnownCurrency, 'Unknown currency.'),
  decimals: z.literal(['auto', 0, 1, 2, 3, 4]),
  showAs: z.enum(['number', 'bar', 'ring']),
  color: optionColorSchema,
  divideBy: z.number().positive().nullable(),
  showNumber: z.boolean(),
};

const showsAsNumber = (d: { showAs: string; divideBy: number | null }): boolean =>
  d.showAs === 'number' || d.divideBy !== null;
const NEEDS_DIVIDE_BY = 'A bar or ring needs a number to divide by.';

/** How a number shows: format, currency, decimals, and a bar or ring (which needs "divide by"). */
export const numberDisplaySchema = z
  .strictObject(numberDisplayShape)
  .refine(showsAsNumber, NEEDS_DIVIDE_BY) satisfies z.ZodType<NumberDisplay>;

const COMPUTED_KINDS = keysOf<ComputedKind>({
  text: true,
  number: true,
  boolean: true,
  date: true,
  person: true,
  page: true,
  list: true,
});

const dateShape = {
  format: z.enum(DATE_FORMATS),
  timeFormat: z.enum(['viewer', '12h', '24h', 'hidden']),
};

/** An ID property's prefix: 1 to 20 letters, digits, hyphens or underscores. */
export const uniqueIdPrefixSchema = z
  .string()
  .min(1)
  .max(REQUEST_LIMITS.idPrefix)
  .regex(/^[A-Za-z0-9_-]+$/);

const simple = <T extends PropertyConfig['type']>(type: T) =>
  z.strictObject({ type: z.literal(type) });

/**
 * A property's settings, for every property type. Status needs at least one option in each group
 * and a default that is one of its options; formulas are up to 10,000 characters.
 */
export const propertyConfigSchema = z.discriminatedUnion('type', [
  simple('title'),
  simple('text'),
  z
    .strictObject({ type: z.literal('number'), ...numberDisplayShape })
    .refine(showsAsNumber, NEEDS_DIVIDE_BY),
  z.strictObject({ type: z.literal('select'), options: selectOptionsSchema }),
  z.strictObject({ type: z.literal('multi_select'), options: selectOptionsSchema }),
  z
    .strictObject({
      type: z.literal('status'),
      options: statusOptionsSchema,
      defaultOptionId: idSchema,
    })
    .refine(
      (c) => STATUS_GROUPS.every((g) => c.options.some((o) => o.group === g)),
      'Each status group needs an option.',
    )
    .refine(
      (c) => c.options.some((o) => o.id === c.defaultOptionId),
      'The default must be one of the options.',
    ),
  z.strictObject({ type: z.literal('date'), ...dateShape }),
  simple('checkbox'),
  simple('url'),
  simple('email'),
  simple('phone'),
  z.strictObject({ type: z.literal('person'), single: z.boolean(), notify: z.boolean() }),
  simple('files'),
  z.strictObject({
    type: z.literal('relation'),
    targetDatabaseId: idSchema,
    single: z.boolean(),
    twoWayPropertyId: idSchema.nullable(),
  }),
  simple('checklist'),
  z.strictObject({ type: z.literal('created_time'), ...dateShape }),
  z.strictObject({ type: z.literal('edited_time'), ...dateShape }),
  simple('created_by'),
  simple('edited_by'),
  z.strictObject({
    type: z.literal('formula'),
    expression: z.string().max(LIMITS.formulaLength),
    resultKind: z.enum(COMPUTED_KINDS).nullable(),
    number: numberDisplaySchema.nullable(),
  }),
  z.strictObject({
    type: z.literal('rollup'),
    relationPropertyId: idSchema,
    targetPropertyId: idSchema,
    aggregate: z.enum(AGGREGATES),
    number: numberDisplaySchema.nullable(),
  }),
  z.strictObject({ type: z.literal('unique_id'), prefix: uniqueIdPrefixSchema.nullable() }),
  z.strictObject({
    type: z.literal('button'),
    label: lineSchema(REQUEST_LIMITS.label),
    actions: buttonActionsSchema,
    icon: iconSchema.nullable().exactOptional(),
    color: optionColorSchema.exactOptional(),
    whoCanPress: z.enum(['editors', 'viewers']).exactOptional(),
  }),
]) satisfies z.ZodType<PropertyConfig>;

/** A property: a name of 1 to 100 characters, a description of up to 280, settings and access. */
export const propertySchema = z.strictObject({
  id: idSchema,
  name: lineSchema(LIMITS.propertyName, 1),
  description: textSchema(REQUEST_LIMITS.propertyDescription),
  config: propertyConfigSchema,
  rowPage: z.enum(['always', 'hide_when_empty', 'always_hide']),
  access: propertyAccessSchema.exactOptional(),
}) satisfies z.ZodType<Property>;
