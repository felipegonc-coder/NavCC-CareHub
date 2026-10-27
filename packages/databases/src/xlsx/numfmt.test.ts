import { describe, expect, it } from 'vitest';
import { builtInDateStyle, dateStyleOf, numberText, serialText, type DateStyle } from './numfmt';

describe('builtInDateStyle', () => {
  it.each([
    [14, 'date'],
    [15, 'date'],
    [17, 'date'],
    [18, 'time'],
    [20, 'time'],
    [21, 'time'],
    [22, 'datetime'],
    [27, 'date'],
    [32, 'time'],
    [36, 'date'],
    [45, 'time'],
    [46, 'duration'],
    [47, 'time'],
    [50, 'date'],
    [58, 'date'],
  ])('format %i shows a %s', (id: number, style: string) => {
    expect(builtInDateStyle(id)).toBe(style);
  });

  it.each([[0], [1], [2], [4], [9], [10], [11], [12], [37], [44], [49], [59], [164]])(
    'format %i is a plain number',
    (id: number) => {
      expect(builtInDateStyle(id)).toBeNull();
    },
  );
});

describe('dateStyleOf', () => {
  it.each([
    ['yyyy-mm-dd', 'date'],
    ['m/d/yy', 'date'],
    ['d-mmm-yy', 'date'],
    ['mmm yyyy', 'date'],
    ['mmmm', 'date'],
    ['dddd, mmmm d, yyyy', 'date'],
    ['[$-409]mmmm d, yyyy;@', 'date'],
    ['dd/mm/yyyy;[Red]0', 'date'],
    ['yyyy"年"m"月"d"日"', 'date'],
    ['h:mm AM/PM', 'time'],
    ['hh:mm:ss', 'time'],
    ['h:mm a/p', 'time'],
    ['mm:ss', 'time'],
    ['mm:ss.0', 'time'],
    ['yyyy-mm-dd hh:mm', 'datetime'],
    ['m/d/yyyy h:mm', 'datetime'],
    ['[$-F800]dddd\\,\\ mmmm\\ dd\\,\\ yyyy h:mm:ss AM/PM', 'datetime'],
    ['[h]:mm:ss', 'duration'],
    ['[mm]:ss', 'duration'],
    ['[h]', 'duration'],
  ])('%s shows a %s', (code: string, style: string) => {
    expect(dateStyleOf(code)).toBe(style);
  });

  it.each([
    ['General'],
    ['0'],
    ['0.00'],
    ['#,##0.00'],
    ['[Red]0%'],
    ['0.00E+00'],
    ['#,##0 "days"'],
    ['0 \\d\\a\\y\\s'],
    ['_(* #,##0_);_(* (#,##0);_(* "-"_);_(@_)'],
    ['_-* #,##0 [$€-x-euro2]_-'],
    ['0.00;[Red]-0.00;"-";@'],
    ['0;yyyy-mm-dd'],
    [';;;'],
    ['@'],
    [''],
  ])('%s is a plain number', (code: string) => {
    expect(dateStyleOf(code)).toBeNull();
  });
});

describe('serialText', () => {
  it.each([
    [1, '1900-01-01'],
    [59, '1900-02-28'],
    [60, '1900-02-29'],
    [61, '1900-03-01'],
    [46321, '2026-10-26'],
    [46321.75, '2026-10-26'],
    [2958465, '9999-12-31'],
  ])('day %d is %s', (serial: number, text: string) => {
    expect(serialText(serial, 'date')).toBe(text);
  });

  it('gives dates with times to the minute, or the second when there are seconds', () => {
    expect(serialText(46321.5, 'datetime')).toBe('2026-10-26 12:00');
    expect(serialText(46321 + (14 * 60 + 30) / 1440, 'datetime')).toBe('2026-10-26 14:30');
    expect(serialText(46321 + (14 * 3600 + 30 * 60 + 15) / 86400, 'datetime')).toBe(
      '2026-10-26 14:30:15',
    );
    expect(serialText(46321, 'datetime')).toBe('2026-10-26 00:00');
  });

  it('rounds to the second, into the next day if need be', () => {
    expect(serialText(46321.99999999, 'datetime')).toBe('2026-10-27 00:00');
    expect(serialText(46321.99999999, 'date')).toBe('2026-10-27');
    expect(serialText(0.4999999999, 'time')).toBe('12:00');
  });

  it('counts from 1904-01-01 in the 1904 system', () => {
    expect(serialText(0, 'date', true)).toBe('1904-01-01');
    expect(serialText(44859, 'date', true)).toBe('2026-10-26');
    expect(serialText(44859.5, 'datetime', true)).toBe('2026-10-26 12:00');
    expect(serialText(60, 'date', true)).toBe('1904-03-01');
    expect(serialText(0.25, 'datetime', true)).toBe('1904-01-01 06:00');
  });

  it('gives times of day without the date', () => {
    expect(serialText(0.5, 'time')).toBe('12:00');
    expect(serialText((14 * 60 + 30) / 1440, 'time')).toBe('14:30');
    expect(serialText(46321.25, 'time')).toBe('06:00');
    expect(serialText(0.5, 'datetime')).toBe('12:00');
  });

  it('gives elapsed time in hours', () => {
    expect(serialText(1.5, 'duration')).toBe('36:00');
    expect(serialText(1 / 1440, 'duration')).toBe('00:01');
    expect(serialText(2 + 10 / 86400, 'duration')).toBe('48:00:10');
  });

  const notDates: [number, DateStyle, boolean][] = [
    [-1, 'date', false],
    [-0.5, 'time', false],
    [0, 'date', false],
    [0.25, 'date', false],
    [2958466, 'date', false],
    [2958466, 'datetime', false],
    [2958465 - 1462 + 1, 'date', true],
    [Number.NaN, 'date', false],
    [Number.POSITIVE_INFINITY, 'duration', false],
  ];

  it.each(notDates)(
    'gives null for %d as a %s (1904: %s)',
    (serial: number, style: DateStyle, date1904: boolean) => {
      expect(serialText(serial, style, date1904)).toBeNull();
    },
  );
});

describe('numberText', () => {
  it.each([
    ['42', '42'],
    ['-1234.5', '-1234.5'],
    ['0.30000000000000004', '0.3'],
    ['1.5E-3', '0.0015'],
    ['1e-7', '0.0000001'],
    ['1.23456789012345E+17', '123456789012345000'],
    ['123456789012345678', '123456789012346000'],
    ['-0', '0'],
    [' 7 ', '7'],
  ])('%s reads %s', (value: string, text: string) => {
    expect(numberText(value)).toBe(text);
  });

  it.each([[''], [' '], ['abc'], ['1,5'], ['Infinity']])('keeps %s as it is', (value: string) => {
    expect(numberText(value)).toBe(value);
  });
});
