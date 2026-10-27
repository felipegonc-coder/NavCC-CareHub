import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { LIMITS } from '../types';
import { REQUEST_LIMITS } from './common';
import {
  MAX_OFFSET_DAYS,
  dynamicDateSchema,
  repeatScheduleSchema,
  rowPageLayoutSchema,
  rowTemplateSchema,
  rowTemplatesSchema,
} from './templates';

const ok = (schema: z.ZodType, value: unknown): boolean => schema.safeParse(value).success;
const weekly = {
  every: 'week',
  weekDays: [1, 3],
  time: '09:00',
  timeZone: 'America/Denver',
  start: '2025-03-03',
  end: null,
  paused: false,
  ownerId: 'u-avery',
};
const template = (id: string, repeat: unknown = null) => ({
  id,
  name: 'Boiler check',
  icon: '🔥',
  values: { title: 'Boiler check for Blue Pine Plumbing' },
  repeat,
});

describe('dynamicDateSchema', () => {
  it('takes today or now, moved up to 3,650 days', () => {
    expect(ok(dynamicDateSchema, { dynamic: 'today' })).toBe(true);
    expect(ok(dynamicDateSchema, { dynamic: 'now', offsetDays: MAX_OFFSET_DAYS })).toBe(true);
    expect(ok(dynamicDateSchema, { dynamic: 'now', offsetDays: -MAX_OFFSET_DAYS })).toBe(true);
    expect(ok(dynamicDateSchema, { dynamic: 'now', offsetDays: MAX_OFFSET_DAYS + 1 })).toBe(false);
    expect(ok(dynamicDateSchema, { dynamic: 'now', offsetDays: -MAX_OFFSET_DAYS - 1 })).toBe(false);
    expect(ok(dynamicDateSchema, { dynamic: 'today', offsetDays: 1.5 })).toBe(false);
    expect(ok(dynamicDateSchema, { dynamic: 'tomorrow' })).toBe(false);
  });
});

describe('repeatScheduleSchema', () => {
  it('takes schedules for each period', () => {
    expect(ok(repeatScheduleSchema, weekly)).toBe(true);
    expect(ok(repeatScheduleSchema, { ...weekly, every: 'day', weekDays: undefined })).toBe(false);
    const noDays = { ...weekly, weekDays: [] as number[] };
    expect(ok(repeatScheduleSchema, { ...noDays, every: 'weekday' })).toBe(true);
    expect(ok(repeatScheduleSchema, { ...noDays, every: 'month', monthDay: 'last' })).toBe(true);
    expect(ok(repeatScheduleSchema, { ...noDays, every: 'year', month: 12, monthDay: 28 })).toBe(
      true,
    );
  });

  it('checks the interval at its limits', () => {
    expect(ok(repeatScheduleSchema, { ...weekly, interval: 1 })).toBe(true);
    expect(ok(repeatScheduleSchema, { ...weekly, interval: REQUEST_LIMITS.repeatInterval })).toBe(
      true,
    );
    expect(
      ok(repeatScheduleSchema, { ...weekly, interval: REQUEST_LIMITS.repeatInterval + 1 }),
    ).toBe(false);
    expect(ok(repeatScheduleSchema, { ...weekly, interval: 0 })).toBe(false);
  });

  it.each([
    ['a week with no days', { weekDays: [] }],
    ['the same day twice', { weekDays: [1, 1] }],
    ['day 7', { weekDays: [7] }],
    ['a time off the quarter hour', { time: '09:10' }],
    ['hour 24', { time: '24:00' }],
    ['a time without a leading zero', { time: '9:00' }],
    ['day 29 of the month', { monthDay: 29 }],
    ['month 13', { month: 13 }],
    ['an end before the start', { end: '2025-03-02' }],
    ['an unknown time zone', { timeZone: 'Mars/Base' }],
    ['a bad start date', { start: '2025-02-30' }],
    ['an unknown key', { skipHolidays: true }],
  ])('refuses %s', (_, change) => {
    expect(ok(repeatScheduleSchema, { ...weekly, ...change })).toBe(false);
  });

  it('takes the last quarter hour and an end on the start day', () => {
    expect(ok(repeatScheduleSchema, { ...weekly, time: '23:45', end: weekly.start })).toBe(true);
  });
});

describe('row templates', () => {
  it('takes a template with or without a schedule', () => {
    expect(ok(rowTemplateSchema, template('t1'))).toBe(true);
    expect(ok(rowTemplateSchema, template('t1', weekly))).toBe(true);
    expect(ok(rowTemplateSchema, { ...template('t1'), icon: null })).toBe(true);
    expect(ok(rowTemplateSchema, { ...template('t1'), name: '' })).toBe(false);
    expect(ok(rowTemplateSchema, { ...template('t1'), icon: 'javascript:alert(1)' })).toBe(false);
  });

  it('takes up to 50 templates, each once', () => {
    const list = (n: number) => Array.from({ length: n }, (_, i) => template(`t${i}`));
    expect(ok(rowTemplatesSchema, list(LIMITS.templates))).toBe(true);
    expect(ok(rowTemplatesSchema, list(LIMITS.templates + 1))).toBe(false);
    expect(ok(rowTemplatesSchema, [template('t1'), template('t1')])).toBe(false);
  });

  it('takes up to 10 repeating templates', () => {
    const list = (n: number) => Array.from({ length: n }, (_, i) => template(`t${i}`, weekly));
    expect(ok(rowTemplatesSchema, list(LIMITS.repeatingTemplates))).toBe(true);
    expect(ok(rowTemplatesSchema, list(LIMITS.repeatingTemplates + 1))).toBe(false);
  });
});

describe('rowPageLayoutSchema', () => {
  const layout = { pinned: ['p1'], properties: 'panel', comments: 'compact', backlinks: 'count' };

  it('pins up to 4 properties, each once', () => {
    expect(ok(rowPageLayoutSchema, layout)).toBe(true);
    expect(ok(rowPageLayoutSchema, { ...layout, pinned: ['a', 'b', 'c', 'd'] })).toBe(true);
    expect(ok(rowPageLayoutSchema, { ...layout, pinned: ['a', 'b', 'c', 'd', 'e'] })).toBe(false);
    expect(ok(rowPageLayoutSchema, { ...layout, pinned: ['a', 'a'] })).toBe(false);
    expect(ok(rowPageLayoutSchema, { ...layout, comments: 'loud' })).toBe(false);
  });
});
