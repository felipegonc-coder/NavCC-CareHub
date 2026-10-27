import { describe, expect, it } from 'vitest';
import { mediaUrl } from './media-url';

describe('mediaUrl', () => {
  it("gives Care Hub's address for uploaded files", () => {
    expect(mediaUrl({ kind: 'file', fileId: 'file_1' })).toBe('/api/files/file_1');
    expect(mediaUrl({ kind: 'file', fileId: 'a/b c' })).toBe('/api/files/a%2Fb%20c');
  });

  it('gives links as they are, https only', () => {
    expect(mediaUrl({ kind: 'url', url: 'https://example.org/map.png' })).toBe(
      'https://example.org/map.png',
    );
    expect(mediaUrl({ kind: 'url', url: 'http://example.org/map.png' })).toBeUndefined();
    expect(mediaUrl({ kind: 'url', url: 'javascript:alert(1)' })).toBeUndefined();
    expect(mediaUrl(undefined)).toBeUndefined();
  });
});
