import { describe, expect, it } from 'vitest';
import { toCsv } from './csv';

describe('toCsv', () => {
  it('writes a header and one line per row, each ending in CRLF', () => {
    expect(
      toCsv(
        ['Page', 'Views'],
        [
          ['Refund policy', 12],
          ['Shift notes', 3],
        ],
      ),
    ).toBe('Page,Views\r\nRefund policy,12\r\nShift notes,3\r\n');
  });

  it('quotes cells with commas, quotes or line breaks', () => {
    expect(toCsv(['Page'], [['Rota, nights'], ['Say "hi"'], ['Line one\nline two']])).toBe(
      'Page\r\n"Rota, nights"\r\n"Say ""hi"""\r\n"Line one\nline two"\r\n',
    );
  });

  it('keeps spreadsheet apps from running text as a formula', () => {
    expect(toCsv(['Page'], [['=SUM(A1:A9)'], ['+1 call'], ['-'], ['@Avery'], ['\tTabbed']])).toBe(
      "Page\r\n'=SUM(A1:A9)\r\n'+1 call\r\n'-\r\n'@Avery\r\n'\tTabbed\r\n",
    );
    // Numbers are numbers, even below zero.
    expect(toCsv(['Change'], [[-2]])).toBe('Change\r\n-2\r\n');
  });
});
