import { describe, expect, it } from 'vitest';
import { readCsv } from './csv';

describe('readCsv', () => {
  it('reads values, quoted values and line ends of any kind', () => {
    expect(
      readCsv('Name,Notes\r\nCall Rowan,"Ask about ""Tuesday"", then book"\nCall Avery,\r'),
    ).toEqual([
      ['Name', 'Notes'],
      ['Call Rowan', 'Ask about "Tuesday", then book'],
      ['Call Avery', ''],
    ]);
  });

  it('keeps line breaks inside quotes and leaves blank lines out', () => {
    expect(readCsv('A,B\n\n"one\ntwo",3\n\n')).toEqual([
      ['A', 'B'],
      ['one\ntwo', '3'],
    ]);
    expect(readCsv('')).toEqual([]);
  });
});
