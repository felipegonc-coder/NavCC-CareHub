import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { defaultConfig, newProperty, relationConfig } from '../schema';
import { LIMITS, PROPERTY_TYPES } from '../types';
import { REQUEST_LIMITS } from './common';
import {
  numberDisplaySchema,
  propertyConfigSchema,
  propertySchema,
  selectOptionSchema,
  selectOptionsSchema,
  statusOptionsSchema,
  uniqueIdPrefixSchema,
} from './properties';

const ok = (schema: z.ZodType, value: unknown): boolean => schema.safeParse(value).success;
const option = (id: string, name: string) => ({ id, name, color: 'blue' });
const numberDisplay = {
  format: 'number',
  currency: 'USD',
  decimals: 'auto',
  showAs: 'number',
  color: 'blue',
  divideBy: null,
  showNumber: true,
};
const display = { type: 'number', ...numberDisplay };

describe('every property type', () => {
  it.each(PROPERTY_TYPES.filter((t) => t !== 'relation' && t !== 'rollup').map((t) => [t]))(
    'takes the default %s settings',
    (type) => {
      expect(ok(propertyConfigSchema, defaultConfig(type))).toBe(true);
      expect(ok(propertySchema, newProperty('Field', defaultConfig(type)))).toBe(true);
    },
  );

  it('takes relations and rollups', () => {
    expect(ok(propertyConfigSchema, relationConfig('db-clients'))).toBe(true);
    const rollup = {
      type: 'rollup',
      relationPropertyId: 'p-client',
      targetPropertyId: 'p-hours',
      aggregate: 'show_unique',
      number: null,
    };
    expect(ok(propertyConfigSchema, rollup)).toBe(true);
    expect(ok(propertyConfigSchema, { ...rollup, aggregate: 'mode' })).toBe(false);
  });

  it('refuses unknown types and extra keys', () => {
    expect(ok(propertyConfigSchema, { type: 'rating' })).toBe(false);
    expect(ok(propertyConfigSchema, { type: 'text', rich: true })).toBe(false);
  });
});

describe('options', () => {
  it('trims names and refuses commas', () => {
    expect(selectOptionSchema.parse(option('o1', '  Urgent ')).name).toBe('Urgent');
    expect(ok(selectOptionSchema, option('o1', 'Urgent, now'))).toBe(false);
    expect(ok(selectOptionSchema, option('o1', ' '))).toBe(false);
  });

  it('checks name and description lengths at their limits', () => {
    expect(ok(selectOptionSchema, option('o1', 'x'.repeat(LIMITS.optionName)))).toBe(true);
    expect(ok(selectOptionSchema, option('o1', 'x'.repeat(LIMITS.optionName + 1)))).toBe(false);
    const described = (n: number) => ({ ...option('o1', 'Urgent'), description: 'x'.repeat(n) });
    expect(ok(selectOptionSchema, described(REQUEST_LIMITS.optionDescription))).toBe(true);
    expect(ok(selectOptionSchema, described(REQUEST_LIMITS.optionDescription + 1))).toBe(false);
  });

  it('refuses the same name twice, ignoring case', () => {
    expect(ok(selectOptionsSchema, [option('o1', 'Blue Pine'), option('o2', 'Plumbing')])).toBe(
      true,
    );
    expect(ok(selectOptionsSchema, [option('o1', 'Blue Pine'), option('o2', 'blue pine ')])).toBe(
      false,
    );
    expect(ok(selectOptionsSchema, [option('o1', 'A'), option('o1', 'B')])).toBe(false);
  });

  it('takes up to 1,000 options', () => {
    const list = (n: number) => Array.from({ length: n }, (_, i) => option(`o${i}`, `Option ${i}`));
    expect(ok(selectOptionsSchema, list(REQUEST_LIMITS.options))).toBe(true);
    expect(ok(selectOptionsSchema, list(REQUEST_LIMITS.options + 1))).toBe(false);
  });

  it('needs a status group on each status option', () => {
    expect(ok(statusOptionsSchema, [{ ...option('s1', 'Booked'), group: 'todo' }])).toBe(true);
    expect(ok(statusOptionsSchema, [option('s1', 'Booked')])).toBe(false);
    expect(ok(statusOptionsSchema, [{ ...option('s1', 'Booked'), group: 'later' }])).toBe(false);
  });
});

describe('status settings', () => {
  const status = defaultConfig('status');

  it('needs an option in each group', () => {
    const noneDone = status.options.filter((o) => o.group !== 'complete');
    expect(ok(propertyConfigSchema, { ...status, options: noneDone })).toBe(false);
  });

  it('needs the default to be one of the options', () => {
    expect(ok(propertyConfigSchema, { ...status, defaultOptionId: 'missing' })).toBe(false);
  });
});

