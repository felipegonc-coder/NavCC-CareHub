import { describe, expect, it } from 'vitest';
import { pageUrl } from './index';

describe('pageUrl', () => {
  it('gives /p/<id> for any page, database or row', () => {
    expect(pageUrl('0c4f7c2e-8d1b-4b7a-9a52-3f1e6d2a9b10')).toBe(
      '/p/0c4f7c2e-8d1b-4b7a-9a52-3f1e6d2a9b10',
    );
  });

  it('keeps the id inside one path segment', () => {
    expect(pageUrl('a/b?c')).toBe('/p/a%2Fb%3Fc');
  });
});
