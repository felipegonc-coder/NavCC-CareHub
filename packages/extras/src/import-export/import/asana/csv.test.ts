import { describe, expect, it } from 'vitest';
import { ImportFileError } from '../plan';
import { OPEN_QUOTE, readCsv } from './csv';

const limits = { records: 5, cells: 4, cellChars: 20 };

function stop(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ImportFileError);
    return (error as Error).message;
  }
  throw new Error('it did not stop');
}

describe('readCsv', () => {
  it('reads quoted cells with commas, quotes and line breaks, and every kind of line end', () => {
    const text = '\uFEFFName,Notes\r\n"Call, then write","Say ""hi""\nand go"\nForms,\rLast,x';
    expect(readCsv(text, limits)).toEqual([
      ['Name', 'Notes'],
      ['Call, then write', 'Say "hi"\nand go'],
      ['Forms', ''],
      ['Last', 'x'],
    ]);
  });

  it('skips blank lines and keeps stray quotes as typed', () => {
    expect(readCsv('a,b\n\n\r\n5" wide,"x"y\n', limits)).toEqual([
      ['a', 'b'],
      ['5" wide', 'xy'],
    ]);
    expect(readCsv('', limits)).toEqual([]);
    expect(readCsv('\uFEFF', limits)).toEqual([]);
  });

  it('stops for a quote that is never closed', () => {
    expect(stop(() => readCsv('Name\n"Call', limits))).toBe(OPEN_QUOTE);
  });

  it('stops at once past its limits', () => {
    expect(stop(() => readCsv('a\nb\nc\nd\ne\nf', limits))).toBe('databases can have up to 4 rows');
    expect(stop(() => readCsv('a,b,c,d,e', limits))).toBe('CSV rows can have up to 4 cells');
    expect(stop(() => readCsv(`"${'x'.repeat(21)}"`, limits))).toBe(
      'CSV cells can have up to 20 characters',
    );
    expect(stop(() => readCsv('x'.repeat(21), limits))).toBe(
      'CSV cells can have up to 20 characters',
    );
    const started = Date.now();
    const big = { records: 20_001, cells: 1_000, cellChars: 1_000_000 };
    expect(stop(() => readCsv('a,b\n'.repeat(1_000_000), big))).toBe(
      'databases can have up to 20,000 rows',
    );
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
