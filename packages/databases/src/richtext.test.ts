import { describe, expect, it } from 'vitest';
import { isSafeLink, normalizeRichText, plainText, sanitizeRichText } from './richtext';
import { compareText, foldText, textIncludes } from './text';

describe('rich text', () => {
  it('normalizes spans', () => {
    expect(
      normalizeRichText([
        { text: 'a', marks: ['italic', 'bold'] },
        { text: 'b', marks: ['bold', 'italic'] },
        { text: '' },
        { text: 'c' },
      ]),
    ).toEqual([{ text: 'ab', marks: ['bold', 'italic'] }, { text: 'c' }]);
  });
  it('sanitizes untrusted input', () => {
    expect(
      sanitizeRichText(
        [{ text: 'x', link: 'javascript:alert(1)', marks: ['bold', 'blink'], color: 'neon' }],
        100,
      ),
    ).toEqual([{ text: 'x', marks: ['bold'] }]);
    expect(sanitizeRichText('nope', 100)).toBeNull();
    expect(sanitizeRichText([{ text: 'too long' }], 3)).toBeNull();
    expect(
      sanitizeRichText([{ text: '@Avery', mention: { kind: 'user', id: 'u1' } }], 100),
    ).toEqual([{ text: '@Avery', mention: { kind: 'user', id: 'u1' } }]);
  });
  it('extracts plain text', () => {
    expect(
      plainText([{ text: 'Hello ' }, { text: 'Avery', mention: { kind: 'user', id: 'u1' } }]),
    ).toBe('Hello Avery');
  });
});

describe('text comparison', () => {
  it('ignores case and accents and sorts numbers naturally', () => {
    expect(compareText('Item 2', 'item 10')).toBeLessThan(0);
    expect(compareText('école', 'Ecole')).toBe(0);
    expect(foldText('Crème Brûlée')).toBe('creme brulee');
    expect(textIncludes('Blue Pine Plumbing', 'PINE')).toBe(true);
  });
});

describe('isSafeLink', () => {
  it('allows only http and https links', () => {
    expect(isSafeLink('https://bluepine.example/jobs?id=1#top')).toBe(true);
    expect(isSafeLink('http://localhost:3000/')).toBe(true);
    expect(isSafeLink('https://café.example/menu')).toBe(true);
    expect(isSafeLink('javascript:alert(1)')).toBe(false);
    expect(isSafeLink('ftp://files.example')).toBe(false);
    expect(isSafeLink('https://bluepine.example/a b')).toBe(false);
    expect(isSafeLink('https://')).toBe(false);
  });
});
