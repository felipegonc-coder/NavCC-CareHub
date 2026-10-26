import { describe, expect, it } from 'vitest';
import { screens } from './screens.js';

describe('screens.ts', () => {
  it('names every screen once, in kebab-case, with a path from the site root', () => {
    expect(screens.length).toBeGreaterThan(0);
    expect(new Set(screens.map(({ name }) => name)).size).toBe(screens.length);
    for (const { name, path } of screens) {
      expect(name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(path).toMatch(/^\//);
    }
  });
});
