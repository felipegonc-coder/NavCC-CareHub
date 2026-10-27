// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { isSafeHref, opensNewTab, safeHref } from '../src/links';

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
