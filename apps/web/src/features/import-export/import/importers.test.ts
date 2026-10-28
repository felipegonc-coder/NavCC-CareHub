import { describe, expect, it } from 'vitest';
import { BROWSER_IMPORTERS } from './importers';

describe('BROWSER_IMPORTERS', () => {
  it('lists each importer under its own source', () => {
    for (const [source, importer] of Object.entries(BROWSER_IMPORTERS)) {
      expect(importer.source).toBe(source);
    }
  });
});
