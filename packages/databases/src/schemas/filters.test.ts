import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { defaultConfig, defaultBoardGrouping, newProperty } from '../schema';
import { FILTER_OPS, LIMITS } from '../types';
import { REQUEST_LIMITS } from './common';
import {
  MAX_WINDOW_COUNT,
  dateRefSchema,
  dateWindowSchema,
  filterConditionSchema,
  filterGroupSchema,
  groupingSchema,
  sortsSchema,
} from './filters';

const ok = (schema: z.ZodType, value: unknown): boolean => schema.safeParse(value).success;
const cond = (op: string, value?: unknown) => ({
  kind: 'condition',
  id: `c-${op}`,
  propertyId: 'p1',
  op,
  ...(value === undefined ? {} : { value }),
});
const group = (children: unknown[], id = 'g') => ({
  kind: 'group',
  id,
  combinator: 'and',
  children,
});
const conds = (n: number) => Array.from({ length: n }, () => cond('is_empty'));

describe('date refs and windows', () => {
  it('takes exact and relative days', () => {
    expect(ok(dateRefSchema, { exact: '2025-03-14' })).toBe(true);
    expect(ok(dateRefSchema, { relative: 'one_week_ago' })).toBe(true);
    expect(ok(dateRefSchema, { exact: '2025-02-30' })).toBe(false);
    expect(ok(dateRefSchema, { relative: 'next_decade' })).toBe(false);
    expect(ok(dateRefSchema, { exact: '2025-03-14', relative: 'today' })).toBe(false);
  });

  it('takes named windows and counts up to 1,000', () => {
    expect(ok(dateWindowSchema, 'past_30_days')).toBe(true);
    const window = { direction: 'next', count: MAX_WINDOW_COUNT, unit: 'week' };
    expect(ok(dateWindowSchema, window)).toBe(true);
    expect(ok(dateWindowSchema, { ...window, count: MAX_WINDOW_COUNT + 1 })).toBe(false);
    expect(ok(dateWindowSchema, { ...window, count: 0 })).toBe(false);
    expect(ok(dateWindowSchema, { ...window, count: 1.5 })).toBe(false);
    expect(ok(dateWindowSchema, { ...window, unit: 'hour' })).toBe(false);
    expect(ok(dateWindowSchema, 'past_9_days')).toBe(false);
  });
});

describe('filterConditionSchema', () => {
  it.each([
    ['is', 'Blue Pine Plumbing'],
    ['is', ['opt-1']],
    ['is', { relative: 'today' }],
    ['is_not', ['me']],
    ['contains', 'pipe'],
    ['contains', ['row-1']],
    ['starts_with', 'Blue'],
    ['ends_with', 'ing'],
    ['eq', '12.5'],
    ['gt', '-3'],
    ['lte', '1e3'],
    ['group_is', ['todo', 'complete']],
    ['contains_any', ['opt-1', 'opt-2']],
    ['contains_all', ['u-avery']],
    ['before', { exact: '2025-03-14' }],
    ['on_or_after', { relative: 'tomorrow' }],
    ['between', { start: { exact: '2025-03-01' }, end: { relative: 'today' } }],
    ['within', 'this_month'],
    ['within', { direction: 'past', count: 3, unit: 'day' }],
    ['is_empty', 'anything left over'],
    ['is_checked', ['x']],
  ])('takes %s with %j', (op, value) => {
    expect(ok(filterConditionSchema, cond(op, value))).toBe(true);
  });

  it.each([
    ['starts_with', ['opt-1']],
    ['eq', 'twelve'],
    ['eq', ['1']],
    ['group_is', ['someday']],
    ['contains_any', 'opt-1'],
    ['before', '2025-03-14'],
    ['before', { exact: '2025-03-14', relative: 'today' }],
    ['between', { exact: '2025-03-14' }],
    ['within', { exact: '2025-03-14' }],
    ['is', { start: { relative: 'today' }, end: { relative: 'today' } }],
  ])('refuses %s with %j', (op, value) => {
    expect(ok(filterConditionSchema, cond(op, value))).toBe(false);
  });

  it.each(FILTER_OPS.map((op) => [op]))('takes %s with no value yet', (op) => {
    expect(ok(filterConditionSchema, cond(op))).toBe(true);
    expect(ok(filterConditionSchema, cond(op, ''))).toBe(true);
    expect(ok(filterConditionSchema, cond(op, []))).toBe(true);
  });

  it('checks text and id lists at their limits', () => {
    expect(ok(filterConditionSchema, cond('contains', 'x'.repeat(LIMITS.text)))).toBe(true);
    expect(ok(filterConditionSchema, cond('contains', 'x'.repeat(LIMITS.text + 1)))).toBe(false);
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `r${i}`);
    expect(ok(filterConditionSchema, cond('contains_any', ids(LIMITS.relationLinks)))).toBe(true);
    expect(ok(filterConditionSchema, cond('contains_any', ids(LIMITS.relationLinks + 1)))).toBe(
      false,
    );
  });

  it('refuses unknown operators, keys and undefined values', () => {
    expect(ok(filterConditionSchema, cond('matches', 'x'))).toBe(false);
    expect(ok(filterConditionSchema, { ...cond('is', 'x'), extra: 1 })).toBe(false);
    expect(ok(filterConditionSchema, { ...cond('is'), value: undefined })).toBe(false);
    expect(ok(filterConditionSchema, { ...cond('is'), value: null })).toBe(false);
  });
});

