/** Schemas for filters, sorts and grouping, as views, color rules and buttons send them. */
import { z } from 'zod';
import { normalizeDecimal } from '../decimal';
import { countConditions } from '../filter';
import { FILTER_OPS, LIMITS, STATUS_GROUPS } from '../types';
import type {
  DateRef,
  DateWindow,
  FilterCondition,
  FilterGroup,
  FilterNode,
  FilterOp,
  FilterValue,
  Grouping,
  RelativeDay,
  Sort,
} from '../types';
import {
  REQUEST_LIMITS,
  calendarDateSchema,
  idListSchema,
  idSchema,
  isUniqueBy,
  keysOf,
} from './common';

const RELATIVE_DAYS = keysOf<RelativeDay>({
  today: true,
  tomorrow: true,
  yesterday: true,
  one_week_ago: true,
  one_week_from_now: true,
  one_month_ago: true,
  one_month_from_now: true,
});

const WINDOWS = keysOf<Extract<DateWindow, string>>({
  this_week: true,
  last_week: true,
  next_week: true,
  this_month: true,
  last_month: true,
  next_month: true,
  this_year: true,
  last_year: true,
  next_year: true,
  past_7_days: true,
  next_7_days: true,
  past_30_days: true,
  next_30_days: true,
});

/** The largest count in a "past or next N days, weeks, months or years" window. */
export const MAX_WINDOW_COUNT = 1_000;

/** A day for a date condition: an exact calendar date or a relative day such as "today". */
export const dateRefSchema = z.union([
  z.strictObject({ exact: calendarDateSchema }),
  z.strictObject({ relative: z.enum(RELATIVE_DAYS) }),
]) satisfies z.ZodType<DateRef>;

/** A window for "within": a named one ("this_week") or the past or next N days, weeks and so on. */
export const dateWindowSchema = z.union([
  z.enum(WINDOWS),
  z.strictObject({
    direction: z.enum(['past', 'next']),
    count: z.int().min(1).max(MAX_WINDOW_COUNT),
    unit: z.enum(['day', 'week', 'month', 'year']),
  }),
]) satisfies z.ZodType<DateWindow>;

const textValue = z.string().max(LIMITS.text);
const idsValue = idListSchema(LIMITS.relationLinks);
const numberValue = textValue.refine((s) => normalizeDecimal(s) !== null, 'Not a number.');
const groupsValue = z
  .array(z.enum(STATUS_GROUPS))
  .max(STATUS_GROUPS.length)
  .refine((g) => isUniqueBy(g, (x) => x), 'Each group once.');
const rangeValue = z.strictObject({ start: dateRefSchema, end: dateRefSchema });

/** Any condition value. Which of these shapes fits depends on the operator. */
export const filterValueSchema = z.union([
  textValue,
  idsValue,
  groupsValue,
  dateRefSchema,
  rangeValue,
  dateWindowSchema,
]) satisfies z.ZodType<FilterValue>;

const textOrIds = z.union([textValue, idsValue]);

/** The value shape each operator takes; null for operators that need no value. */
const VALUE_BY_OP: Record<FilterOp, z.ZodType | null> = {
  is: z.union([textValue, idsValue, dateRefSchema]),
  is_not: z.union([textValue, idsValue, dateRefSchema]),
  contains: textOrIds,
  does_not_contain: textOrIds,
  starts_with: textValue,
  ends_with: textValue,
  eq: numberValue,
  neq: numberValue,
  gt: numberValue,
  lt: numberValue,
  gte: numberValue,
  lte: numberValue,
  group_is: groupsValue,
  contains_any: idsValue,
  contains_all: idsValue,
  before: dateRefSchema,
  after: dateRefSchema,
  on_or_before: dateRefSchema,
  on_or_after: dateRefSchema,
  between: rangeValue,
  within: dateWindowSchema,
  is_checked: null,
  is_not_checked: null,
  all_done: null,
  not_all_done: null,
  is_empty: null,
  is_not_empty: null,
  is_verified: null,
  is_expired: null,
  is_not_verified: null,
};

