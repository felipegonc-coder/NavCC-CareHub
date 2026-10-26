import { describe, expect, it } from 'vitest';
import { parseDateText, parseNumberText, parseTimeText } from './parse-text';
import { formatDecimal } from './decimal';
import { formatDateValue } from './dates';

const viewer = { timeZone: 'America/Denver', now: new Date('2026-10-26T18:00:00Z'), hour12: true };

describe('parseNumberText', () => {
  it.each([
    ['1,234.50', '1234.5'],
    ['$12', '12'],
    ['-12', '-12'],
    ['(12)', '-12'],
    ['($1,234.00)', '-1234'],
    ['€1,234.50', '1234.5'],
    ['CHF 12.00', '12'],
    ['CA$3', '3'],
    ['45%', '0.45'],
    ['-$12.00', '-12'],
    ['1e3', '1000'],
    ['.5', '0.5'],
  ])('reads %s', (text, want) => {
    expect(parseNumberText(text)).toBe(want);
  });
  it.each(['', 'abc', '1,5', '12abc', '1,23,4', '1234567890123456', '--1'])(
    'refuses %j',
    (text) => {
      expect(parseNumberText(text)).toBeNull();
    },
  );
  it('reads back every format it is shown in', () => {
    for (const currency of ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'BRL', 'CAD', 'INR', 'SEK']) {
      const shown = formatDecimal('-1234.5', { format: 'currency', decimals: 2, currency });
      expect(parseNumberText(shown)).toBe('-1234.5');
    }
    expect(parseNumberText(formatDecimal('0.455', { format: 'percent', decimals: 'auto' }))).toBe(
      '0.455',
    );
    expect(
      parseNumberText(formatDecimal('1234567.25', { format: 'number_commas', decimals: 'auto' })),
    ).toBe('1234567.25');
  });
});

describe('parseTimeText', () => {
  it('reads 12- and 24-hour times', () => {
    expect(parseTimeText('3:30 PM')).toEqual({ h: 15, m: 30 });
    expect(parseTimeText('12 am')).toEqual({ h: 0, m: 0 });
    expect(parseTimeText('15:30')).toEqual({ h: 15, m: 30 });
    expect(parseTimeText('15')).toBeNull();
    expect(parseTimeText('13 PM')).toBeNull();
  });
});

describe('parseDateText', () => {
  const o = { viewer };
  it.each([
    ['Oct 26, 2026', '2026-10-26'],
    ['October 26 2026', '2026-10-26'],
    ['26 Oct 2026', '2026-10-26'],
    ['10/26/2026', '2026-10-26'],
    ['2026-10-26', '2026-10-26'],
    ['today', '2026-10-26'],
    ['Tomorrow', '2026-10-27'],
    ['yesterday', '2026-10-25'],
  ])('reads %s', (text, day) => {
    expect(parseDateText(text, o)).toEqual({ start: day, end: null, hasTime: false });
  });
  it('reads day first when asked', () => {
    expect(parseDateText('01/02/2026', { ...o, dayFirst: true })?.start).toBe('2026-02-01');
    expect(parseDateText('01/02/2026', o)?.start).toBe('2026-01-02');
  });
  it('reads times in the viewer time zone', () => {
    expect(parseDateText('Oct 26, 2026 3:30 PM', o)).toEqual({
      start: '2026-10-26T21:30:00.000Z',
      end: null,
      hasTime: true,
    });
    expect(parseDateText('2026-10-26T21:30:00.000Z', o)?.start).toBe('2026-10-26T21:30:00.000Z');
  });
  it('reads ranges and refuses an end before the start', () => {
    expect(parseDateText('Oct 26, 2026 → Oct 28, 2026', o)).toEqual({
      start: '2026-10-26',
      end: '2026-10-28',
      hasTime: false,
    });
    expect(parseDateText('Oct 26, 2026 3:30 PM → 4:00 PM', o)?.end).toBe(
      '2026-10-26T22:00:00.000Z',
    );
    expect(parseDateText('Oct 28, 2026 -> Oct 26, 2026', o)).toBeNull();
  });
  it.each(['', 'soon', '02/30/2026', 'Oct 32, 2026', '2026-13-01'])('refuses %j', (text) => {
    expect(parseDateText(text, o)).toBeNull();
  });
  it('reads back what formatDateValue shows', () => {
    const values = [
      { start: '2026-10-26', end: '2026-10-28', hasTime: false },
      { start: '2026-03-08T08:30:00.000Z', end: '2026-03-09T01:15:00.000Z', hasTime: true },
      { start: '2026-10-26T21:30:00.000Z', end: '2026-10-26T22:00:00.000Z', hasTime: true },
    ];
    for (const v of values) {
      for (const format of ['full', 'mdy', 'ymd'] as const) {
        expect(parseDateText(formatDateValue(v, { format, viewer }), o)).toEqual(v);
      }
      expect(
        parseDateText(formatDateValue(v, { format: 'dmy', viewer }), { ...o, dayFirst: true }),
      ).toEqual(v);
    }
  });
});
