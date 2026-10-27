import { describe, expect, it } from 'vitest';
import { normalizeAnswer } from './index';

type Case = { name: string; input: string; caseSensitive?: boolean; expected: string };

const cases: Case[] = [
  { name: 'trims both ends', input: '  wrap-up  ', expected: 'wrap-up' },
  {
    name: 'collapses spaces, tabs and new lines',
    input: 'call \t back\n\n later',
    expected: 'call back later',
  },
  { name: 'case-folds by default', input: 'Wrap-Up', expected: 'wrap-up' },
  { name: 'folds ß and SS together', input: 'STRASSE', expected: 'strasse' },
  { name: 'folds ß', input: 'Straße', expected: 'strasse' },
  { name: 'folds capital ẞ', input: 'STRAẞE', expected: 'strasse' },
  { name: 'NFKC: full-width letters', input: 'ＡＢＣ－１２', expected: 'abc-12' },
  { name: 'NFKC: no-break space', input: 'account\u00a0hold', expected: 'account hold' },
  { name: 'NFKC: ideographic space', input: 'account\u3000hold', expected: 'account hold' },
  { name: 'NFKC: ligature', input: 'ﬁle', expected: 'file' },
  { name: 'NFKC: combining accent', input: 'cafe\u0301', expected: 'café' },
  { name: 'whitespace only becomes empty', input: ' \t\n ', expected: '' },
  { name: 'empty stays empty', input: '', expected: '' },
  { name: 'case-sensitive keeps case', input: 'Wrap-Up', caseSensitive: true, expected: 'Wrap-Up' },
  {
    name: 'case-sensitive still trims and collapses',
    input: '  Ticket   ID ',
    caseSensitive: true,
    expected: 'Ticket ID',
  },
  {
    name: 'case-sensitive still applies NFKC',
    input: 'ＴＩＣＫＥＴ',
    caseSensitive: true,
    expected: 'TICKET',
  },
];

describe('normalizeAnswer', () => {
  for (const c of cases) {
    it(c.name, () => {
      expect(normalizeAnswer(c.input, c.caseSensitive)).toBe(c.expected);
    });
  }

  it('is case-insensitive when the flag is omitted', () => {
    expect(normalizeAnswer('ESCALATE')).toBe(normalizeAnswer('escalate', false));
  });

  it('folds every spelling of a Greek word with a final sigma to one form', () => {
    const forms = ['ΟΔΟΣ', 'οδος', 'οδοσ', 'Οδος'].map((form) => normalizeAnswer(form));
    expect(new Set(forms).size).toBe(1);
  });

  it('is idempotent', () => {
    for (const c of cases) {
      const once = normalizeAnswer(c.input, c.caseSensitive);
      expect(normalizeAnswer(once, c.caseSensitive)).toBe(once);
    }
  });
});
