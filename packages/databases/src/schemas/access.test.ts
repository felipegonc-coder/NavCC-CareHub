import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { ACCESS_LEVELS, LIMITS } from '../types';
import {
  accessLevelSchema,
  databaseGrantSchema,
  principalsSchema,
  propertyAccessSchema,
  rowAccessRuleSchema,
  rowAccessRulesSchema,
} from './access';
import { REQUEST_LIMITS } from './common';

const ok = (schema: z.ZodType, value: unknown): boolean => schema.safeParse(value).success;
const users = (n: number) => Array.from({ length: n }, (_, i) => ({ type: 'user', id: `u${i}` }));
const rule = (id: string, level = 'edit') => ({ id, propertyId: 'p-owner', level });

describe('access levels', () => {
  it.each(ACCESS_LEVELS.map((level) => [level]))('takes %s', (level) => {
    expect(ok(accessLevelSchema, level)).toBe(true);
    expect(ok(databaseGrantSchema, level)).toBe(true);
  });

  it('takes rows_only for a database only', () => {
    expect(ok(databaseGrantSchema, 'rows_only')).toBe(true);
    expect(ok(accessLevelSchema, 'rows_only')).toBe(false);
    expect(ok(databaseGrantSchema, 'owner')).toBe(false);
  });
});

describe('property access', () => {
  it('takes up to 200 people, groups and roles', () => {
    expect(ok(principalsSchema, users(REQUEST_LIMITS.principals))).toBe(true);
    expect(ok(principalsSchema, users(REQUEST_LIMITS.principals + 1))).toBe(false);
  });

  it('lists each one once', () => {
    const avery = { type: 'user', id: 'avery' };
    expect(ok(principalsSchema, [avery, { type: 'group', id: 'avery' }])).toBe(true);
    expect(ok(principalsSchema, [avery, avery])).toBe(false);
    expect(ok(principalsSchema, [{ type: 'team', id: 'avery' }])).toBe(false);
  });

  it('takes null for everyone', () => {
    expect(ok(propertyAccessSchema, { see: null, change: null })).toBe(true);
    expect(ok(propertyAccessSchema, { see: null, change: users(2) })).toBe(true);
    expect(ok(propertyAccessSchema, { see: null })).toBe(false);
  });
});

describe('row access rules', () => {
  it.each(['view', 'comment', 'edit', 'full'])('takes %s', (level) => {
    expect(ok(rowAccessRuleSchema, rule('r1', level))).toBe(true);
  });

  it.each(['none', 'edit_content', 'admin'])('refuses %s', (level) => {
    expect(ok(rowAccessRuleSchema, rule('r1', level))).toBe(false);
  });

  it('takes up to 10 rules, each once', () => {
    const rules = (n: number) => Array.from({ length: n }, (_, i) => rule(`r${i}`));
    expect(ok(rowAccessRulesSchema, rules(LIMITS.rowAccessRules))).toBe(true);
    expect(ok(rowAccessRulesSchema, rules(LIMITS.rowAccessRules + 1))).toBe(false);
    expect(ok(rowAccessRulesSchema, [rule('r1'), rule('r1', 'view')])).toBe(false);
  });
});