/** No value yet ('' or []): the condition is still being set up, so any operator takes it. */
const isUnset = (v: FilterValue): boolean => v === '' || (Array.isArray(v) && v.length === 0);

function fitsOp(op: FilterOp, value: FilterValue | undefined): boolean {
  const shape = VALUE_BY_OP[op];
  return shape === null || value === undefined || isUnset(value) || shape.safeParse(value).success;
}

/**
 * One filter condition. The value must fit the operator (text, ids, a number, status groups, a
 * day, two days or a window); no value yet is fine. Operators like "is empty" ignore the value.
 */
export const filterConditionSchema = z
  .strictObject({
    kind: z.literal('condition'),
    id: idSchema,
    propertyId: idSchema,
    op: z.enum(FILTER_OPS),
    value: filterValueSchema.exactOptional(),
  })
  .refine((c) => fitsOp(c.op, c.value), {
    message: "The value doesn't fit the operator.",
    path: ['value'],
  }) satisfies z.ZodType<FilterCondition>;

function groupOf(child: z.ZodType<FilterNode>): z.ZodType<FilterGroup> {
  return z.strictObject({
    kind: z.literal('group'),
    id: idSchema,
    combinator: z.enum(['and', 'or']),
    children: z.array(child).max(LIMITS.filterConditions),
  });
}

/** The deepest group holds only conditions; each layer above can also hold the layer below. */
function layeredGroup(): z.ZodType<FilterGroup> {
  let group = groupOf(filterConditionSchema);
  for (let layer = 1; layer < LIMITS.filterDepth; layer++) {
    group = groupOf(z.union([filterConditionSchema, group]));
  }
  return group;
}

/**
 * A filter for a view, color rule or button: a group of conditions and groups, up to 3 layers
 * deep and 50 conditions in all. Checked without recursion, so deep input can't exhaust the stack.
 */
export const filterGroupSchema = layeredGroup().refine(
  (f) => countConditions(f) <= LIMITS.filterConditions,
  'Up to 50 conditions.',
);

/** One sort: a property and a direction. */
export const sortSchema = z.strictObject({
  propertyId: idSchema,
  direction: z.enum(['asc', 'desc']),
}) satisfies z.ZodType<Sort>;

/** A view's sorts: up to 10. */
export const sortsSchema = z.array(sortSchema).max(LIMITS.sorts);

const groupKeys = z.array(z.string().max(LIMITS.text)).max(REQUEST_LIMITS.groupKeys);
const NUMBER_BOUND = 10 ** LIMITS.numberIntegerDigits;
const rangeBound = z.number().gt(-NUMBER_BOUND).lt(NUMBER_BOUND);

/** Number ranges for grouping: the end above the start, a step above 0, up to 1,000 ranges. */
export const numberRangeSchema = z
  .strictObject({ start: rangeBound, end: rangeBound, step: z.number().positive() })
  .refine((r) => r.end > r.start, 'The end must be above the start.')
  .refine((r) => (r.end - r.start) / r.step <= REQUEST_LIMITS.numberBuckets, 'Up to 1,000 ranges.');

/** How a view groups its rows (or sub-groups them), with up to 1,000 ordered or hidden groups. */
export const groupingSchema = z.strictObject({
  propertyId: idSchema,
  dateBucket: z.enum(['relative', 'day', 'week', 'month', 'year']).exactOptional(),
  statusBy: z.enum(['option', 'group']).exactOptional(),
  textBy: z.enum(['exact', 'alphabetical']).exactOptional(),
  numberRange: numberRangeSchema.nullable().exactOptional(),
  sort: z.enum(['option', 'manual', 'asc', 'desc']).exactOptional(),
  order: groupKeys.exactOptional(),
  hidden: groupKeys.exactOptional(),
  hideEmpty: z.boolean().exactOptional(),
}) satisfies z.ZodType<Grouping>;
