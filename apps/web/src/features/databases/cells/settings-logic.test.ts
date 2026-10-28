import type { NumberDisplay, SelectOption } from '@carehub/databases';
import { REQUEST_LIMITS, uniqueIdPrefixSchema } from '@carehub/databases/schemas';
import { describe, expect, it } from 'vitest';
import {
  addSelectOption,
  dateFormatChoices,
  DESCRIPTION_LIMIT,
  numberFormatChoices,
  numberFormatKey,
  readChoice,
  readDecimals,
  readDivideBy,
  readIdPrefix,
  recolorOption,
  renameOption,
  ROW_PAGE_CHOICES,
  timeFormatChoices,
  withNumberFormat,
  withShowAs,
} from './settings-logic';

describe('setting choices', () => {
  it('reads a choice back from a select', () => {
    expect(readChoice(ROW_PAGE_CHOICES, 'hide_when_empty')).toBe('hide_when_empty');
    expect(readChoice(ROW_PAGE_CHOICES, 'sometimes')).toBeNull();
  });

  it('limits descriptions as the server does', () => {
    expect(DESCRIPTION_LIMIT).toBe(REQUEST_LIMITS.propertyDescription);
  });
});

const display: NumberDisplay = {
  format: 'number',
  currency: 'USD',
  decimals: 'auto',
  showAs: 'number',
  color: 'default',
  divideBy: null,
  showNumber: true,
};

describe('number settings', () => {
  it('lists the formats, then the currencies with common ones first', () => {
    const labels = numberFormatChoices(display).map((c) => c.label);
    expect(labels.slice(0, 6)).toEqual([
      'Number',
      'Number with commas',
      'Percent',
      'US dollar',
      'Euro',
      'British pound',
    ]);
    expect(labels).toContain('Canadian dollar');
    expect(labels).toContain('Brazilian real');
    expect(labels).toContain('Mexican peso');
    expect(labels).toContain('Japanese yen');
    expect(labels).toHaveLength(3 + 38);
  });

  it('keeps a currency set some other way on the list', () => {
    const kenya = { ...display, format: 'currency' as const, currency: 'KES' };
    expect(numberFormatChoices(kenya).at(-1)).toEqual({ value: 'currency:KES', label: 'KES' });
  });

  it('reads and writes the format choice', () => {
    expect(numberFormatKey(display)).toBe('number');
    expect(numberFormatKey({ format: 'currency', currency: 'EUR' })).toBe('currency:EUR');
    expect(withNumberFormat(display, 'currency:EUR')).toEqual({
      ...display,
      format: 'currency',
      currency: 'EUR',
    });
    expect(withNumberFormat(display, 'percent')).toEqual({ ...display, format: 'percent' });
    expect(withNumberFormat(display, 'nonsense')).toEqual(display);
  });

  it('reads decimals, automatic unless 0 to 4', () => {
    expect(readDecimals('2')).toBe(2);
    expect(readDecimals('0')).toBe(0);
    expect(readDecimals('auto')).toBe('auto');
    expect(readDecimals('7')).toBe('auto');
  });

  it('gives a bar or ring a divide by of 100 when it has none', () => {
    expect(withShowAs(display, 'bar')).toEqual({ ...display, showAs: 'bar', divideBy: 100 });
    expect(withShowAs({ ...display, divideBy: 10 }, 'ring').divideBy).toBe(10);
    expect(withShowAs({ ...display, showAs: 'bar', divideBy: 10 }, 'number')).toEqual({
      ...display,
      divideBy: 10,
    });
  });

  it('takes a divide by above 0', () => {
    expect(readDivideBy(' 50 ')).toEqual({ value: 50 });
    expect(readDivideBy('1,000')).toEqual({ value: 1000 });
    expect(readDivideBy('0.5')).toEqual({ value: 0.5 });
    expect(readDivideBy('0')).toEqual({ error: 'Enter a number above 0.' });
    expect(readDivideBy('-3')).toEqual({ error: 'Enter a number above 0.' });
    expect(readDivideBy('ten')).toEqual({ error: 'Enter a number.' });
    expect(readDivideBy('')).toEqual({ error: 'Enter a number.' });
  });
});

describe('date and time settings', () => {
  it('shows each date format as Oct 26, 2026 would look', () => {
    expect(dateFormatChoices()).toEqual([
      { value: 'full', label: 'Oct 26, 2026' },
      { value: 'mdy', label: '10/26/2026' },
      { value: 'dmy', label: '26/10/2026' },
      { value: 'ymd', label: '2026-10-26' },
      { value: 'relative', label: 'Relative (Today, Tomorrow, Yesterday)' },
    ]);
  });

  it('offers each time format with an example', () => {
    expect(timeFormatChoices().map((c) => c.label)).toEqual([
      "Each person's 12- or 24-hour setting",
      '12-hour (3:30 PM)',
      '24-hour (15:30)',
      "Don't show times",
    ]);
  });
});

describe('ID prefix', () => {
  it('saves a prefix without spaces or trailing hyphens, or none', () => {
    expect(readIdPrefix('QA')).toEqual({ prefix: 'QA' });
    expect(readIdPrefix(' QA- ')).toEqual({ prefix: 'QA' });
    expect(readIdPrefix('JOB_2')).toEqual({ prefix: 'JOB_2' });
    expect(readIdPrefix('  ')).toEqual({ prefix: null });
  });

  it('takes up to 20 letters, numbers, hyphens or underscores', () => {
    const problem = { error: 'Use up to 20 letters, numbers, hyphens or underscores.' };
    expect(readIdPrefix('Q A')).toEqual(problem);
    expect(readIdPrefix('QA#')).toEqual(problem);
    expect(readIdPrefix('Q'.repeat(REQUEST_LIMITS.idPrefix + 1))).toEqual(problem);
    expect(readIdPrefix('Q'.repeat(REQUEST_LIMITS.idPrefix))).toEqual({
      prefix: 'Q'.repeat(REQUEST_LIMITS.idPrefix),
    });
  });

  it('takes the prefixes the server takes', () => {
    for (const text of ['QA', 'JOB_2', 'a-b', 'Q A', 'QA#', 'Café', 'Q'.repeat(21)]) {
      expect('prefix' in readIdPrefix(text)).toBe(uniqueIdPrefixSchema.safeParse(text).success);
    }
  });
});

const select: SelectOption[] = [
  { id: 'high', name: 'High', color: 'red' },
  { id: 'medium', name: 'Medium', color: 'yellow' },
  { id: 'low', name: 'Low', color: 'gray' },
];

describe('select options', () => {
  it('renames and recolors one option', () => {
    expect(renameOption(select, 'low', '  Someday ')[2]).toEqual({
      id: 'low',
      name: 'Someday',
      color: 'gray',
    });
    expect(recolorOption(select, 'high', 'pink')[0]?.color).toBe('pink');
  });

  it('adds an option in the next color, or says why not', () => {
    const added = addSelectOption(select, ' Urgent ');
    expect('options' in added && added.options[3]).toMatchObject({
      name: 'Urgent',
      color: 'brown',
    });
    expect(addSelectOption(select, 'high')).toEqual({
      error: 'An option with that name already exists.',
    });
    expect(addSelectOption(select, 'A, B')).toEqual({
      error: "Option names can't contain commas.",
    });
    expect(addSelectOption(select, ' ')).toEqual({ error: 'Enter an option name.' });
  });
});
