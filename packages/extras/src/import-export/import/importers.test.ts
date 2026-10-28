import { describe, expect, it } from 'vitest';
import { SERVER_IMPORTERS, readsInBrowser } from './importers';

describe('importers', () => {
  it('reads HTML and XML documents in the browser, the rest on the server', () => {
    expect(readsInBrowser('markdown', ['a.md'])).toBe(false);
    expect(readsInBrowser('word', null)).toBe(true);
    expect(readsInBrowser('notion', ['Support 1234.html'])).toBe(true);
    expect(readsInBrowser('notion', ['Support 1234.md', 'Callbacks 5678.csv'])).toBe(false);
    expect(Object.keys(SERVER_IMPORTERS)).toEqual(['markdown']);
  });
});
