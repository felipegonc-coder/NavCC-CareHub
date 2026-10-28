import { describe, expect, it } from 'vitest';
import { isCareHubPath, pageUrl } from './index';

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

describe('isCareHubPath', () => {
  it('accepts paths on Care Hub itself', () => {
    for (const path of ['/', '/p/0b7c', '/p/0b7c?comment=c-1', '/calendar?event=7#today']) {
      expect(isCareHubPath(path), path).toBe(true);
    }
  });

  it('refuses anything a browser could read as another site', () => {
    for (const path of [
      '',
      'p/0b7c',
      '//elsewhere.example.test/p/1',
      '/\\elsewhere.example.test',
      '\\\\elsewhere.example.test',
      'https://elsewhere.example.test/p/1',
      'javascript:alert(1)',
      '/p/two words',
      '/p/\tx',
      '/p/\nx',
      '/p/\u0000',
      '/p/\u007f',
      '/p/\u00a0',
      '/p/\u2028',
    ]) {
      expect(isCareHubPath(path), JSON.stringify(path)).toBe(false);
    }
  });
});
