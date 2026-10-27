import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { LIMITS } from '../types';
import { REQUEST_LIMITS } from './common';
import {
  checklistItemSchema,
  dateReminderSchema,
  dateValueSchema,
  fileRefSchema,
  mentionSchema,
  richTextSchema,
  richTextSpanSchema,
  textColorSchema,
  valuesSchema,
} from './values';

const ok = (schema: z.ZodType, value: unknown): boolean => schema.safeParse(value).success;
const many = (n: number): Record<string, unknown> =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [`p${i}`, i]));

describe('valuesSchema', () => {
  it('takes up to 200 values of any kind', () => {
    expect(ok(valuesSchema, { title: 'Fix the boiler', due: { start: '2025-03-14' } })).toBe(true);
    expect(ok(valuesSchema, many(LIMITS.properties))).toBe(true);
    expect(ok(valuesSchema, many(LIMITS.properties + 1))).toBe(false);
  });

  it('refuses bad ids and non-objects', () => {
    expect(ok(valuesSchema, { '': 1 })).toBe(false);
    expect(ok(valuesSchema, [1, 2])).toBe(false);
    expect(ok(valuesSchema, null)).toBe(false);
  });
});

describe('dateValueSchema', () => {
  const day = { start: '2025-03-14', end: null, hasTime: false };
  const timed = {
    start: '2025-03-14T16:30:00.000Z',
    end: '2025-03-14T17:30:00.000Z',
    hasTime: true,
    timeZone: 'America/Denver',
    reminder: { minutesBefore: 15 },
  };

  it('takes whole days and times', () => {
    expect(ok(dateValueSchema, day)).toBe(true);
    expect(ok(dateValueSchema, { ...day, end: '2025-03-16', reminder: { daysBefore: 1 } })).toBe(
      true,
    );
    expect(ok(dateValueSchema, timed)).toBe(true);
  });

  it.each([
    ['an end before the start', { ...day, end: '2025-03-13' }],
    ['a time on a whole day', { ...day, start: '2025-03-14T16:30:00.000Z' }],
    ['a time zone on a whole day', { ...day, timeZone: 'America/Denver' }],
    ['an unknown time zone', { ...timed, timeZone: 'Mars/Base' }],
    ['days before a time', { ...timed, reminder: { daysBefore: 1 } }],
    ['minutes before a whole day', { ...day, reminder: { minutesBefore: 5 } }],
    ['an odd reminder', { ...timed, reminder: { minutesBefore: 3 } }],
    ['an unknown key', { ...day, color: 'red' }],
    ['an undefined optional key', { ...day, timeZone: undefined }],
    ['no hasTime', { start: '2025-03-14', end: null }],
  ])('refuses %s', (_, value) => {
    expect(ok(dateValueSchema, value)).toBe(false);
  });

  it('takes the listed reminders only', () => {
    expect(ok(dateReminderSchema, { minutesBefore: 2880 })).toBe(true);
    expect(ok(dateReminderSchema, { daysBefore: 7 })).toBe(true);
    expect(ok(dateReminderSchema, { daysBefore: 3 })).toBe(false);
    expect(ok(dateReminderSchema, { daysBefore: 1, minutesBefore: 5 })).toBe(false);
  });
});

describe('fileRefSchema', () => {
  const upload = { id: 'f1', name: 'invoice.pdf', size: 52_000, mime: 'application/pdf' };
  const linked = {
    id: 'f2',
    name: 'Site photo',
    size: 0,
    mime: '',
    url: 'https://bluepine.example/a.jpg',
  };

  it('takes uploads and linked files', () => {
    expect(ok(fileRefSchema, upload)).toBe(true);
    expect(ok(fileRefSchema, linked)).toBe(true);
  });

  it('checks the name and type lengths at their limits', () => {
    expect(ok(fileRefSchema, { ...upload, name: 'x'.repeat(LIMITS.url) })).toBe(true);
    expect(ok(fileRefSchema, { ...upload, name: 'x'.repeat(LIMITS.url + 1) })).toBe(false);
    expect(ok(fileRefSchema, { ...upload, mime: 'x'.repeat(REQUEST_LIMITS.mime) })).toBe(true);
    expect(ok(fileRefSchema, { ...upload, mime: 'x'.repeat(REQUEST_LIMITS.mime + 1) })).toBe(false);
  });

  it.each([
    ['a negative size', { ...upload, size: -1 }],
    ['a fractional size', { ...upload, size: 1.5 }],
    ['no name', { ...upload, name: ' ' }],
    ['a script link', { ...linked, url: 'javascript:alert(1)' }],
    ['a linked file with a size', { ...linked, size: 10 }],
    ['a linked file with a type', { ...linked, mime: 'image/jpeg' }],
  ])('refuses %s', (_, value) => {
    expect(ok(fileRefSchema, value)).toBe(false);
  });
});

