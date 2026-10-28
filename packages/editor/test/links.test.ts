// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  isSafeHref,
  linkAttributes,
  normalizeLinkInput,
  opensNewTab,
  safeHref,
} from '../src/links';

describe('isSafeHref', () => {
  it.each([
    'https://example.com',
    'http://example.com/a?b=c#d',
    'mailto:robin@example.com',
    'tel:+15550100',
    '/p/page-123',
    '#section',
    'notes/today',
    '//care.example.org/rota',
  ])('allows %s', (href) => {
    expect(isSafeHref(href)).toBe(true);
  });

  it.each([
    'javascript:alert(1)',
    ' JavaScript:alert(1)',
    'java\tscript:alert(1)',
    'java\u0000script:alert(1)',
    'data:text/html,hello',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    '\u00a0javascript:alert(1)',
    '',
    '   ',
    '//',
    '\\\\',
  ])('blocks %j', (href) => {
    expect(isSafeHref(href)).toBe(false);
  });
});

describe('safeHref', () => {
  it.each([
    ['https://example.com/a', 'https://example.com/a'],
    ['  /p/page-123 ', '/p/page-123'],
    ['mailto:robin@example.com', 'mailto:robin@example.com'],
    // `//` links go to another site, so they become https links.
    ['//care.example.org/rota', 'https://care.example.org/rota'],
    ['///care.example.org', 'https://care.example.org'],
    ['\\\\care.example.org/rota', 'https://care.example.org/rota'],
    ['/\\care.example.org/rota', 'https://care.example.org/rota'],
    [' \t//care.example.org', 'https://care.example.org'],
    ['/\n/care.example.org', 'https://care.example.org'],
  ])('turns %j into %j', (href, safe) => {
    expect(safeHref(href)).toBe(safe);
  });

  it.each(['javascript:alert(1)', '//javascript:alert(1)x', ' / / ', '', null, undefined, 42])(
    'refuses %j',
    (href) => {
      expect(safeHref(href)).toBeNull();
    },
  );

  // Invisible characters are blank too: trimmed at the ends, and no help in hiding a scheme.
  it.each([
    ['U+00A0 no-break space', '\u00a0'],
    ['U+00AD soft hyphen', '\u00ad'],
    ['U+200B zero-width space', '\u200b'],
    ['U+2028 line separator', '\u2028'],
    ['U+2060 word joiner', '\u2060'],
    ['U+3000 ideographic space', '\u3000'],
    ['U+3164 Hangul filler', '\u3164'],
    ['U+FEFF byte order mark', '\ufeff'],
    ['U+E0020 tag space', '\u{e0020}'],
  ])('treats %s as blank', (_name, blank) => {
    expect(safeHref(`${blank}javascript:alert(1)`)).toBeNull();
    expect(safeHref(`${blank}JavaScript:alert(1)${blank}`)).toBeNull();
    expect(safeHref(`java${blank}script:alert(1)`)).toBeNull();
    expect(safeHref(`${blank}data:text/html,hello`)).toBeNull();
    expect(safeHref(`${blank}//care.example.org/rota`)).toBe('https://care.example.org/rota');
    expect(safeHref(`/${blank}/care.example.org/rota`)).toBe('https://care.example.org/rota');
    expect(safeHref(`${blank}https://example.com${blank}`)).toBe('https://example.com');
    expect(safeHref(`${blank}/p/page-123${blank}`)).toBe('/p/page-123');
    expect(safeHref(blank)).toBeNull();
  });
});

describe('opensNewTab', () => {
  it.each([
    'https://example.com',
    'HTTP://example.com',
    '//care.example.org',
    '\\\\care.example.org',
  ])('opens %j in a new tab', (href) => {
    expect(opensNewTab(href)).toBe(true);
  });

  it.each(['/p/page-123', '#handover', 'notes/today', 'mailto:robin@example.com', 'tel:+15550100'])(
    'opens %j in the same tab',
    (href) => {
      expect(opensNewTab(href)).toBe(false);
    },
  );
});

describe('normalizeLinkInput', () => {
  it.each([
    ['example.com', 'https://example.com'],
    ['  care.example.org/rota?week=2  ', 'https://care.example.org/rota?week=2'],
    ['example.com:8080', 'https://example.com:8080'],
    ['https://example.com/a', 'https://example.com/a'],
    ['HTTP://example.com', 'HTTP://example.com'],
    ['//care.example.org/rota', 'https://care.example.org/rota'],
    ['robin@example.com', 'mailto:robin@example.com'],
    ['mailto:robin@example.com', 'mailto:robin@example.com'],
    ['tel:+15550100', 'tel:+15550100'],
    ['/p/page-123', '/p/page-123'],
    ['#handover', '#handover'],
  ])('turns %j into %j', (input, href) => {
    expect(normalizeLinkInput(input)).toBe(href);
  });

  it.each([
    '',
    '   ',
    'not a link',
    'javascript:alert(1)',
    'data:text/html,hi',
    'notes',
    'a@b',
    '//',
    '\\\\care.example.org',
  ])('refuses %j', (input) => {
    expect(normalizeLinkInput(input)).toBeNull();
  });
});

describe('linkAttributes', () => {
  it.each([
    ['https://example.com', '_blank'],
    ['https://care.example.org/rota', '_blank'],
    ['/p/page-123', null],
    ['#handover', null],
    ['mailto:robin@example.com', null],
    ['tel:+15550100', null],
  ])('gives %j the target %j, as it is drawn', (href, target) => {
    expect(linkAttributes(href)).toEqual({ href, target });
    expect(target === '_blank').toBe(opensNewTab(href));
  });
});
