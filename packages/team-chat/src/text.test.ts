import { describe, expect, it } from 'vitest';
import {
  checkMessageText,
  collapseWhitespace,
  countCharacters,
  isBlankText,
  measureMessageText,
  normalizeMessageText,
  truncateText,
} from './text';

describe('MS-14 message length', () => {
  it('allows 4,000 characters and refuses 4,001', () => {
    expect(checkMessageText('a'.repeat(4000))).toEqual({ ok: true, text: 'a'.repeat(4000) });
    expect(checkMessageText('a'.repeat(4001))).toEqual({ ok: false, error: 'too-long' });
  });

  it('counts characters, not UTF-16 units, so an emoji is one character', () => {
    expect(countCharacters('👍')).toBe(1);
    expect(checkMessageText('👍'.repeat(4000)).ok).toBe(true);
    expect(checkMessageText('👍'.repeat(4001)).ok).toBe(false);
  });

  it('measures after trimming, so surrounding spaces never count', () => {
    expect(checkMessageText(`  ${'a'.repeat(4000)}\n\n `).ok).toBe(true);
  });

  it('refuses huge raw input before doing anything else', () => {
    expect(checkMessageText(' '.repeat(16_001))).toEqual({ ok: false, error: 'too-long' });
  });

  it('shows the counter from 3,800 characters', () => {
    expect(measureMessageText('a'.repeat(3799)).showCounter).toBe(false);
    expect(measureMessageText('a'.repeat(3800))).toEqual({
      length: 3800,
      remaining: 200,
      showCounter: true,
      tooLong: false,
      blank: false,
    });
    expect(measureMessageText('a'.repeat(4002))).toMatchObject({ remaining: -2, tooLong: true });
  });
});

describe('MS-14 empty messages', () => {
  it('treats spaces, line breaks and invisible characters as blank', () => {
    for (const text of ['', ' ', '\n\n', '\t', '\u00A0', '\u200B', '\u200D\uFEFF', '\u3164']) {
      expect(isBlankText(text)).toBe(true);
    }
    expect(isBlankText(' . ')).toBe(false);
    expect(isBlankText('👍')).toBe(false);
  });

  it('turns blank text into "" so the caller can apply the empty rule', () => {
    expect(checkMessageText(' \u200B \n')).toEqual({ ok: true, text: '' });
  });
});

describe('normalizeMessageText', () => {
  it('trims and keeps line breaks inside', () => {
    expect(normalizeMessageText('  Hi Sam,\n\nsee you at 3.  \n')).toBe('Hi Sam,\n\nsee you at 3.');
  });

  it('turns every kind of line break into \\n', () => {
    expect(normalizeMessageText('a\r\nb\rc\u2028d')).toBe('a\nb\nc\nd');
  });

  it('drops control characters but keeps tabs', () => {
    expect(normalizeMessageText('a\u0000b\u0007c\td\u009F')).toBe('abc\td');
  });

  it('repairs broken UTF-16 and composes accents (NFC)', () => {
    expect(normalizeMessageText('a\uD800b')).toBe('a\uFFFDb');
    expect(normalizeMessageText('cafe\u0301')).toBe('caf\u00E9');
    expect(countCharacters(normalizeMessageText('cafe\u0301'))).toBe(4);
  });
});

describe('collapseWhitespace and truncateText', () => {
  it('collapses runs of spaces and lines', () => {
    expect(collapseWhitespace(' Hi \n\n Sam\t!')).toBe('Hi Sam !');
  });

  it('cuts to a length and adds an ellipsis only when cut', () => {
    expect(truncateText('Bluebird Bakery', 15)).toBe('Bluebird Bakery');
    expect(truncateText('Bluebird Bakery', 9)).toBe('Bluebird…');
  });

  it('never cuts through an emoji sequence', () => {
    const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}';
    expect(truncateText(`ab${family}`, 4)).toBe('ab…');
    expect(truncateText(`ab${family}c`, 7)).toBe(`ab${family}…`);
  });
});
