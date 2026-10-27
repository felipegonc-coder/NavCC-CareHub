import { describe, expect, it } from 'vitest';
import { safeNext, signInPath } from './next';

describe('signInPath', () => {
  it('comes back to the address after signing in, except Home', () => {
    expect(signInPath('/')).toBe('/sign-in');
    expect(signInPath('/p/page-1?view=table#block-2')).toBe(
      '/sign-in?next=%2Fp%2Fpage-1%3Fview%3Dtable%23block-2',
    );
  });
});

describe('safeNext', () => {
  it('keeps a path on this site, with its query and hash', () => {
    expect(safeNext('/p/page-1?view=table#block-2')).toBe('/p/page-1?view=table#block-2');
    expect(safeNext('/settings')).toBe('/settings');
  });

  it('goes Home for anything else', () => {
    for (const next of [
      null,
      undefined,
      '',
      'settings',
      'https://elsewhere.example/p/1',
      'javascript:alert(1)',
      '//elsewhere.example/p/1',
      '/\\elsewhere.example/p/1',
      '/\t/elsewhere.example',
      '/.//elsewhere.example',
      '/sign-in',
      '/sign-in?next=%2Fp%2F1',
    ]) {
      expect(safeNext(next), String(next)).toBe('/');
    }
  });
});
