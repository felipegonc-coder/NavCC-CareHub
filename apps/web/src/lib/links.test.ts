import { commentUrl, pageUrl } from '@carehub/shared';
import { describe, expect, it } from 'vitest';
import { fullLink } from './links';

describe('fullLink', () => {
  const origin = window.location.origin;

  it("starts a Care Hub path with the page's own web address", () => {
    expect(fullLink(pageUrl('0b7c'))).toBe(`${origin}/p/0b7c`);
    expect(fullLink(commentUrl('0b7c', 'c-1'))).toBe(`${origin}${commentUrl('0b7c', 'c-1')}`);
    expect(fullLink('/calendar?event=7#today')).toBe(`${origin}/calendar?event=7#today`);
  });

  it('refuses anything that could point somewhere else', () => {
    for (const path of [
      '',
      'p/0b7c',
      '//elsewhere.example.test/p/1',
      '/\\elsewhere.example.test',
      'https://elsewhere.example.test/p/1',
      'javascript:alert(1)',
      '/p/two words',
      '/p/\tx',
    ]) {
      expect(() => fullLink(path), JSON.stringify(path)).toThrow(RangeError);
    }
  });
});