describe('numberDisplaySchema', () => {
  it('takes listed and other known currencies', () => {
    expect(ok(numberDisplaySchema, numberDisplay)).toBe(true);
    expect(ok(propertyConfigSchema, display)).toBe(true);
    expect(ok(numberDisplaySchema, { ...numberDisplay, currency: 'CHF' })).toBe(true);
    expect(ok(numberDisplaySchema, { ...numberDisplay, currency: 'ISK' })).toBe(true);
  });

  it.each([
    ['a lowercase currency', { currency: 'usd' }],
    ['an unknown currency', { currency: 'XQQ' }],
    ['a long currency', { currency: 'EURO' }],
    ['5 decimals', { decimals: 5 }],
    ['a bar with nothing to divide by', { showAs: 'bar' }],
    ['dividing by 0', { divideBy: 0 }],
    ['dividing by infinity', { divideBy: Number.POSITIVE_INFINITY }],
    ['an unknown format', { format: 'scientific' }],
  ])('refuses %s', (_, change) => {
    expect(ok(numberDisplaySchema, { ...numberDisplay, ...change })).toBe(false);
    expect(ok(propertyConfigSchema, { ...display, ...change })).toBe(false);
  });

  it('takes a ring with something to divide by', () => {
    expect(ok(numberDisplaySchema, { ...numberDisplay, showAs: 'ring', divideBy: 100 })).toBe(true);
  });
});

describe('formula, ID and button settings', () => {
  it('takes formulas up to 10,000 characters', () => {
    const formula = {
      type: 'formula',
      expression: '',
      resultKind: 'number',
      number: numberDisplay,
    };
    expect(
      ok(propertyConfigSchema, { ...formula, expression: 'x'.repeat(LIMITS.formulaLength) }),
    ).toBe(true);
    expect(
      ok(propertyConfigSchema, { ...formula, expression: 'x'.repeat(LIMITS.formulaLength + 1) }),
    ).toBe(false);
    expect(ok(propertyConfigSchema, { ...formula, resultKind: 'error' })).toBe(false);
  });

  it('takes ID prefixes of letters, digits, hyphens and underscores', () => {
    expect(ok(uniqueIdPrefixSchema, 'JOB')).toBe(true);
    expect(ok(uniqueIdPrefixSchema, 'x'.repeat(REQUEST_LIMITS.idPrefix))).toBe(true);
    expect(ok(uniqueIdPrefixSchema, 'x'.repeat(REQUEST_LIMITS.idPrefix + 1))).toBe(false);
    expect(ok(uniqueIdPrefixSchema, 'JOB 1')).toBe(false);
    expect(ok(uniqueIdPrefixSchema, '')).toBe(false);
  });

  it('checks button labels, icons and actions', () => {
    const button = defaultConfig('button');
    expect(
      ok(propertyConfigSchema, { ...button, icon: '✅', color: 'green', whoCanPress: 'viewers' }),
    ).toBe(true);
    expect(ok(propertyConfigSchema, { ...button, label: 'x'.repeat(REQUEST_LIMITS.label) })).toBe(
      true,
    );
    expect(
      ok(propertyConfigSchema, { ...button, label: 'x'.repeat(REQUEST_LIMITS.label + 1) }),
    ).toBe(false);
    expect(ok(propertyConfigSchema, { ...button, icon: 'javascript:alert(1)' })).toBe(false);
    expect(ok(propertyConfigSchema, { ...button, whoCanPress: 'anyone' })).toBe(false);
    const badLink = { kind: 'open_link', url: 'javascript:alert(1)' };
    expect(ok(propertyConfigSchema, { ...button, actions: [badLink] })).toBe(false);
  });
});

describe('propertySchema', () => {
  const prop = newProperty('Client', defaultConfig('text'));

  it('checks the name and description at their limits', () => {
    expect(ok(propertySchema, { ...prop, name: 'x'.repeat(LIMITS.propertyName) })).toBe(true);
    expect(ok(propertySchema, { ...prop, name: 'x'.repeat(LIMITS.propertyName + 1) })).toBe(false);
    expect(ok(propertySchema, { ...prop, name: '  ' })).toBe(false);
    const description = (n: number) => ({ ...prop, description: 'x'.repeat(n) });
    expect(ok(propertySchema, description(REQUEST_LIMITS.propertyDescription))).toBe(true);
    expect(ok(propertySchema, description(REQUEST_LIMITS.propertyDescription + 1))).toBe(false);
  });

  it('takes access lists and refuses unknown keys', () => {
    const access = { see: [{ type: 'user', id: 'u-avery' }], change: null };
    expect(ok(propertySchema, { ...prop, access })).toBe(true);
    expect(ok(propertySchema, { ...prop, rowPage: 'sometimes' })).toBe(false);
    expect(ok(propertySchema, { ...prop, hidden: true })).toBe(false);
  });
});