describe('filterGroupSchema', () => {
  it('takes up to 3 layers', () => {
    const three = group([cond('is', 'a'), group([cond('is', 'b'), group([cond('is', 'c')])])]);
    expect(ok(filterGroupSchema, three)).toBe(true);
    expect(ok(filterGroupSchema, group([]))).toBe(true);
  });

  it('refuses a fourth layer', () => {
    const four = group([group([group([group([cond('is', 'd')])])])]);
    expect(ok(filterGroupSchema, four)).toBe(false);
  });

  it('refuses a condition on its own', () => {
    expect(ok(filterGroupSchema, cond('is', 'a'))).toBe(false);
  });

  it('takes up to 50 conditions in all', () => {
    expect(ok(filterGroupSchema, group(conds(LIMITS.filterConditions)))).toBe(true);
    expect(ok(filterGroupSchema, group(conds(LIMITS.filterConditions + 1)))).toBe(false);
    const split = group([group(conds(30)), group(conds(21))]);
    expect(ok(filterGroupSchema, split)).toBe(false);
    expect(ok(filterGroupSchema, group([group(conds(30)), group(conds(20))]))).toBe(true);
  });

  it('handles very deep input without recursion', () => {
    let deep: unknown = cond('is', 'x');
    for (let i = 0; i < 10_000; i++) deep = group([deep]);
    expect(ok(filterGroupSchema, deep)).toBe(false);
  });

  it('refuses bad combinators and unknown keys', () => {
    expect(ok(filterGroupSchema, { ...group([]), combinator: 'xor' })).toBe(false);
    expect(ok(filterGroupSchema, { ...group([]), note: 'x' })).toBe(false);
  });
});

describe('sorts and grouping', () => {
  it('takes up to 10 sorts', () => {
    const sorts = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ propertyId: `p${i}`, direction: 'asc' }));
    expect(ok(sortsSchema, sorts(LIMITS.sorts))).toBe(true);
    expect(ok(sortsSchema, sorts(LIMITS.sorts + 1))).toBe(false);
    expect(ok(sortsSchema, [{ propertyId: 'p1', direction: 'up' }])).toBe(false);
  });

  it('takes the default board grouping', () => {
    const props = [
      newProperty('Name', defaultConfig('title')),
      newProperty('Stage', defaultConfig('status')),
    ];
    expect(ok(groupingSchema, defaultBoardGrouping(props))).toBe(true);
  });

  it('checks number ranges', () => {
    const g = (numberRange: unknown) => ({ propertyId: 'p1', numberRange });
    expect(ok(groupingSchema, g({ start: 0, end: 100, step: 10 }))).toBe(true);
    expect(ok(groupingSchema, g(null))).toBe(true);
    expect(ok(groupingSchema, g({ start: 0, end: REQUEST_LIMITS.numberBuckets, step: 1 }))).toBe(
      true,
    );
    expect(
      ok(groupingSchema, g({ start: 0, end: REQUEST_LIMITS.numberBuckets + 1, step: 1 })),
    ).toBe(false);
    expect(ok(groupingSchema, g({ start: 10, end: 10, step: 1 }))).toBe(false);
    expect(ok(groupingSchema, g({ start: 0, end: 10, step: 0 }))).toBe(false);
    expect(ok(groupingSchema, g({ start: 0, end: 1e16, step: 1e14 }))).toBe(false);
    expect(ok(groupingSchema, g({ start: 0, end: Number.NaN, step: 1 }))).toBe(false);
  });

  it('takes up to 1,000 ordered or hidden groups', () => {
    const keys = (n: number) => Array.from({ length: n }, (_, i) => `k${i}`);
    expect(ok(groupingSchema, { propertyId: 'p1', order: keys(REQUEST_LIMITS.groupKeys) })).toBe(
      true,
    );
    expect(
      ok(groupingSchema, { propertyId: 'p1', hidden: keys(REQUEST_LIMITS.groupKeys + 1) }),
    ).toBe(false);
  });

  it('refuses unknown options', () => {
    expect(ok(groupingSchema, { propertyId: 'p1', dateBucket: 'decade' })).toBe(false);
    expect(ok(groupingSchema, { propertyId: 'p1', collapse: true })).toBe(false);
  });
});
