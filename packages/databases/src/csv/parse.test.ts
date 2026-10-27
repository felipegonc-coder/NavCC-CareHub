import { describe, expect, it } from 'vitest';
import { LIMITS } from '../types';
import { checkCsvLimits, checkCsvSize, detectSeparator, parseCsv, readCsvFile } from './parse';

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('parseCsv', () => {
  it('splits records and values', () => {
    expect(parseCsv('Name,Status\r\nAvery Lin,Open\r\nJordan Park,Done\r\n', ',')).toEqual([
      ['Name', 'Status'],
      ['Avery Lin', 'Open'],
      ['Jordan Park', 'Done'],
    ]);
  });

  it('accepts CRLF, LF and CR line endings', () => {
    expect(parseCsv('a,b\r\nc,d\ne,f\rg,h', ',')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
      ['e', 'f'],
      ['g', 'h'],
    ]);
  });

  it('reads quoted values with separators, doubled quotes and line breaks', () => {
    const text =
      '"Blue Pine Plumbing, LLC","He said ""hi""","Line 1\r\nLine 2"\r\n"a\rb","c\nd",""\r\n';
    expect(parseCsv(text, ',')).toEqual([
      ['Blue Pine Plumbing, LLC', 'He said "hi"', 'Line 1\nLine 2'],
      ['a\nb', 'c\nd', ''],
    ]);
  });

  it('keeps values exactly as written', () => {
    expect(parseCsv(' a , b ,c"d,"e"f\n', ',')).toEqual([[' a ', ' b ', 'c"d', 'ef']]);
  });

  it('reads a value without its closing quote to the end of the file', () => {
    expect(parseCsv('a,"b,c\nd', ',')).toEqual([['a', 'b,c\nd']]);
  });

  it('keeps empty values', () => {
    expect(parseCsv('a,,c\n,,\nd,e,\n', ',')).toEqual([
      ['a', '', 'c'],
      ['', '', ''],
      ['d', 'e', ''],
    ]);
  });

  it('skips a byte order mark and empty lines at the end', () => {
    expect(parseCsv('\uFEFFName\nAvery Lin\n\n\r\n\n', ',')).toEqual([['Name'], ['Avery Lin']]);
  });

  it('keeps an empty line in the middle, so record numbers stay those of the file', () => {
    expect(parseCsv('Name\n\nAvery Lin\n', ',')).toEqual([['Name'], [''], ['Avery Lin']]);
  });

  it('reads nothing from an empty file', () => {
    expect(parseCsv('', ',')).toEqual([]);
    expect(parseCsv('\uFEFF\r\n', ',')).toEqual([]);
  });

  it('splits on the separator it is given', () => {
    expect(parseCsv('a;b,c\n1;2', ';')).toEqual([
      ['a', 'b,c'],
      ['1', '2'],
    ]);
    expect(parseCsv('a\tb,c\n1\t2', '\t')).toEqual([
      ['a', 'b,c'],
      ['1', '2'],
    ]);
  });

  it('stops after maxRows records plus one', () => {
    expect(parseCsv('1\n2\n3\n4\n5\n', ',', { maxRows: 2 })).toEqual([['1'], ['2'], ['3']]);
  });

  it('keeps maxColumns values plus one per record', () => {
    expect(parseCsv('a,b,c,d\n1,2,3,4,5\n', ',', { maxColumns: 2 })).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });
});

describe('detectSeparator', () => {
  it.each([
    ['commas', 'Name,Status\nAvery Lin,Open\nJordan Park,Done\n', ','],
    ['semicolons and decimal commas', 'Name;Amount\nAvery Lin;1,5\nJordan Park;2,25\n', ';'],
    [
      'tabs and commas in values',
      'Name\tNotes\nAvery Lin\tCalled, left message\nJordan Park\tOK\n',
      '\t',
    ],
    ['separators inside quotes', '"Lin, Avery";Open\n"Park, Jordan";Done\n', ';'],
    ['empty lines', 'a;b\n\n\nc;d\n\n', ';'],
    ['a single column', 'Name\nAvery Lin\nJordan Park\n', ','],
    ['nothing in it', '', ','],
  ])('reads a file with %s', (_, text: string, separator: string) => {
    expect(detectSeparator(text)).toBe(separator);
  });

  it('picks the separator that fits more records', () => {
    expect(detectSeparator('a;b,c\nd;e,f\ng;h\n')).toBe(';');
    expect(detectSeparator('a,b;c\nd,e;f\ng,h\n')).toBe(',');
  });

  it('picks the separator that gives more values when both fit every record', () => {
    expect(detectSeparator('a;b;c,d\ne;f;g,h\n')).toBe(';');
    expect(detectSeparator('a,b,c;d\ne,f,g;h\n')).toBe(',');
  });

  it('prefers tab, then comma, then semicolon on a tie', () => {
    expect(detectSeparator('a,b;c\td\n')).toBe('\t');
    expect(detectSeparator('a,b;c\n')).toBe(',');
  });

  it('looks at the first 50 records only', () => {
    expect(detectSeparator(`${'a;b\n'.repeat(50)}${'a,b,c\n'.repeat(100)}`)).toBe(';');
  });
});

