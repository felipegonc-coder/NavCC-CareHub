import { describe, expect, it } from 'vitest';
import { cleanFileName, contentDisposition, tooLargeMessage } from './names';

const MB = 1024 * 1024;

describe('cleanFileName', () => {
  it('keeps the name without folders or characters that disguise it', () => {
    expect(cleanFileName('reports/2026/Résumé – final.pdf')).toBe('Résumé – final.pdf');
    expect(cleanFileName('C:\\Users\\Test\\notes.txt')).toBe('notes.txt');
    expect(cleanFileName('invoice\u202Efdp.exe')).toBe('invoicefdp.exe');
    expect(cleanFileName('tab\there\u0000.txt')).toBe('tabhere.txt');
    expect(cleanFileName('Cafe\u0301.txt')).toBe('Café.txt');
    expect(cleanFileName('  spaced.txt  ')).toBe('spaced.txt');
  });

  it('falls back to "file" and shortens long names, keeping the ending', () => {
    expect(cleanFileName(undefined)).toBe('file');
    expect(cleanFileName('..')).toBe('file');
    expect(cleanFileName('\u202E')).toBe('file');
    const long = cleanFileName(`${'é'.repeat(300)}.pdf`);
    expect([...long]).toHaveLength(255);
    expect(long.endsWith('é.pdf')).toBe(true);
  });
});

describe('contentDisposition', () => {
  it('sends the name for every browser', () => {
    expect(contentDisposition('attachment', 'Résumé (final).pdf')).toBe(
      `attachment; filename="Resume (final).pdf"; filename*=UTF-8''R%C3%A9sum%C3%A9%20%28final%29.pdf`,
    );
    expect(contentDisposition('inline', 'say "hi" 100%.png')).toBe(
      `inline; filename="say _hi_ 100_.png"; filename*=UTF-8''say%20%22hi%22%20100%25.png`,
    );
  });
});

describe('tooLargeMessage', () => {
  it('says the size and the limit in MB, never rounding down to the limit', () => {
    expect(tooLargeMessage(Math.round(100.1 * MB), 100)).toBe(
      'This file is 100.1 MB; the limit is 100 MB.',
    );
    expect(tooLargeMessage(100 * MB + 1, 100)).toBe('This file is 100.1 MB; the limit is 100 MB.');
    expect(tooLargeMessage(310 * MB, 100)).toBe('This file is 310 MB; the limit is 100 MB.');
  });
});