describe('checklistItemSchema', () => {
  it('takes up to 500 characters on one line', () => {
    const item = { id: 'c1', text: 'Shut off the water', done: false };
    expect(ok(checklistItemSchema, item)).toBe(true);
    expect(ok(checklistItemSchema, { ...item, text: 'x'.repeat(LIMITS.checklistItemText) })).toBe(
      true,
    );
    expect(
      ok(checklistItemSchema, { ...item, text: 'x'.repeat(LIMITS.checklistItemText + 1) }),
    ).toBe(false);
    expect(ok(checklistItemSchema, { ...item, text: 'a\nb' })).toBe(false);
    expect(ok(checklistItemSchema, { ...item, done: 'yes' })).toBe(false);
  });
});

describe('rich text', () => {
  it('takes text colors and backgrounds, not default', () => {
    expect(ok(textColorSchema, 'blue')).toBe(true);
    expect(ok(textColorSchema, 'blue_background')).toBe(true);
    expect(ok(textColorSchema, 'default')).toBe(false);
    expect(ok(textColorSchema, 'default_background')).toBe(false);
  });

  it('takes people, pages and dates as mentions', () => {
    expect(ok(mentionSchema, { kind: 'user', id: 'u-avery' })).toBe(true);
    expect(ok(mentionSchema, { kind: 'page', id: 'p1' })).toBe(true);
    expect(
      ok(mentionSchema, { kind: 'date', date: { start: '2025-03-14', end: null, hasTime: false } }),
    ).toBe(true);
    expect(ok(mentionSchema, { kind: 'team', id: 't1' })).toBe(false);
    expect(
      ok(mentionSchema, { kind: 'date', date: { start: 'soon', end: null, hasTime: false } }),
    ).toBe(false);
  });

  it('checks spans', () => {
    const span = {
      text: 'Call Jordan Park',
      marks: ['bold', 'italic'],
      color: 'red',
      link: 'https://bluepine.example',
    };
    expect(ok(richTextSpanSchema, span)).toBe(true);
    expect(ok(richTextSpanSchema, { ...span, marks: ['bold', 'bold'] })).toBe(false);
    expect(ok(richTextSpanSchema, { ...span, marks: ['shout'] })).toBe(false);
    expect(ok(richTextSpanSchema, { ...span, link: 'javascript:alert(1)' })).toBe(false);
    expect(ok(richTextSpanSchema, { ...span, color: 'default' })).toBe(false);
    expect(ok(richTextSpanSchema, { ...span, style: 'x' })).toBe(false);
  });

  it('counts characters across spans', () => {
    const ten = [{ text: 'Avery' }, { text: ' Lin', marks: ['bold'] }, { text: '!' }];
    expect(ok(richTextSchema(10), ten)).toBe(true);
    expect(ok(richTextSchema(9), ten)).toBe(false);
    expect(ok(richTextSchema(), [{ text: 'x'.repeat(LIMITS.text) }])).toBe(true);
    expect(ok(richTextSchema(), [{ text: 'x'.repeat(LIMITS.text + 1) }])).toBe(false);
    expect(ok(richTextSchema(), [])).toBe(true);
  });

  it('caps the number of spans', () => {
    const empty = Array.from({ length: 3 }, () => ({ text: '' }));
    expect(ok(richTextSchema(3), empty)).toBe(true);
    expect(ok(richTextSchema(2), empty)).toBe(false);
  });
});
