// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { isSafeHref } from '../src/links';

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
