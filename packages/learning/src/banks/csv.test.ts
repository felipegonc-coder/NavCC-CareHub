import { describe, expect, it } from 'vitest';
import { cellText, detectSeparator, readCsv } from './csv';

// Fictional content only.
describe('readCsv', () => {
  it('reads rows and cells, keeping empty cells', () => {
    expect(readCsv('Type,Question\nsingle choice,,x\n', ',')).toEqual({
      rows: [
        ['Type', 'Question'],
        ['single choice', '', 'x'],
      ],
    });
  });

  it('handles quoted separators, doubled quotes and line breaks inside quotes', () => {
    const text = 'a,"b, c","say ""hi""","two\nlines"\r\nnext';
    expect(readCsv(text, ',').rows).toEqual([['a', 'b, c', 'say "hi"', 'two\nlines'], ['next']]);
  });

  it('accepts CRLF, LF and CR line endings and skips a byte order mark', () => {
    expect(readCsv('\uFEFFa\r\nb\nc\rd', ',').rows).toEqual([['a'], ['b'], ['c'], ['d']]);
  });

  it("keeps quotes that don't start a cell and allows spaces before an opening quote", () => {
    expect(readCsv('5" screen,  "quoted, cell"', ',').rows).toEqual([
      ['5" screen', 'quoted, cell'],
    ]);
  });

  it('reports a quote that never ends', () => {
    expect(readCsv('a\nb,"never ends\nc', ',')).toEqual({ rows: [['a']], unclosedQuoteRow: 2 });
  });

  it('stops after maxRows', () => {
    expect(readCsv('a\nb\nc', ',', 2).rows).toEqual([['a'], ['b']]);
  });
});

describe('detectSeparator', () => {
  const known = (cell: string) => ['type', 'question'].includes(cell.trim().toLowerCase());
  it('picks the separator that splits the header into known names', () => {
    expect(detectSeparator('Type;Question\nsingle choice;Hello, there', known)).toBe(';');
    expect(detectSeparator('Type\tQuestion', known)).toBe('\t');
    expect(detectSeparator('Type,Question;x', known)).toBe(',');
  });

  it('falls back to the separator giving the most cells, then comma', () => {
    expect(detectSeparator('a;b;c', known)).toBe(';');
    expect(detectSeparator('abc', known)).toBe(',');
  });
});

describe('cellText', () => {
  it('trims cells and removes the apostrophe that marks a formula-like cell as text', () => {
    expect(readCsv("'=SUM(A1), '+1 ,'-2,'@home,'quoted'", ',').rows[0]?.map(cellText)).toEqual([
      '=SUM(A1)',
      '+1',
      '-2',
      '@home',
      "'quoted'",
    ]);
    expect(cellText('  text  ')).toBe('text');
    expect(cellText(undefined)).toBe('');
  });
});