describe('checkCsvSize', () => {
  it('allows files up to 10 MB', () => {
    expect(checkCsvSize(10 * 1024 * 1024)).toBeNull();
    expect(checkCsvSize(10 * 1024 * 1024 + 1)).toBe('This file is larger than 10 MB.');
  });
});

describe('checkCsvLimits', () => {
  const rows = (n: number, width = 1): string[][] =>
    Array.from({ length: n }, () => Array.from({ length: width }, () => 'x'));

  it('allows 20,000 rows below the header row', () => {
    expect(checkCsvLimits(rows(20_001), 100)).toBeNull();
    expect(checkCsvLimits(rows(20_002), 100)).toBe('This file has more than 20,000 rows.');
  });

  it('counts the first row when it is not a header row', () => {
    expect(checkCsvLimits(rows(20_000), 100, false)).toBeNull();
    expect(checkCsvLimits(rows(20_001), 100, false)).toBe('This file has more than 20,000 rows.');
  });

  it('allows 200 columns', () => {
    expect(checkCsvLimits(rows(3, 200), 100)).toBeNull();
    expect(checkCsvLimits([['x'], ...rows(1, 201)], 100)).toBe(
      'This file has more than 200 columns.',
    );
  });

  it('checks the size first', () => {
    expect(checkCsvLimits(rows(20_002), LIMITS.csvBytes + 1)).toBe(
      'This file is larger than 10 MB.',
    );
  });
});

describe('readCsvFile', () => {
  it('detects the separator and reads the table', () => {
    expect(readCsvFile(utf8('\uFEFFName;Status\r\nAvery Lin;Open\r\n'))).toEqual({
      ok: true,
      separator: ';',
      table: [
        ['Name', 'Status'],
        ['Avery Lin', 'Open'],
      ],
    });
  });

  it('uses the separator chosen in the import dialog', () => {
    expect(readCsvFile(utf8('Name;Status\r\nAvery Lin;Open\r\n'), { separator: ',' })).toEqual({
      ok: true,
      separator: ',',
      table: [['Name;Status'], ['Avery Lin;Open']],
    });
  });

  it('reads Windows-1252 files', () => {
    const file = Uint8Array.from([0x4e, 0x61, 0x6d, 0x65, 0x0d, 0x0a, 0x43, 0x61, 0x66, 0xe9]);
    expect(readCsvFile(file)).toEqual({
      ok: true,
      separator: ',',
      table: [['Name'], ['Caf\u00e9']],
    });
  });

  it('refuses files over 10 MB before reading them', () => {
    expect(readCsvFile(new Uint8Array(LIMITS.csvBytes + 1))).toEqual({
      ok: false,
      error: 'This file is larger than 10 MB.',
    });
  });

  it('refuses files with more than 20,000 rows', () => {
    const tooMany = { ok: false, error: 'This file has more than 20,000 rows.' };
    expect(readCsvFile(utf8(`Name\n${'x\n'.repeat(20_000)}`))).toMatchObject({ ok: true });
    expect(readCsvFile(utf8(`Name\n${'x\n'.repeat(20_001)}`))).toEqual(tooMany);
    expect(readCsvFile(utf8('x\n'.repeat(20_001)), { firstRowIsHeaders: false })).toEqual(tooMany);
    expect(readCsvFile(utf8('x\n'.repeat(50_000)))).toEqual(tooMany);
  });

  it('refuses files with more than 200 columns', () => {
    expect(readCsvFile(utf8(`${'a,'.repeat(199)}a\r\n`))).toMatchObject({ ok: true });
    expect(readCsvFile(utf8(`${'a,'.repeat(200)}a\r\n`))).toEqual({
      ok: false,
      error: 'This file has more than 200 columns.',
    });
  });
});
