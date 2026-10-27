// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { isSafeHref, linkAttributes, normalizeLinkInput } from '../src/links';

describe('isSafeHref', () => {
  it.each([
    'https://example.com',
    'http://example.com/a?b=c#d',
    'mailto:robin@example.com',
    'tel:+15550100',
    '/p/page-123',
    '#section',
    'notes/today',
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
  ])('blocks %j', (href) => {
    expect(isSafeHref(href)).toBe(false);
  });
});

describe('normalizeLinkInput', () => {
  it.each([
    ['example.com', 'https://example.com'],
    ['  care.example.org/rota?week=2  ', 'https://care.example.org/rota?week=2'],
    ['example.com:8080', 'https://example.com:8080'],
    ['https://example.com/a', 'https://example.com/a'],
    ['HTTP://example.com', 'HTTP://example.com'],
    ['robin@example.com', 'mailto:robin@example.com'],
    ['mailto:robin@example.com', 'mailto:robin@example.com'],
    ['tel:+15550100', 'tel:+15550100'],
    ['/p/page-123', '/p/page-123'],
    ['#handover', '#handover'],
  ])('turns %j into %j', (input, href) => {
    expect(normalizeLinkInput(input)).toBe(href);
  });

  it.each(['', '   ', 'not a link', 'javascript:alert(1)', 'data:text/html,hi', 'notes', 'a@b'])(
    'refuses %j',
    (input) => {
      expect(normalizeLinkInput(input)).toBeNull();
    },
  );
});

describe('linkAttributes', () => {
  it('opens Care Hub links in the same tab and leaves the rest to the defaults', () => {
    expect(linkAttributes('/p/page-123')).toEqual({ href: '/p/page-123', target: null });
    expect(linkAttributes('https://example.com')).toEqual({ href: 'https://example.com' });
  });
});
