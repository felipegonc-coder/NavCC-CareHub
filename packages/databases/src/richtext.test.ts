import { describe, expect, it } from 'vitest';
import {
  isSafeLink,
  isSafeWebLink,
  normalizeRichText,
  plainText,
  sanitizeRichText,
} from './richtext';
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

describe('isSafeWebLink (issue #12)', () => {
  it('keeps ordinary web addresses', () => {
    for (const ok of [
      'https://bluepine.example',
      'https://bluepine.example/jobs/42?tab=notes#top',
      'http://localhost:5173/p/abc',
      'https://[2001:db8::1]:8443/status',
      'https://medium.example/@avery.lin/notes',
      'HTTPS://BLUEPINE.EXAMPLE/',
    ]) {
      expect(isSafeWebLink(ok)).toBe(true);
    }
  });

  it('refuses script, data and other schemes in any case', () => {
    for (const bad of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'java\tscript:alert(1)',
      'data:text/html;base64,PHNjcmlwdD4=',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      'mailto:avery@bluepine.example',
      'ftp://files.bluepine.example',
    ]) {
      expect(isSafeWebLink(bad)).toBe(false);
    }
  });

  it('refuses leading spaces, tabs and newlines, and characters hidden inside', () => {
    for (const bad of [
      ' https://bluepine.example',
      '\thttps://bluepine.example',
      '\nhttps://bluepine.example',
      'https://bluepine.example/a b',
      'https://bluepine.example/a\u0000b',
      'https://bluepine.example/\u202Etxt.exe',
      'https://bluepine.example/\r\nSet-Cookie:x',
    ]) {
      expect(isSafeWebLink(bad)).toBe(false);
    }
  });

  it('refuses relative and protocol-relative links, empty hosts and user names', () => {
    for (const bad of [
      '//evil.example/path',
      '/p/abc',
      'bluepine.example',
      'https://',
      'https:///path',
      'https:\\\\evil.example',
      'https://user@evil.example',
      'https://user:pass@evil.example/',
      'https://bluepine.example@evil.example/',
      'https://bluepine.example:99999999/',
    ]) {
      expect(isSafeWebLink(bad)).toBe(false);
    }
  });

  it('refuses links over 2,000 characters', () => {
    const base = 'https://bluepine.example/';
    expect(isSafeWebLink(base + 'a'.repeat(2_000 - base.length))).toBe(true);
    expect(isSafeWebLink(base + 'a'.repeat(2_001 - base.length))).toBe(false);
  });

  it('is the rule rich-text links use too', () => {
    expect(isSafeLink('https://user@evil.example')).toBe(false);
    expect(sanitizeRichText([{ text: 'x', link: 'javascript:alert(1)' }], 100)).toEqual([
      { text: 'x' },
    ]);
  });
});
